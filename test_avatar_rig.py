import sys
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

print("--- 1. Testing Static Assets & Template Routing ---")
res_js = client.get("/static/js/avatar_rig.js")
assert res_js.status_code == 200, f"Failed to get avatar_rig.js: {res_js.status_code}"
assert "SkinnedAvatarRenderer" in res_js.text, "SkinnedAvatarRenderer class missing from avatar_rig.js"
assert "OneEuroFilter" in res_js.text, "OneEuroFilter missing from avatar_rig.js"
assert "AnatomicalRetargeter" in res_js.text, "AnatomicalRetargeter missing from avatar_rig.js"
print("OK avatar_rig.js served with all components")

res_home = client.get("/")
assert res_home.status_code == 200, "Home page returned non-200"
assert "avatar_rig.js" in res_home.text, "avatar_rig.js missing from home page"
assert "hero-debug-toggle" in res_home.text, "hero-debug-toggle missing from home page"
print("OK home page includes avatar_rig.js and debug toggle")

res_dash = client.get("/dashboard")
assert res_dash.status_code == 200, "Dashboard returned non-200"
assert "avatar_rig.js" in res_dash.text, "avatar_rig.js missing from dashboard"
assert "skeleton-debug-toggle" in res_dash.text, "skeleton-debug-toggle missing from dashboard"
print("OK dashboard includes avatar_rig.js and debug toggle")

print("\n--- 2. Testing WebSocket Pipeline with Landmarks ---")
with client.websocket_connect("/ws/generate") as ws:
    ready = ws.receive_json()
    assert ready["type"] == "session_ready", f"Unexpected ready event: {ready}"
    
    ws.send_json({"type": "text", "text": "hello"})
    
    events = []
    while True:
        msg = ws.receive_json()
        events.append(msg["type"])
        if msg["type"] == "frames" and msg.get("final"):
            break
        if msg["type"] == "sequence_end":
            break

    assert "sequence_start" in events, "Missing sequence_start"
    assert "frames" in events, "Missing frames"
    print(f"OK WebSocket streamed motion sequence successfully: {events}")

print("\n==============================================")
print("ALL AVATAR RIG & INTEGRATION TESTS PASSED!")
print("==============================================")
