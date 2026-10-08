"""
Social media & two-user interaction service backed by SQLite.

Supports two core social interactions:
1. Community 3D Sign Feed:
   - Create signed posts with automatic linguistic gloss + non-manual marker extraction
   - Multi-reaction system (like, ily 🤟, clap 👏, fire 🔥)
   - Threaded comments where replies are also converted into sign language glosses for 3D avatar playback
   - User follow / connection graph
2. Two-User Direct Sign Messenger (Peer-to-Peer 3D Avatar Conversation):
   - Direct 1-on-1 signed conversation threads between any two users (e.g. Maya Lin <-> Dr. Alex Rivera)
   - Each message stores its synthesized gloss sequence, sign variant, style, and sender avatar model
   - Message reactions and conversation summary
"""
from __future__ import annotations

import json
import logging
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from app.services.auth_service import (
    DB_PATH,
    _db_lock,
    _now_iso,
    get_db_connection,
    init_auth_db,
)
from app.services.text_to_gloss import text_to_gloss

logger = logging.getLogger("sign_avatar.social")

VALID_REACTIONS = ("like", "ily", "clap", "fire")


def _extract_gloss_dicts(text: str) -> List[Dict]:
    tokens = text_to_gloss(text or "")
    return [
        {
            "word": t.word,
            "gloss": t.gloss,
            "non_manual": list(t.non_manual or []),
            "fingerspelled": bool(getattr(t, "fingerspelled", False)),
        }
        for t in tokens
    ]


def init_social_db(db_path: str = DB_PATH) -> None:
    init_auth_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS follows (
                    follower_id TEXT NOT NULL,
                    following_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (follower_id, following_id),
                    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS posts (
                    id TEXT PRIMARY KEY,
                    author_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    variant TEXT NOT NULL DEFAULT 'ASL',
                    style TEXT NOT NULL DEFAULT 'expressive',
                    avatar_model TEXT NOT NULL DEFAULT '/models/michelle.glb',
                    gloss_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS post_reactions (
                    post_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    reaction_type TEXT NOT NULL DEFAULT 'ily',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (post_id, user_id),
                    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS post_comments (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    variant TEXT NOT NULL DEFAULT 'ASL',
                    gloss_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS direct_messages (
                    id TEXT PRIMARY KEY,
                    sender_id TEXT NOT NULL,
                    recipient_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    variant TEXT NOT NULL DEFAULT 'ASL',
                    style TEXT NOT NULL DEFAULT 'expressive',
                    avatar_model TEXT NOT NULL DEFAULT '/models/michelle.glb',
                    gloss_json TEXT NOT NULL DEFAULT '[]',
                    reaction TEXT DEFAULT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """
            )
            conn.commit()
            _seed_social_data(conn)
        finally:
            conn.close()


def _seed_social_data(conn: sqlite3.Connection) -> None:
    existing_post = conn.execute("SELECT id FROM posts LIMIT 1").fetchone()
    if existing_post:
        return

    now = datetime.now(timezone.utc)

    # Seed mutual follows between Maya, Alex, and Sophie
    follows_seed = [
        ("usr_maya_01", "usr_alex_02"),
        ("usr_alex_02", "usr_maya_01"),
        ("usr_maya_01", "usr_sophie_03"),
        ("usr_sophie_03", "usr_maya_01"),
        ("usr_alex_02", "usr_sophie_03"),
    ]
    for f1, f2 in follows_seed:
        conn.execute(
            "INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)",
            (f1, f2, (now - timedelta(days=2)).isoformat()),
        )

    # Seed initial community posts
    seed_posts = [
        {
            "id": "post_seed_01",
            "author_id": "usr_maya_01",
            "content": "Welcome to our Deaf-led 3D Sign Language community! How are you feeling today?",
            "variant": "ASL",
            "style": "expressive",
            "avatar_model": "/models/michelle.glb",
            "tags": ["ASL", "DeafCommunity", "MotionDiffusion"],
            "created_at": (now - timedelta(hours=3)).isoformat(),
        },
        {
            "id": "post_seed_02",
            "author_id": "usr_alex_02",
            "content": "Where is the hospital emergency room? Testing clinical triage phrases with furrowed brow markers.",
            "variant": "ASL",
            "style": "neutral",
            "avatar_model": "/models/avatar.glb",
            "tags": ["MedicalASL", "HealthcareAccess", "NonManualMarkers"],
            "created_at": (now - timedelta(hours=2)).isoformat(),
        },
        {
            "id": "post_seed_03",
            "author_id": "usr_sophie_03",
            "content": "Tomorrow we meet in the morning to review continuous Swiss German sign trajectories.",
            "variant": "DSGS",
            "style": "compact",
            "avatar_model": "/models/michelle.glb",
            "tags": ["DSGS", "SignSuisse", "Multilingual"],
            "created_at": (now - timedelta(hours=1)).isoformat(),
        },
    ]

    for p in seed_posts:
        glosses = _extract_gloss_dicts(p["content"])
        conn.execute(
            """
            INSERT INTO posts (id, author_id, content, variant, style, avatar_model, gloss_json, tags_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                p["id"],
                p["author_id"],
                p["content"],
                p["variant"],
                p["style"],
                p["avatar_model"],
                json.dumps(glosses),
                json.dumps(p["tags"]),
                p["created_at"],
            ),
        )

    # Seed reactions
    reactions_seed = [
        ("post_seed_01", "usr_alex_02", "ily"),
        ("post_seed_01", "usr_sophie_03", "fire"),
        ("post_seed_02", "usr_maya_01", "clap"),
        ("post_seed_02", "usr_sophie_03", "like"),
        ("post_seed_03", "usr_maya_01", "ily"),
    ]
    for pid, uid, rtype in reactions_seed:
        conn.execute(
            "INSERT OR IGNORE INTO post_reactions (post_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?)",
            (pid, uid, rtype, now.isoformat()),
        )

    # Seed comments (User 2 commenting on User 1's post, and User 1 commenting on User 2's post)
    comments_seed = [
        {
            "id": "cmt_seed_01",
            "post_id": "post_seed_01",
            "author_id": "usr_alex_02",
            "content": "Thank you Maya! The bilateral hand coarticulation looks remarkably natural today.",
            "variant": "ASL",
            "created_at": (now - timedelta(hours=2, minutes=30)).isoformat(),
        },
        {
            "id": "cmt_seed_02",
            "post_id": "post_seed_02",
            "author_id": "usr_maya_01",
            "content": "The WH-question eyebrow furrow on WHERE makes the clinical question crystal clear!",
            "variant": "ASL",
            "created_at": (now - timedelta(hours=1, minutes=20)).isoformat(),
        },
    ]
    for c in comments_seed:
        glosses = _extract_gloss_dicts(c["content"])
        conn.execute(
            """
            INSERT INTO post_comments (id, post_id, author_id, content, variant, gloss_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                c["id"],
                c["post_id"],
                c["author_id"],
                c["content"],
                c["variant"],
                json.dumps(glosses),
                c["created_at"],
            ),
        )

    # Seed 2-User Direct Sign Conversation between User 1 (Maya) and User 2 (Dr. Alex)
    dms_seed = [
        {
            "id": "dm_seed_01",
            "sender_id": "usr_maya_01",
            "recipient_id": "usr_alex_02",
            "content": "Hello Alex! Can we practice the hospital intake dialogue together?",
            "variant": "ASL",
            "style": "expressive",
            "avatar_model": "/models/michelle.glb",
            "reaction": "ily",
            "created_at": (now - timedelta(minutes=45)).isoformat(),
        },
        {
            "id": "dm_seed_02",
            "sender_id": "usr_alex_02",
            "recipient_id": "usr_maya_01",
            "content": "Yes! Where is the doctor office and when is your appointment?",
            "variant": "ASL",
            "style": "neutral",
            "avatar_model": "/models/avatar.glb",
            "reaction": "clap",
            "created_at": (now - timedelta(minutes=42)).isoformat(),
        },
        {
            "id": "dm_seed_03",
            "sender_id": "usr_maya_01",
            "recipient_id": "usr_alex_02",
            "content": "My appointment is tomorrow morning. Thank you for helping me prepare!",
            "variant": "ASL",
            "style": "expressive",
            "avatar_model": "/models/michelle.glb",
            "reaction": "fire",
            "created_at": (now - timedelta(minutes=38)).isoformat(),
        },
    ]
    for dm in dms_seed:
        glosses = _extract_gloss_dicts(dm["content"])
        conn.execute(
            """
            INSERT INTO direct_messages (
                id, sender_id, recipient_id, content, variant, style, avatar_model, gloss_json, reaction, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dm["id"],
                dm["sender_id"],
                dm["recipient_id"],
                dm["content"],
                dm["variant"],
                dm["style"],
                dm["avatar_model"],
                json.dumps(glosses),
                dm["reaction"],
                dm["created_at"],
            ),
        )

    conn.commit()


def _format_post(conn: sqlite3.Connection, row: sqlite3.Row, current_user_id: Optional[str]) -> Dict:
    author = conn.execute(
        "SELECT id, username, full_name, role, preferred_variant, avatar_model, verified FROM users WHERE id = ?",
        (row["author_id"],),
    ).fetchone()

    reactions = conn.execute(
        "SELECT user_id, reaction_type FROM post_reactions WHERE post_id = ?",
        (row["id"],),
    ).fetchall()

    counts = {r: 0 for r in VALID_REACTIONS}
    user_reaction = None
    for r in reactions:
        rtype = r["reaction_type"]
        if rtype in counts:
            counts[rtype] += 1
        else:
            counts["like"] += 1
        if current_user_id and r["user_id"] == current_user_id:
            user_reaction = rtype

    comment_rows = conn.execute(
        """
        SELECT c.*, u.username, u.full_name, u.role, u.avatar_model, u.verified
        FROM post_comments c
        JOIN users u ON u.id = c.author_id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC
        """,
        (row["id"],),
    ).fetchall()

    comments = [
        {
            "id": c["id"],
            "post_id": c["post_id"],
            "content": c["content"],
            "variant": c["variant"],
            "gloss_sequence": json.loads(c["gloss_json"] or "[]"),
            "created_at": c["created_at"],
            "author": {
                "id": c["author_id"],
                "username": c["username"],
                "full_name": c["full_name"],
                "role": c["role"],
                "avatar_model": c["avatar_model"],
                "verified": bool(c["verified"]),
            },
        }
        for c in comment_rows
    ]

    return {
        "id": row["id"],
        "content": row["content"],
        "variant": row["variant"],
        "style": row["style"],
        "avatar_model": row["avatar_model"],
        "gloss_sequence": json.loads(row["gloss_json"] or "[]"),
        "tags": json.loads(row["tags_json"] or "[]"),
        "created_at": row["created_at"],
        "author": {
            "id": author["id"] if author else row["author_id"],
            "username": author["username"] if author else "unknown",
            "full_name": author["full_name"] if author else "Unknown Signer",
            "role": author["role"] if author else "deaf_signer",
            "preferred_variant": author["preferred_variant"] if author else "ASL",
            "avatar_model": author["avatar_model"] if author else "/models/michelle.glb",
            "verified": bool(author["verified"]) if author else False,
        },
        "reaction_counts": counts,
        "total_reactions": sum(counts.values()),
        "user_reaction": user_reaction,
        "comments": comments,
        "comment_count": len(comments),
    }


def list_feed_posts(current_user_id: Optional[str] = None, variant_filter: Optional[str] = None, db_path: str = DB_PATH) -> List[Dict]:
    init_social_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            if variant_filter and variant_filter != "ALL":
                rows = conn.execute(
                    "SELECT * FROM posts WHERE variant = ? ORDER BY created_at DESC",
                    (variant_filter,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM posts ORDER BY created_at DESC"
                ).fetchall()
            return [_format_post(conn, r, current_user_id) for r in rows]
        finally:
            conn.close()


def create_feed_post(
    author_id: str,
    content: str,
    variant: str = "ASL",
    style: str = "expressive",
    avatar_model: str = "/models/michelle.glb",
    tags: Optional[List[str]] = None,
    db_path: str = DB_PATH,
) -> Dict:
    init_social_db(db_path)
    clean_content = (content or "").strip()
    if not clean_content:
        raise ValueError("Post content cannot be empty.")
    if len(clean_content) > 600:
        raise ValueError("Post content must be 600 characters or fewer.")

    clean_tags = [t.strip().lstrip("#") for t in (tags or []) if t.strip()][:6]
    if not clean_tags:
        clean_tags = [variant, "SignLanguage"]

    glosses = _extract_gloss_dicts(clean_content)
    post_id = f"post_{secrets.token_hex(6)}"
    now = _now_iso()

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            conn.execute(
                """
                INSERT INTO posts (id, author_id, content, variant, style, avatar_model, gloss_json, tags_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    post_id,
                    author_id,
                    clean_content,
                    variant or "ASL",
                    style or "expressive",
                    avatar_model or "/models/michelle.glb",
                    json.dumps(glosses),
                    json.dumps(clean_tags),
                    now,
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
            return _format_post(conn, row, author_id)
        finally:
            conn.close()


def toggle_post_reaction(
    post_id: str,
    user_id: str,
    reaction_type: str = "ily",
    db_path: str = DB_PATH,
) -> Dict:
    init_social_db(db_path)
    if reaction_type not in VALID_REACTIONS:
        reaction_type = "ily"

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            post_row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
            if not post_row:
                raise ValueError("Post not found.")

            existing = conn.execute(
                "SELECT reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ?",
                (post_id, user_id),
            ).fetchone()

            if existing and existing["reaction_type"] == reaction_type:
                conn.execute(
                    "DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?",
                    (post_id, user_id),
                )
            elif existing:
                conn.execute(
                    "UPDATE post_reactions SET reaction_type = ?, created_at = ? WHERE post_id = ? AND user_id = ?",
                    (reaction_type, _now_iso(), post_id, user_id),
                )
            else:
                conn.execute(
                    "INSERT INTO post_reactions (post_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?)",
                    (post_id, user_id, reaction_type, _now_iso()),
                )
            conn.commit()
            return _format_post(conn, post_row, user_id)
        finally:
            conn.close()


def add_post_comment(
    post_id: str,
    author_id: str,
    content: str,
    variant: str = "ASL",
    db_path: str = DB_PATH,
) -> Dict:
    init_social_db(db_path)
    clean_content = (content or "").strip()
    if not clean_content:
        raise ValueError("Comment cannot be empty.")
    if len(clean_content) > 400:
        raise ValueError("Comment must be 400 characters or fewer.")

    glosses = _extract_gloss_dicts(clean_content)
    comment_id = f"cmt_{secrets.token_hex(6)}"

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            post_row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
            if not post_row:
                raise ValueError("Post not found.")

            conn.execute(
                """
                INSERT INTO post_comments (id, post_id, author_id, content, variant, gloss_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (comment_id, post_id, author_id, clean_content, variant or "ASL", json.dumps(glosses), _now_iso()),
            )
            conn.commit()
            return _format_post(conn, post_row, author_id)
        finally:
            conn.close()


def toggle_follow_user(follower_id: str, following_id: str, db_path: str = DB_PATH) -> Dict:
    init_social_db(db_path)
    if follower_id == following_id:
        raise ValueError("You cannot follow yourself.")

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            target = conn.execute("SELECT id FROM users WHERE id = ?", (following_id,)).fetchone()
            if not target:
                raise ValueError("Target user not found.")

            existing = conn.execute(
                "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
                (follower_id, following_id),
            ).fetchone()

            if existing:
                conn.execute(
                    "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
                    (follower_id, following_id),
                )
                is_following = False
            else:
                conn.execute(
                    "INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)",
                    (follower_id, following_id, _now_iso()),
                )
                is_following = True
            conn.commit()

            followers_count = conn.execute(
                "SELECT COUNT(*) AS c FROM follows WHERE following_id = ?",
                (following_id,),
            ).fetchone()["c"]

            return {
                "follower_id": follower_id,
                "following_id": following_id,
                "is_following": is_following,
                "followers_count": followers_count,
            }
        finally:
            conn.close()


def get_community_directory(current_user_id: str, db_path: str = DB_PATH) -> List[Dict]:
    init_social_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            users = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
            out = []
            for u in users:
                uid = u["id"]
                followers_count = conn.execute(
                    "SELECT COUNT(*) AS c FROM follows WHERE following_id = ?", (uid,)
                ).fetchone()["c"]
                following_count = conn.execute(
                    "SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?", (uid,)
                ).fetchone()["c"]
                post_count = conn.execute(
                    "SELECT COUNT(*) AS c FROM posts WHERE author_id = ?", (uid,)
                ).fetchone()["c"]
                is_following = False
                if current_user_id and current_user_id != uid:
                    is_following = bool(
                        conn.execute(
                            "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
                            (current_user_id, uid),
                        ).fetchone()
                    )
                out.append(
                    {
                        "id": uid,
                        "username": u["username"],
                        "full_name": u["full_name"],
                        "email": u["email"],
                        "role": u["role"],
                        "preferred_variant": u["preferred_variant"],
                        "preferred_style": u["preferred_style"],
                        "avatar_model": u["avatar_model"],
                        "bio": u["bio"],
                        "verified": bool(u["verified"]),
                        "followers_count": followers_count,
                        "following_count": following_count,
                        "post_count": post_count,
                        "is_following": is_following,
                    }
                )
            return out
        finally:
            conn.close()


def list_direct_messages(user_a_id: str, user_b_id: str, db_path: str = DB_PATH) -> List[Dict]:
    init_social_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            rows = conn.execute(
                """
                SELECT dm.*,
                       s.username AS sender_username, s.full_name AS sender_name, s.role AS sender_role, s.verified AS sender_verified,
                       r.username AS recipient_username, r.full_name AS recipient_name
                FROM direct_messages dm
                JOIN users s ON s.id = dm.sender_id
                JOIN users r ON r.id = dm.recipient_id
                WHERE (dm.sender_id = ? AND dm.recipient_id = ?)
                   OR (dm.sender_id = ? AND dm.recipient_id = ?)
                ORDER BY dm.created_at ASC
                """,
                (user_a_id, user_b_id, user_b_id, user_a_id),
            ).fetchall()

            return [
                {
                    "id": row["id"],
                    "sender_id": row["sender_id"],
                    "recipient_id": row["recipient_id"],
                    "content": row["content"],
                    "variant": row["variant"],
                    "style": row["style"],
                    "avatar_model": row["avatar_model"],
                    "gloss_sequence": json.loads(row["gloss_json"] or "[]"),
                    "reaction": row["reaction"],
                    "created_at": row["created_at"],
                    "sender": {
                        "id": row["sender_id"],
                        "username": row["sender_username"],
                        "full_name": row["sender_name"],
                        "role": row["sender_role"],
                        "verified": bool(row["sender_verified"]),
                    },
                    "recipient": {
                        "id": row["recipient_id"],
                        "username": row["recipient_username"],
                        "full_name": row["recipient_name"],
                    },
                }
                for row in rows
            ]
        finally:
            conn.close()


def send_direct_message(
    sender_id: str,
    recipient_id: str,
    content: str,
    variant: Optional[str] = None,
    style: Optional[str] = None,
    avatar_model: Optional[str] = None,
    db_path: str = DB_PATH,
) -> Dict:
    init_social_db(db_path)
    clean_content = (content or "").strip()
    if not clean_content:
        raise ValueError("Message cannot be empty.")
    if len(clean_content) > 500:
        raise ValueError("Message must be 500 characters or fewer.")
    if sender_id == recipient_id:
        raise ValueError("Please select another user to converse with.")

    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            sender = conn.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
            recipient = conn.execute("SELECT * FROM users WHERE id = ?", (recipient_id,)).fetchone()
            if not sender or not recipient:
                raise ValueError("Sender or recipient user not found.")

            use_variant = variant or sender["preferred_variant"] or "ASL"
            use_style = style or sender["preferred_style"] or "expressive"
            use_avatar = avatar_model or sender["avatar_model"] or "/models/michelle.glb"
            glosses = _extract_gloss_dicts(clean_content)
            msg_id = f"dm_{secrets.token_hex(6)}"
            now = _now_iso()

            conn.execute(
                """
                INSERT INTO direct_messages (
                    id, sender_id, recipient_id, content, variant, style, avatar_model, gloss_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg_id,
                    sender_id,
                    recipient_id,
                    clean_content,
                    use_variant,
                    use_style,
                    use_avatar,
                    json.dumps(glosses),
                    now,
                ),
            )
            conn.commit()

            messages = list_direct_messages(sender_id, recipient_id, db_path=db_path)
            for m in reversed(messages):
                if m["id"] == msg_id:
                    return m
            return messages[-1]
        finally:
            conn.close()


def react_to_direct_message(
    message_id: str,
    user_id: str,
    reaction: str = "ily",
    db_path: str = DB_PATH,
) -> Dict:
    init_social_db(db_path)
    if reaction not in VALID_REACTIONS:
        reaction = "ily"
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            row = conn.execute("SELECT * FROM direct_messages WHERE id = ?", (message_id,)).fetchone()
            if not row:
                raise ValueError("Message not found.")
            new_reaction = None if row["reaction"] == reaction else reaction
            conn.execute(
                "UPDATE direct_messages SET reaction = ? WHERE id = ?",
                (new_reaction, message_id),
            )
            conn.commit()
            return {
                "id": message_id,
                "reaction": new_reaction,
            }
        finally:
            conn.close()


def get_platform_stats(current_user_id: Optional[str] = None, db_path: str = DB_PATH) -> Dict:
    init_social_db(db_path)
    with _db_lock:
        conn = get_db_connection(db_path)
        try:
            total_users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
            total_posts = conn.execute("SELECT COUNT(*) AS c FROM posts").fetchone()["c"]
            total_reactions = conn.execute("SELECT COUNT(*) AS c FROM post_reactions").fetchone()["c"]
            total_comments = conn.execute("SELECT COUNT(*) AS c FROM post_comments").fetchone()["c"]
            total_dms = conn.execute("SELECT COUNT(*) AS c FROM direct_messages").fetchone()["c"]

            user_stats = {"posts": 0, "dms": 0, "followers": 0, "following": 0}
            if current_user_id:
                user_stats["posts"] = conn.execute(
                    "SELECT COUNT(*) AS c FROM posts WHERE author_id = ?", (current_user_id,)
                ).fetchone()["c"]
                user_stats["dms"] = conn.execute(
                    "SELECT COUNT(*) AS c FROM direct_messages WHERE sender_id = ? OR recipient_id = ?",
                    (current_user_id, current_user_id),
                ).fetchone()["c"]
                user_stats["followers"] = conn.execute(
                    "SELECT COUNT(*) AS c FROM follows WHERE following_id = ?", (current_user_id,)
                ).fetchone()["c"]
                user_stats["following"] = conn.execute(
                    "SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?", (current_user_id,)
                ).fetchone()["c"]

            return {
                "total_users": total_users,
                "total_posts": total_posts,
                "total_reactions": total_reactions,
                "total_comments": total_comments,
                "total_dms": total_dms,
                "user_stats": user_stats,
            }
        finally:
            conn.close()
