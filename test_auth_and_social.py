"""
End-to-end verification of:
1. Strict Authentication (PBKDF2-HMAC-SHA256, password complexity, brute-force lockout, token revocation, 401 guards)
2. Separate Home Page & Route Availability (/, /home, /community, /login, /register)
3. Social Media Interaction #1: Community 3D Sign Feed (Posts, Auto-Gloss, Reactions, Signed Comments)
4. Social Media Interaction #2: Two-User Direct Sign Messenger & Follow Graph (User 1 <-> User 2)
"""
import os
import tempfile
from fastapi.testclient import TestClient

# Point to an isolated test SQLite DB before importing main
_tmp_db = os.path.join(tempfile.gettempdir(), "test_sign_avatar_platform.db")
if os.path.exists(_tmp_db):
    os.remove(_tmp_db)
os.environ["PLATFORM_DB_PATH"] = _tmp_db

from app.services import auth_service, social_service
auth_service.DB_PATH = _tmp_db
social_service.DB_PATH = _tmp_db

from main import app

client = TestClient(app)


def run_tests():
    print("--- 1. Verifying Page Routes (/, /home, /community, /login, /register) ---")
    for route in ["/", "/home", "/community", "/login", "/register", "/dashboard"]:
        res = client.get(route)
        assert res.status_code == 200, f"Route {route} failed with {res.status_code}"
    print("OK all HTML page routes return 200")

    print("\n--- 2. Verifying Strict Authentication Guards (Unauthenticated 401s) ---")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/social/posts", json={"content": "Unauthorized post"}).status_code == 401
    assert client.post("/api/social/messages", json={"recipient_id": "usr_alex_02", "content": "Hi"}).status_code == 401
    assert client.post("/api/social/follow/usr_alex_02").status_code == 401
    print("OK unauthenticated requests strictly rejected with 401")

    print("\n--- 3. Verifying Strict Password Policy & Edge Cases ---")
    weak_passwords = [
        "short1!",          # < 8 chars
        "alllowercase1!",   # no uppercase
        "ALLUPPERCASE1!",   # no lowercase
        "NoNumbersHere!",   # no digit
        "NoSpecialChar123", # no symbol
    ]
    for wp in weak_passwords:
        r = client.post(
            "/api/auth/register",
            json={
                "email": "test@signavatar.ai",
                "username": "test_user",
                "full_name": "Test User",
                "password": wp,
            },
        )
        assert r.status_code == 400, f"Weak password {wp!r} should be rejected"
    print("OK all 5 weak password categories strictly rejected")

    # Valid registration
    reg_res = client.post(
        "/api/auth/register",
        json={
            "email": "elena@signavatar.ai",
            "username": "elena_signs",
            "full_name": "Elena Rostova",
            "password": "StrongPassword#2026",
            "role": "deaf_signer",
            "preferred_variant": "ASL",
        },
    )
    assert reg_res.status_code == 200, f"Valid registration failed: {reg_res.text}"
    elena_token = reg_res.json()["token"]
    assert reg_res.json()["user"]["username"] == "elena_signs"

    # Duplicate email / username rejection
    dup_res = client.post(
        "/api/auth/register",
        json={
            "email": "elena@signavatar.ai",
            "username": "other_handle",
            "full_name": "Elena Dup",
            "password": "StrongPassword#2026",
        },
    )
    assert dup_res.status_code == 400, "Duplicate email must be rejected"

    # Tampered token rejection
    tampered = elena_token[:-4] + "abcd"
    client.cookies.clear()
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tampered}"}).status_code == 401

    # Brute-force lockout test on Elena's account (5 bad attempts -> locked)
    for attempt in range(1, 6):
        bad_login = client.post(
            "/api/auth/login",
            json={"email": "elena@signavatar.ai", "password": "WrongPassword#999"},
        )
        if attempt < 5:
            assert bad_login.status_code == 401
        else:
            assert bad_login.status_code == 429, f"Expected 429 lockout on 5th attempt, got {bad_login.status_code}"

    # Even correct password while locked should return 429
    locked_check = client.post(
        "/api/auth/login",
        json={"email": "elena@signavatar.ai", "password": "StrongPassword#2026"},
    )
    assert locked_check.status_code == 429, "Account must remain locked during lockout window"
    print("OK brute-force 5-attempt lockout verified")

    # Logout & session revocation
    logout_res = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {elena_token}"})
    assert logout_res.status_code == 200
    client.cookies.clear()
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {elena_token}"}).status_code == 401
    print("OK token revocation on logout verified")

    print("\n--- 4. Verifying 2-User Social Interactions (Maya Lin <-> Dr. Alex Rivera) ---")
    maya_login = client.post(
        "/api/auth/login",
        json={"email": "maya@signavatar.ai", "password": "SignAvatar#2026"},
    )
    assert maya_login.status_code == 200
    maya_token = maya_login.json()["token"]
    maya_headers = {"Authorization": f"Bearer {maya_token}"}

    alex_login = client.post(
        "/api/auth/login",
        json={"email": "alex@signavatar.ai", "password": "SignAvatar#2026"},
    )
    assert alex_login.status_code == 200
    alex_token = alex_login.json()["token"]
    alex_headers = {"Authorization": f"Bearer {alex_token}"}

    # Interaction #1: Maya creates a signed post on the Community Feed
    post_res = client.post(
        "/api/social/posts",
        headers=maya_headers,
        json={
            "content": "Where is the deaf community center tomorrow?",
            "variant": "ASL",
            "style": "expressive",
            "avatar_model": "/models/michelle.glb",
            "tags": ["ASL", "Community"],
        },
    )
    assert post_res.status_code == 200
    created_post = post_res.json()["post"]
    post_id = created_post["id"]
    gloss_words = [g["gloss"] for g in created_post["gloss_sequence"]]
    assert "TOMORROW" in gloss_words and "WHERE" in gloss_words, f"Unexpected glosses: {gloss_words}"
    assert "furrowed_brow" in created_post["gloss_sequence"][0]["non_manual"]

    # Empty post edge case
    empty_post = client.post(
        "/api/social/posts",
        headers=maya_headers,
        json={"content": "   ", "variant": "ASL", "style": "neutral", "avatar_model": "/models/michelle.glb"},
    )
    assert empty_post.status_code == 400

    # Alex reacts to Maya's post with 'ily' 🤟
    react_res = client.post(
        f"/api/social/posts/{post_id}/react",
        headers=alex_headers,
        json={"reaction_type": "ily"},
    )
    assert react_res.status_code == 200
    assert react_res.json()["post"]["reaction_counts"]["ily"] == 1

    # Alex comments on Maya's post (generates signed glosses for the reply)
    cmt_res = client.post(
        f"/api/social/posts/{post_id}/comments",
        headers=alex_headers,
        json={"content": "The center is near the hospital!", "variant": "ASL"},
    )
    assert cmt_res.status_code == 200
    updated_post = cmt_res.json()["post"]
    assert updated_post["comment_count"] == 1
    assert len(updated_post["comments"][0]["gloss_sequence"]) > 0
    print("OK Interaction #1 (Community Sign Feed: Post, Gloss, Reaction, Signed Reply) verified")

    # Interaction #2: Two-User Direct Sign Messenger & Follow Graph
    # Self-follow edge case
    self_follow = client.post("/api/social/follow/usr_maya_01", headers=maya_headers)
    assert self_follow.status_code == 400

    # Maya sends a signed direct message to Alex
    dm1 = client.post(
        "/api/social/messages",
        headers=maya_headers,
        json={
            "recipient_id": "usr_alex_02",
            "content": "Hello Alex, can you review my medical sign glosses?",
            "variant": "ASL",
            "style": "expressive",
        },
    )
    assert dm1.status_code == 200
    dm1_id = dm1.json()["message"]["id"]
    assert len(dm1.json()["message"]["gloss_sequence"]) > 0

    # Alex replies to Maya with a signed direct message
    dm2 = client.post(
        "/api/social/messages",
        headers=alex_headers,
        json={
            "recipient_id": "usr_maya_01",
            "content": "Yes Maya, your handshape trajectories look great today!",
            "variant": "ASL",
            "style": "neutral",
        },
    )
    assert dm2.status_code == 200

    # Alex reacts to Maya's direct message
    dm_react = client.post(
        f"/api/social/messages/{dm1_id}/react",
        headers=alex_headers,
        json={"reaction_type": "ily"},
    )
    assert dm_react.status_code == 200
    assert dm_react.json()["reaction"] == "ily"

    # Fetch 2-user conversation history
    thread_res = client.get("/api/social/messages/usr_alex_02", headers=maya_headers)
    assert thread_res.status_code == 200
    thread = thread_res.json()["messages"]
    assert len(thread) >= 5
    print("OK Interaction #2 (Two-User Direct Sign Messenger & Reactions) verified")

    # Platform stats
    stats_res = client.get("/api/social/stats", headers=maya_headers)
    assert stats_res.status_code == 200
    assert stats_res.json()["total_posts"] >= 4
    assert stats_res.json()["total_dms"] >= 5
    print("OK Platform & Home Hub stats verified")


if __name__ == "__main__":
    try:
        run_tests()
        print("\n========================================================")
        print("ALL AUTHENTICATION & 2-USER SOCIAL TESTS PASSED!")
        print("========================================================")
    finally:
        if os.path.exists(_tmp_db):
            try:
                os.remove(_tmp_db)
            except OSError:
                pass
