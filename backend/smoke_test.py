"""End-to-end smoke test for the new AIDLC endpoints (git-remote, mode, terminal).

Starts the backend on a private port with a test proxy secret, then drives the
HMAC-authenticated endpoints with a real HTTP client. Verifies the terminal
PTY/pipe bridge end-to-end: spawn (interactive shell) -> stream (SSE) -> input
(echo) -> input (exit) -> exit event -> resize -> kill.

Run:  python _t_http.py
"""

import base64
import hashlib
import hmac
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
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


def send_input(tid, text):
    st, _ = call("POST", "/api/terminals/%s/input" % tid, {"data": base64.b64encode(text.encode()).decode()})
    assert st == 200, "input status %s" % st


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

    # terminal: spawn an interactive shell, stream it in a background thread
    st, tsess = call("POST", "/api/projects/%s/terminal" % pid, {"command": None})
    assert st == 201, "terminal spawn status %s" % st
    tid = tsess["terminal_id"]
    print("terminal:", tid, "pid", tsess.get("pid"), "shell", tsess.get("shell"))

    events = []          # (name, data-dict)
    stream_done = threading.Event()

    def read_stream():
        conn = http.client.HTTPConnection(HOST, PORT, timeout=30)
        path = "/api/terminals/%s/stream" % tid
        conn.request("GET", path, headers={"X-KiroCrew-Proxy": sign("GET", path, b"")})
        r = conn.getresponse()
        buf = b""
        while True:
            chunk = r.read(1024)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                raw, buf = buf.split(b"\n\n", 1)
                name, data = "", ""
                for ln in raw.decode("utf-8", "replace").split("\n"):
                    if ln.startswith("event: "):
                        name = ln[7:].strip()
                    elif ln.startswith("data: "):
                        data = ln[6:]
                if name:
                    events.append((name, json.loads(data) if data else {}))
        stream_done.set()

    sthread = threading.Thread(target=read_stream, daemon=True)
    sthread.start()

    # give the shell a moment to print a prompt, then drive it
    time.sleep(2.0)
    send_input(tid, "echo aidlc-e2e-ok\r")
    time.sleep(2.0)
    send_input(tid, "exit\r")

    # wait for the exit event (up to 20s)
    deadline = time.time() + 20
    exit_code = None
    while time.time() < deadline:
        for name, d in events:
            if name == "exit":
                exit_code = d.get("exit")
        if exit_code is not None:
            break
        time.sleep(0.2)
    stream_done.wait(timeout=5)

    out_blob = "".join(d.get("data", "") and base64.b64decode(d["data"]).decode("utf-8", "replace") for n, d in events if n == "out")
    saw_echo = "aidlc-e2e-ok" in out_blob
    print("stream: events=%d saw_echo=%s exit=%s" % (len(events), saw_echo, exit_code))
    assert saw_echo, "did not see echoed output in the stream"
    assert exit_code is not None, "no exit event"

    # resize + kill on a fresh interactive shell
    st, tsess2 = call("POST", "/api/projects/%s/terminal" % pid, {"command": None})
    tid2 = tsess2["terminal_id"]
    st, r = call("POST", "/api/terminals/%s/resize" % tid2, {"cols": 100, "rows": 30})
    assert st == 200, "resize status %s" % st
    st, r = call("DELETE", "/api/terminals/%s" % tid2)
    assert st == 200 and r["ok"], "kill status %s" % r
    print("resize/kill: ok")

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
