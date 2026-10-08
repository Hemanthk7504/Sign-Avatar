"""
Strict authentication & user management service backed by SQLite.

Implements:
- PBKDF2-HMAC-SHA256 password hashing (200,000 iterations) with per-user cryptographic salt
- Strict password policy enforcement (length >= 8, uppercase, lowercase, digit, special char)
- Strict email & username validation
- Brute-force lockout protection (locks account for 5 minutes after 5 consecutive failed logins)
- Signed HMAC-SHA256 session tokens with server-side session revocation & 24h expiration
- Pre-seeded community accounts (Maya Lin, Dr. Alex Rivera, Sophie Müller) for immediate 2-user testing
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("sign_avatar.auth")

DB_PATH = os.environ.get("PLATFORM_DB_PATH", "./data/sign_avatar_platform.db")
SECRET_KEY = os.environ.get("AUTH_SECRET_KEY", "sign_avatar_enterprise_hmac_secret_2026_v1")
PBKDF2_ITERATIONS = 200_000
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 5
SESSION_TTL_HOURS = 24

_db_lock = threading.Lock()

VALID_ROLES = (
    "deaf_signer",
    "certified_interpreter",
    "hard_of_hearing",
    "researcher",
    "hearing_learner",
)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_REGEX = re.compile(r"^[\w.\-]{3,28}$", re.UNICODE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def validate_password_strength(password: str) -> Tuple[bool, List[str]]:
    """
    Strictly validate password strength against market security standards.
    Returns (is_valid, list_of_violations).
    """
    violations: List[str] = []
    if len(password) < 8:
        violations.append("Password must be at least 8 characters long.")
    if len(password) > 128:
        violations.append("Password must not exceed 128 characters.")
    if not re.search(r"[A-Z]", password):
        violations.append("Password must include at least one uppercase letter (A-Z).")
    if not re.search(r"[a-z]", password):
        violations.append("Password must include at least one lowercase letter (a-z).")
    if not re.search(r"[0-9]", password):
        violations.append("Password must include at least one number (0-9).")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>\-_+=\[\]\\;/`~]", password):
        violations.append("Password must include at least one special character (e.g. # ! @ $ %).")
    return (len(violations) == 0, violations)


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return dk.hex()


def _verify_password(password: str, salt: str, expected_hash: str) -> bool:
    candidate = _hash_password(password, salt)
    return hmac.compare_digest(candidate, expected_hash)


def _sign_token(user_id: str, session_id: str, exp_iso: str) -> str:
    payload = json.dumps(
        {"uid": user_id, "sid": session_id, "exp": exp_iso},
        separators=(",", ":"),
    ).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    sig = hmac.new(
        SECRET_KEY.encode("utf-8"),
        b64_payload.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"{b64_payload}.{sig}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _decode_and_verify_token_signature(token: str) -> Optional[Dict[str, str]]:
    if not token or "." not in token:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None
    b64_payload, sig = parts
    expected_sig = hmac.new(
        SECRET_KEY.encode("utf-8"),
        b64_payload.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        padding = "=" * (-len(b64_payload) % 4)
        raw = base64.urlsafe_b64decode(b64_payload + padding).decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        return None


def _row_to_public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "full_name": row["full_name"],
        "role": row["role"],
        "preferred_variant": row["preferred_variant"],
        "preferred_style": row["preferred_style"],
        "avatar_model": row["avatar_model"],
        "bio": row["bio"],
        "verified": bool(row["verified"]),
        "created_at": row["created_at"],
    }


def init_auth_db(db_path: str = DB_PATH) -> None:
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    full_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'deaf_signer',
                    preferred_variant TEXT NOT NULL DEFAULT 'ASL',
                    preferred_style TEXT NOT NULL DEFAULT 'expressive',
                    avatar_model TEXT NOT NULL DEFAULT '/models/michelle.glb',
                    bio TEXT NOT NULL DEFAULT '',
                    verified INTEGER NOT NULL DEFAULT 1,
                    failed_attempts INTEGER NOT NULL DEFAULT 0,
                    locked_until TEXT DEFAULT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """
            )
            conn.commit()
            _seed_default_users(conn)
        finally:
            conn.close()


def _seed_default_users(conn: sqlite3.Connection) -> None:
    default_users = [
        {
            "id": "usr_maya_01",
            "username": "maya_lin",
            "email": "maya@signavatar.ai",
            "full_name": "Maya Lin",
            "password": "SignAvatar#2026",
            "role": "deaf_signer",
            "preferred_variant": "ASL",
            "preferred_style": "expressive",
            "avatar_model": "/models/michelle.glb",
            "bio": "Deaf UX Lead & Native ASL Signer. Passionate about expressive coarticulated 3D motion & accessible healthcare tech.",
            "verified": 1,
        },
        {
            "id": "usr_alex_02",
            "username": "dr_alex",
            "email": "alex@signavatar.ai",
            "full_name": "Dr. Alex Rivera",
            "password": "SignAvatar#2026",
            "role": "certified_interpreter",
            "preferred_variant": "ASL",
            "preferred_style": "neutral",
            "avatar_model": "/models/avatar.glb",
            "bio": "NIC-Certified ASL Medical Interpreter (14 yrs) & Computational Sign Linguistics Researcher.",
            "verified": 1,
        },
        {
            "id": "usr_sophie_03",
            "username": "sophie_m",
            "email": "sophie@signavatar.ai",
            "full_name": "Sophie Müller",
            "password": "SignAvatar#2026",
            "role": "researcher",
            "preferred_variant": "DSGS",
            "preferred_style": "compact",
            "avatar_model": "/models/michelle.glb",
            "bio": "Multilingual SignSuisse (DSGS / LSF-CH) corpus contributor based in Zurich.",
            "verified": 1,
        },
    ]

    for u in default_users:
        existing = conn.execute(
            "SELECT id FROM users WHERE id = ? OR email = ?",
            (u["id"], u["email"]),
        ).fetchone()
        if not existing:
            salt = secrets.token_hex(16)
            pw_hash = _hash_password(u["password"], salt)
            conn.execute(
                """
                INSERT INTO users (
                    id, username, email, full_name, password_hash, salt,
                    role, preferred_variant, preferred_style, avatar_model, bio, verified, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    u["id"],
                    u["username"],
                    u["email"],
                    u["full_name"],
                    pw_hash,
                    salt,
                    u["role"],
                    u["preferred_variant"],
                    u["preferred_style"],
                    u["avatar_model"],
                    u["bio"],
                    u["verified"],
                    _now_iso(),
                ),
            )
    conn.commit()


def _issue_session(conn: sqlite3.Connection, user_id: str) -> str:
    session_id = secrets.token_hex(12)
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=SESSION_TTL_HOURS)
    exp_iso = exp.isoformat()
    token = _sign_token(user_id, session_id, exp_iso)
    thash = _token_hash(token)
    conn.execute(
        """
        INSERT INTO sessions (token_hash, session_id, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (thash, session_id, user_id, exp_iso, now.isoformat()),
    )
    conn.commit()
    return token


def register_user(
    email: str,
    username: str,
    full_name: str,
    password: str,
    role: str = "deaf_signer",
    preferred_variant: str = "ASL",
    preferred_style: str = "expressive",
    avatar_model: str = "/models/michelle.glb",
    bio: str = "",
    db_path: str = DB_PATH,
) -> Dict:
    init_auth_db(db_path)
    email_clean = (email or "").strip().lower()
    username_clean = (username or "").strip()
    full_name_clean = (full_name or "").strip()

    if not EMAIL_REGEX.match(email_clean):
        raise ValueError("Please provide a valid email address.")
    if not USERNAME_REGEX.match(username_clean):
        raise ValueError("Username must be 3–28 characters using letters, numbers, underscores, or hyphens.")
    if len(full_name_clean) < 2 or len(full_name_clean) > 80:
        raise ValueError("Full name must be between 2 and 80 characters.")

    valid_pw, violations = validate_password_strength(password or "")
    if not valid_pw:
        raise ValueError(" ".join(violations))

    if role not in VALID_ROLES:
        role = "deaf_signer"
    if preferred_variant not in ("ASL", "DSGS", "LSF-CH", "LIS-CH", "BSL", "ISL"):
        preferred_variant = "ASL"
    if preferred_style not in ("neutral", "expressive", "compact"):
        preferred_style = "expressive"

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            dup_email = conn.execute("SELECT id FROM users WHERE email = ?", (email_clean,)).fetchone()
            if dup_email:
                raise ValueError("An account with this email address already exists.")
            dup_user = conn.execute("SELECT id FROM users WHERE username = ?", (username_clean,)).fetchone()
            if dup_user:
                raise ValueError("This username is already taken. Please choose another.")

            user_id = f"usr_{secrets.token_hex(6)}"
            salt = secrets.token_hex(16)
            pw_hash = _hash_password(password, salt)
            now = _now_iso()

            conn.execute(
                """
                INSERT INTO users (
                    id, username, email, full_name, password_hash, salt,
                    role, preferred_variant, preferred_style, avatar_model, bio, verified, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    user_id,
                    username_clean,
                    email_clean,
                    full_name_clean,
                    pw_hash,
                    salt,
                    role,
                    preferred_variant,
                    preferred_style,
                    avatar_model,
                    bio.strip() or f"Community member signing in {preferred_variant}.",
                    now,
                ),
            )
            conn.commit()

            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            token = _issue_session(conn, user_id)
            return {"token": token, "user": _row_to_public_user(row)}
        finally:
            conn.close()


def authenticate_user(identifier: str, password: str, db_path: str = DB_PATH) -> Dict:
    init_auth_db(db_path)
    ident = (identifier or "").strip()
    if not ident or not password:
        raise ValueError("Both email/username and password are required.")

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ? OR username = ?",
                (ident.lower(), ident),
            ).fetchone()
            if not row:
                raise ValueError("Invalid credentials. Please check your email and password.")

            now = datetime.now(timezone.utc)
            if row["locked_until"]:
                try:
                    locked_dt = datetime.fromisoformat(row["locked_until"])
                    if locked_dt > now:
                        rem_sec = int((locked_dt - now).total_seconds())
                        raise ValueError(
                            f"Account temporarily locked due to multiple failed sign-in attempts. Try again in {max(1, rem_sec)}s."
                        )
                except ValueError as ve:
                    if "temporarily locked" in str(ve):
                        raise

            if not _verify_password(password, row["salt"], row["password_hash"]):
                attempts = int(row["failed_attempts"] or 0) + 1
                locked_until = None
                if attempts >= MAX_FAILED_ATTEMPTS:
                    locked_until = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
                conn.execute(
                    "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                    (attempts, locked_until, row["id"]),
                )
                conn.commit()
                if locked_until:
                    raise ValueError(
                        f"Too many failed attempts ({MAX_FAILED_ATTEMPTS}). Account locked for {LOCKOUT_MINUTES} minutes."
                    )
                remaining = MAX_FAILED_ATTEMPTS - attempts
                raise ValueError(
                    f"Invalid credentials. {remaining} attempt(s) remaining before temporary lockout."
                )

            # Reset failed attempts on successful login
            if row["failed_attempts"] > 0 or row["locked_until"]:
                conn.execute(
                    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
                    (row["id"],),
                )
                conn.commit()

            token = _issue_session(conn, row["id"])
            return {"token": token, "user": _row_to_public_user(row)}
        finally:
            conn.close()


def verify_session_token(token: str, db_path: str = DB_PATH) -> Optional[Dict]:
    init_auth_db(db_path)
    if not token:
        return None
    clean_token = token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    decoded = _decode_and_verify_token_signature(clean_token)
    if not decoded:
        return None

    thash = _token_hash(clean_token)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            sess = conn.execute(
                "SELECT * FROM sessions WHERE token_hash = ?",
                (thash,),
            ).fetchone()
            if not sess:
                return None
            exp_dt = datetime.fromisoformat(sess["expires_at"])
            if exp_dt < datetime.now(timezone.utc):
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (thash,))
                conn.commit()
                return None

            user_row = conn.execute(
                "SELECT * FROM users WHERE id = ?",
                (sess["user_id"],),
            ).fetchone()
            if not user_row:
                return None
            return _row_to_public_user(user_row)
        finally:
            conn.close()


def revoke_session_token(token: str, db_path: str = DB_PATH) -> bool:
    init_auth_db(db_path)
    if not token:
        return False
    clean_token = token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()
    thash = _token_hash(clean_token)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            cur = conn.execute("DELETE FROM sessions WHERE token_hash = ?", (thash,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def update_user_profile(
    user_id: str,
    full_name: Optional[str] = None,
    bio: Optional[str] = None,
    preferred_variant: Optional[str] = None,
    preferred_style: Optional[str] = None,
    avatar_model: Optional[str] = None,
    db_path: str = DB_PATH,
) -> Dict:
    init_auth_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                raise ValueError("User not found.")

            new_name = (full_name.strip() if full_name is not None else row["full_name"])
            if len(new_name) < 2:
                raise ValueError("Full name must be at least 2 characters.")
            new_bio = (bio.strip() if bio is not None else row["bio"])
            new_var = preferred_variant if preferred_variant in ("ASL", "DSGS", "LSF-CH", "LIS-CH", "BSL", "ISL") else row["preferred_variant"]
            new_style = preferred_style if preferred_style in ("neutral", "expressive", "compact") else row["preferred_style"]
            new_avatar = avatar_model if avatar_model in ("/models/michelle.glb", "/models/avatar.glb") else row["avatar_model"]

            conn.execute(
                """
                UPDATE users
                SET full_name = ?, bio = ?, preferred_variant = ?, preferred_style = ?, avatar_model = ?
                WHERE id = ?
                """,
                (new_name, new_bio, new_var, new_style, new_avatar, user_id),
            )
            conn.commit()
            updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _row_to_public_user(updated)
        finally:
            conn.close()


def list_all_users(current_user_id: Optional[str] = None, db_path: str = DB_PATH) -> List[Dict]:
    init_auth_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
            return [_row_to_public_user(r) for r in rows]
        finally:
            conn.close()
