"""SI AIDLC - embedded terminal bridge.

Spawns a local shell (optionally running the project's configured harness
agent) and streams its I/O to the UI's xterm.js over the gateway's SSE proxy:

  * POSIX  -> a real pseudo-terminal (``pty``), so interactive CLIs (opencode,
    kiro, ...) get a TTY and render properly; resize is a ``TIOCSWINSZ`` ioctl.
  * Windows-> a subprocess with pipes (no ``pty`` in the stdlib). Interactive
    CLIs still work over pipes; resize is best-effort (a no-op).

Stdlib only - the gateway spawns the backend with a scrubbed env and no
requirements.txt, so nothing here may need provisioning.

The session object is a plain dict (no class) so the SSE handler in
``server.py`` can read its queue directly:

  {
    "id":      str,
    "pid":     int,
    "shell":   str,
    "cwd":     str,
    "out_q":   queue.Queue,     # {"data": <b64>} | {"exit": <code>}
    "in_lock": threading.Lock,  # guards writes to the pty / stdin
    "done":    threading.Event, # set once the reader thread has drained
    # posix only: "master_fd": int
    # windows only: "proc": subprocess.Popen
  }
"""

from __future__ import annotations

import base64
import os
import queue
import shutil
import signal
import subprocess
import threading
import time
import uuid

IS_WINDOWS = os.name == "nt"

#: id -> session dict. Guarded by _LOCK for the map; each session guards its own
#: pty/stdin writes with its own in_lock.
SESSIONS: dict[str, dict] = {}
_LOCK = threading.RLock()

#: A spawned shell is given a real TERM so CLIs that gate color/interactive mode
#: on the terminal type behave.
_TERM = "xterm-256color"


def _pick_shell() -> str:
    """The interactive shell the terminal opens in (POSIX: bash>sh; Win: powershell)."""
    if IS_WINDOWS:
        return "powershell"
    for cand in ("/bin/bash", "/bin/zsh", "/bin/sh"):
        if os.path.exists(cand):
            return cand
    return "/bin/sh"


def _argv(shell: str, command: str | None, cwd: str) -> list[str]:
    """argv for *shell* running *command* (or an interactive shell when None)."""
    if not command:
        return [shell]
    if IS_WINDOWS:
        # powershell: -Command for a one-shot, -NoExit keeps the shell open after.
        return [shell, "-NoExit", "-Command", command]
    return [shell, "-c", command]


def spawn(
    cwd: str,
    command: str | None = None,
    env_extra: dict | None = None,
    cols: int = 80,
    rows: int = 24,
) -> dict:
    """Spawn a shell (optionally running *command*) in *cwd*; return the session.

    *cols*/*rows* seed the initial window size so interactive TUIs (opencode,
    kiro, ...) lay out at the real size instead of a 0x0 / 80x24 guess. The
    reader thread is started here; it feeds ``out_q`` with raw output chunks
    (the SSE stream coalesces + base64-encodes them) and, at the end, one
    ``{"exit": code}`` marker.
    """
    shell = _pick_shell()
    argv = _argv(shell, command, cwd)

    cols = max(2, min(int(cols), 500))
    rows = max(1, min(int(rows), 200))

    env = dict(os.environ)
    env.setdefault("TERM", _TERM)
    if env_extra:
        env.update(env_extra)

    tid = uuid.uuid4().hex[:12]
    sess: dict = {
        "id": tid,
        "pid": None,
        "shell": shell,
        "cwd": cwd,
        "command": command,
        "cols": cols,
        "rows": rows,
        "out_q": queue.Queue(),
        "in_lock": threading.Lock(),
        "done": threading.Event(),
        "created_at": time.time(),
    }

    if IS_WINDOWS:
        # No pty in the stdlib: a TUI over pipes at least reads LINES/COLUMNS
        # (Ink, some CLIs) to size its layout. Real ConPTY is a follow-up.
        env["LINES"] = str(rows)
        env["COLUMNS"] = str(cols)
        _spawn_windows(sess, argv, cwd, env)
    else:
        _spawn_posix(sess, argv, cwd, env, cols, rows)

    with _LOCK:
        SESSIONS[tid] = sess
    return sess


def _spawn_windows(sess: dict, argv: list[str], cwd: str, env: dict) -> None:
    proc = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    sess["proc"] = proc
    sess["pid"] = proc.pid

    def _reader() -> None:
        out_q = sess["out_q"]
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                # Raw bytes (not base64): the SSE stream coalesces whatever is
                # ready into one event and encodes it once - far cheaper than
                # one base64 + one SSE event per 4KB chunk.
                out_q.put({"data": chunk})
        except Exception:
            pass
        finally:
            try:
                code = proc.wait()
            except Exception:
                code = -1
            out_q.put({"exit": code})
            sess["done"].set()

    threading.Thread(target=_reader, name=f"aidlc-term-{sess['id']}", daemon=True).start()


def _spawn_posix(sess: dict, argv: list[str], cwd: str, env: dict) -> None:
    import fcntl  # posix-only, imported here so the module imports on Windows
    import pty
    import struct
    import termios

    pid, master_fd = pty.fork()
    if pid == 0:  # child: become the shell
        try:
            os.chdir(cwd)
        except OSError:
            os._exit(127)
        os.execvpe(argv[0], argv, env)
        os._exit(127)  # unreachable

    sess["master_fd"] = master_fd
    sess["pid"] = pid

    # Remember the initial size so a fresh pty is not 0x0 (which breaks some CLIs).
    try:
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    except OSError:
        pass

    def _reader() -> None:
        out_q = sess["out_q"]
        fd = master_fd
        try:
            while True:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                # Raw bytes (not base64): the SSE stream coalesces whatever is
                # ready into one event and encodes it once.
                out_q.put({"data": chunk})
        finally:
            code = -1
            try:
                _, status = os.waitpid(pid, 0)
                code = os.waitstatus_to_exitcode(status)
            except OSError:
                pass
            try:
                os.close(fd)
            except OSError:
                pass
            out_q.put({"exit": code})
            sess["done"].set()

    threading.Thread(target=_reader, name=f"aidlc-term-{sess['id']}", daemon=True).start()


def send_input(tid: str, data: bytes) -> None:
    """Write *data* to the session's stdin (pty master on POSIX, pipe on Windows)."""
    sess = get(tid)
    with sess["in_lock"]:
        if IS_WINDOWS:
            proc = sess.get("proc")
            if proc is not None and proc.stdin is not None:
                proc.stdin.write(data)
                proc.stdin.flush()
        else:
            fd = sess.get("master_fd")
            if fd is not None:
                os.write(fd, data)


def resize(tid: str, cols: int, rows: int) -> None:
    """Resize the pty (POSIX only; a no-op on Windows where there is no pty)."""
    if IS_WINDOWS:
        return
    import fcntl
    import struct
    import termios

    sess = get(tid)
    fd = sess.get("master_fd")
    if fd is None:
        return
    cols = max(1, min(int(cols), 500))
    rows = max(1, min(int(rows), 200))
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def kill(tid: str) -> bool:
    """Terminate the session's process; True if a live session was found."""
    with _LOCK:
        sess = SESSIONS.get(tid)
    if sess is None:
        return False
    try:
        if IS_WINDOWS:
            proc = sess.get("proc")
            if proc is not None and proc.poll() is None:
                proc.terminate()
        else:
            pid = sess.get("pid")
            if pid:
                os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass
    return True


def get(tid: str) -> dict:
    with _LOCK:
        sess = SESSIONS.get(tid)
    if sess is None:
        raise KeyError(tid)
    return sess


def has(tid: str) -> bool:
    with _LOCK:
        return tid in SESSIONS


def base64_decode(raw: str) -> bytes:
    try:
        return base64.b64decode(raw or "", validate=False)
    except Exception:
        return b""
