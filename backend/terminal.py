"""SI AIDLC - external terminal launcher.

Opens a native terminal window *outside* the app, in the project folder:

  * Windows -> Windows Terminal (``wt``) when installed, else a detached
    PowerShell console window (``CREATE_NEW_CONSOLE``). A real native
    terminal: full TTY, full speed - nothing is embedded in the app.
  * POSIX   -> xterm / konsole / gnome-terminal when available (best effort;
    this app is Windows-first).

The window is fully detached: it keeps living after the backend exits, and
closing it never affects the app. Stdlib only - the gateway spawns the
backend with a scrubbed env and no requirements.txt, so nothing here may
need provisioning.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys

IS_WINDOWS = os.name == "nt"

#: Windows: new console window, independent of our process.
CREATE_NEW_CONSOLE = 0x00000008


def _windows_fresh_path() -> str | None:
    """The *current* user+system PATH, read fresh from the registry.

    The gateway spawns the backend with a scrubbed/stale environment, so the
    inherited PATH can miss tools the user installed afterwards (kiro,
    opencode, ...). The registry is the authoritative source: read the user
    and system Path values (REG_EXPAND_SZ, so expand ``%VARS%``) and merge
    them with this process's own directory. Returns None when the registry
    can't be read (fall back to the inherited PATH).
    """
    import winreg

    def _read(root, subkey: str) -> str:
        try:
            with winreg.OpenKey(root, subkey) as k:
                val, _ = winreg.QueryValueEx(k, "Path")
                return str(val) if val else ""
        except OSError:
            return ""

    user = _read(winreg.HKEY_CURRENT_USER, r"Environment")
    system = _read(
        winreg.HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    )
    parts = [p for p in (system, user) if p]
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    if exe_dir:
        parts.append(exe_dir)
    merged = os.pathsep.join(parts)
    return os.path.expandvars(merged) if merged else None


def _pick_launcher() -> tuple[list[str], str]:
    """(argv-prefix, name) for the native terminal on this machine."""
    if IS_WINDOWS:
        wt = shutil.which("wt")
        if wt:
            return [wt], "windows-terminal"
        pwsh = shutil.which("powershell")
        return [pwsh or "powershell"], "powershell"
    for cand in ("x-terminal-emulator", "konsole", "gnome-terminal", "xterm"):
        if shutil.which(cand):
            return [cand], cand
    return [], "none"


def open_external(cwd: str, command: str | None = None) -> dict:
    """Spawn a native terminal in *cwd*, optionally running *command*.

    Returns ``{"ok": True, "launcher": <name>, "command": <cmd|None>}``.
    Raises RuntimeError when no native terminal is available.
    """
    base, name = _pick_launcher()
    if not base:
        raise RuntimeError("no native terminal found (install Windows Terminal)")

    env = dict(os.environ)
    if IS_WINDOWS:
        # The inherited PATH is often stale (the host process may have started
        # before the user installed kiro/opencode). Prefer the fresh registry
        # value so tools on the user/system PATH are actually found.
        fresh = _windows_fresh_path()
        if fresh:
            env["PATH"] = fresh

    devnull = subprocess.DEVNULL

    if name == "windows-terminal":
        # wt -d <dir> [command...] - a new window, default profile, in cwd.
        argv = [base[0], "-d", cwd]
        if command:
            argv.append(command)
        subprocess.Popen(
            argv, env=env, close_fds=True,
            stdin=devnull, stdout=devnull, stderr=devnull,
        )
        return {"ok": True, "launcher": name, "command": command}

    if name == "powershell":
        argv = [base[0], "-NoLogo"]
        if command:
            argv += ["-NoExit", "-Command", command]
        subprocess.Popen(
            argv, cwd=cwd, env=env, creationflags=CREATE_NEW_CONSOLE,
            close_fds=True, stdin=devnull, stdout=devnull, stderr=devnull,
        )
        return {"ok": True, "launcher": name, "command": command}

    # POSIX (best effort): wrap in sh so the cwd + command are honoured.
    inner = "cd %s" % shlex.quote(cwd)
    if command:
        inner += " && " + shlex.quote(command)
    argv = base + (["-e", "sh", "-c", inner] if name in ("xterm", "konsole") else ["--", inner])
    subprocess.Popen(
        argv, env=env, close_fds=True,
        stdin=devnull, stdout=devnull, stderr=devnull,
    )
    return {"ok": True, "launcher": name, "command": command}
