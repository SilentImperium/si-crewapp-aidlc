"""End-to-end smoke test for the new AIDLC endpoints (git-remote, mode, terminal).

Starts the backend on a private port with a test proxy secret, then drives the
HMAC-authenticated endpoints with a real HTTP client. Verifies the external
terminal launcher: open-terminal (plain shell) and open-terminal (with a
command) - each spawns a native terminal window outside the app.

Run:  python smoke_test.py
"""

import hashlib
import hmac
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 9149
SECRET = "test-proxy-secret"
HOST = "127.0.0.1"
BASE = "http://%s:%d" % (HOST, PORT)

env = dict(os.environ)
env["KIROCREW_PROXY_SECRET"] = SECRET
env["PORT"] = str(PORT)
env["KIROCREW_HOME"] = tempfile.mkdtemp(prefix="aidlc-test-")

proc = subprocess.Popen(
    [sys.executable, os.path.join(HERE, "server.py")],
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)


def sign(method, path, body_bytes):
    ts = str(int(time.time()))
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    msg = "%s:%s:%s:%s" % (ts, method, path, body_hash)
    sig = hmac.new(SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return "%s:%s" % (ts, sig)


def call(method, path, body=None):
    body_bytes = (json.dumps(body).encode() if body is not None else b"")
    headers = {"X-KiroCrew-Proxy": sign(method, path, body_bytes)}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=body_bytes, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def main():
    # wait for health
    for _ in range(50):
        try:
            with urllib.request.urlopen(BASE + "/health", timeout=2) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(0.2)
    else:
        print("FAIL: server did not come up")
        return 1

    # create a project pointing at this backend folder (a real dir with a git remote)
    st, proj = call("POST", "/api/projects", {"name": "t", "path": HERE, "create": False})
    pid = proj["id"]
    print("project:", pid)

    # git-remote (this folder has a real origin -> owner/repo parsed)
    st, gr = call("GET", "/api/projects/%s/git-remote" % pid)
    assert st == 200 and gr.get("owner"), "git-remote: %s" % gr
    print("git-remote:", gr)

    # mode: solo -> crew (with a crew ref) -> solo (crew cleared)
    st, m = call("POST", "/api/projects/%s/mode" % pid, {"mode": "crew", "crew": {"id": "c1", "name": "t-crew", "owner": "o", "repo": "r"}})
    assert st == 200 and m["mode"] == "crew" and m["crew"]["id"] == "c1", "mode set: %s" % m
    st, m2 = call("POST", "/api/projects/%s/mode" % pid, {"mode": "solo"})
    assert st == 200 and m2["mode"] == "solo" and m2["crew"] is None, "mode solo: %s" % m2
    print("mode crew->solo: ok")

    # external terminal: spawn a native terminal window OUTSIDE the app
    st, ot = call("POST", "/api/projects/%s/open-terminal" % pid, {"command": None})
    assert st == 200 and ot.get("ok"), "open-terminal status %s: %s" % (st, ot)
    assert ot.get("launcher"), "no launcher reported: %s" % ot
    print("open-terminal:", ot["launcher"])

    # with a command (harness-style launch)
    st, ot2 = call("POST", "/api/projects/%s/open-terminal" % pid, {"command": "echo aidlc-e2e-ok"})
    assert st == 200 and ot2.get("ok"), "open-terminal (cmd) status %s: %s" % (st, ot2)
    print("open-terminal with command: ok")

    # files: read-only tree - noise dirs ignored, dirs first, nested walk works
    probe_dir = tempfile.mkdtemp(prefix="aidlc-files-")
    (pathlib.Path(probe_dir) / ".git").mkdir()
    (pathlib.Path(probe_dir) / "node_modules").mkdir()
    (pathlib.Path(probe_dir) / "src").mkdir()
    (pathlib.Path(probe_dir) / "src" / "main.py").write_text("print('hi')\n")
    (pathlib.Path(probe_dir) / "AGENTS.md").write_text("# agents\n")
    st, p2 = call("POST", "/api/projects", {"name": "ftree", "path": probe_dir, "create": False})
    pid2 = p2["id"]
    st, f2 = call("GET", "/api/projects/%s/files" % pid2)
    assert st == 200 and f2.get("tree", {}).get("type") == "dir", "files status %s: %s" % (st, f2)
    top = {c["name"] for c in f2["tree"].get("children", [])}
    assert top == {"src", "AGENTS.md"}, "files top-level (noise ignored): %s" % sorted(top)
    src = next(c for c in f2["tree"]["children"] if c["name"] == "src")
    assert [c["name"] for c in src.get("children", [])] == ["main.py"], "files nested: %s" % src
    call("DELETE", "/api/projects/%s" % pid2)
    shutil.rmtree(probe_dir, ignore_errors=True)
    print("files: tree ok (.git/node_modules ignored, nested walk ok)")

    # open-in-explorer: spawns the OS file manager (a window opens - harmless)
    st, oe = call("POST", "/api/projects/%s/open-in-explorer" % pid, {"path": None})
    assert st == 200 and oe.get("ok"), "open-in-explorer status %s: %s" % (st, oe)
    assert oe.get("launcher"), "no launcher reported: %s" % oe
    print("open-in-explorer:", oe["launcher"])

    # a subpath that escapes the project folder must be rejected with 400
    try:
        call("POST", "/api/projects/%s/open-in-explorer" % pid, {"path": "../.."})
        raise AssertionError("path escape was not rejected")
    except urllib.error.HTTPError as e:
        assert e.code == 400, "expected 400 for path escape, got %s" % e.code
    print("open-in-explorer path escape: rejected (400)")

    print("ALL OK")
    proc.terminate()
    return 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        if proc.poll() is None:
            proc.kill()
    sys.exit(code)
