#!/usr/bin/env python3
"""SI AIDLC - Kiro Crew app backend.

Folder-first AI-DLC studio for Windows and Linux. The app:

  * detects (and can install) the native ``aidlc`` CLI,
  * manages a registry of local *project folders* (git is optional and
    deliberately a later step),
  * runs ``aidlc config --harness <h>`` with the user's chosen effort
    preset and workflow profile,
  * runs ``aidlc doctor`` and parses AI-DLC's on-disk state
    (read-only: this app never mutates AI-DLC state, audit or artifacts),
  * streams all CLI output to an SSE log.

The Kiro Crew gateway reverse-proxies ``/apps/si-crewapp-aidlc/api/*`` to this
server and signs every proxied request with an HMAC we verify before
touching anything.

Endpoints (as seen by the gateway, which prepends /api/):
  GET    /health                  open liveness probe
  GET    /api/state               projects + cli + git + active job
  GET    /api/cli                 cli/git detection + install command
  POST   /api/cli/install         install/upgrade the aidlc CLI (job)
  POST   /api/projects            add a project folder
  DELETE /api/projects/<id>       remove from registry (folder untouched)
  POST   /api/projects/<id>/setup-preview  CLI transaction plan (--dry-run, read-only)
  POST   /api/projects/<id>/setup    aidlc config + preset + doctor (job)
  POST   /api/projects/<id>/doctor   run aidlc doctor now
  GET    /api/projects/<id>/state    read-only dashboard state
  POST   /api/projects/<id>/git-init  optional git init + first commit (job)
  GET    /api/logs/tail           ?after=<seq>&limit=<n>
  GET    /api/logs/stream         SSE: "line" events, 15s heartbeats

Stdlib only - the gateway spawns this with a scrubbed env and no
requirements.txt, so nothing may need provisioning.

Env set by the gateway at spawn:
  PORT                   loopback port to bind (allocated from 9100-9200)
  KIROCREW_APP_NAME      the app name
  KIROCREW_HOME          the Kiro Crew config directory
  KIROCREW_PROXY_SECRET  shared secret for X-KiroCrew-Proxy verification
"""

import hashlib
import hmac
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Sibling backend modules (same directory). server.py is the entry point the
# gateway spawns, so its own directory is sys.path[0] and these import cleanly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge
import terminal

APP_NAME = os.environ.get("KIROCREW_APP_NAME", "si-crewapp-aidlc")
APP_VERSION = "0.1.0"
PROXY_SECRET = os.environ.get("KIROCREW_PROXY_SECRET", "")
MAX_SKEW_S = 60
LOG_RING_SIZE = 2000

DATA_DIR = Path(os.environ.get("KIROCREW_HOME", str(Path.home() / ".kiro" / "crew"))) / "apps" / APP_NAME / "data"
STATE_FILE = DATA_DIR / "projects.json"
JOBS_FILE = DATA_DIR / "jobs.json"

IS_WINDOWS = os.name == "nt"

# harnesses the native engine ships glue for (matches `aidlc config --help`)
HARNESSES = ["kiro", "kiro-v2", "opencode", "claude", "codex", "cursor", "copilot"]
PRESETS = ["minimal", "balanced", "thorough"]
# workflow profiles: slug -> (label, stages-executed-of-33, blurb)
SCOPES = {
    "express": ("Express", 10, "Shortest requirements-to-code-and-test path"),
    "bugfix": ("Bugfix", 9, "Known defect: focused fix + regression test"),
    "refactor": ("Refactor", 7, "Improve code without changing behavior"),
    "poc": ("Proof of concept", 5, "Smallest useful path to test feasibility"),
    "security-patch": ("Security patch", 7, "CVE or focused vulnerability response"),
    "classic": ("Classic", 18, "Inception + Construction ceremony (the implicit default)"),
    "infra": ("Infrastructure", 10, "Environments, IaC, deployment foundations, cost work"),
    "mvp": ("MVP", 20, "A real first increment, without the Operation phase"),
    "feature": ("Feature", 30, "A production feature using the complete lifecycle"),
    "workshop": ("Workshop", 23, "A facilitated training or group delivery session"),
    "enterprise": ("Enterprise", 33, "Regulated / high-assurance work, full traceability"),
}

LAUNCH_HINTS = {
    "kiro": "kiro-cli chat",
    "kiro-v2": "kiro-cli chat   (Kiro CLI on its V2 engine)",
    "opencode": "opencode",
    "claude": "claude",
    "codex": "codex",
    "cursor": "Open the project in Cursor, then run /aidlc",
    "copilot": "Open the project in GitHub Copilot Chat, then run /aidlc",
}

INSTALL_CMD = (
    "powershell -NoProfile -Command \"irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex\""
    if IS_WINDOWS
    else "sh -c \"curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh\""
)

LOCK = threading.RLock()
RING = deque(maxlen=LOG_RING_SIZE)          # (seq, text)
WATCHERS = []                               # queue.Queue per SSE client
SEQ = 0
STATE = {"projects": []}
JOBS = {}                                   # id -> job record
JOB = None                                  # the single active job (or None)
SERVER = None


class ApiError(Exception):
    def __init__(self, status, msg, extra=None):
        super().__init__(msg)
        self.status = status
        self.msg = msg
        self.extra = extra or {}


# ---------------------------------------------------------------------------
# state persistence


def _load_state():
    global STATE
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE = {"projects": []}
    if STATE_FILE.exists():
        try:
            d = json.loads(STATE_FILE.read_text())
            if isinstance(d, dict):
                STATE["projects"] = [p for p in d.get("projects", []) if isinstance(p, dict)]
        except Exception:
            print("[si-crewapp-aidlc] projects.json unreadable; starting fresh", flush=True)
    if JOBS_FILE.exists():
        try:
            for j in json.loads(JOBS_FILE.read_text()):
                if isinstance(j, dict) and j.get("id"):
                    # a job recorded as running is stale after a restart
                    if j.get("status") == "running":
                        j["status"] = "failed"
                        j["summary"] = "backend restarted while job was running"
                    JOBS[j["id"]] = j
        except Exception:
            pass


def _save_state():
    """Caller must hold LOCK."""
    tmp = STATE_FILE.with_name(STATE_FILE.name + ".tmp")
    tmp.write_text(json.dumps(STATE, indent=2))
    tmp.replace(STATE_FILE)


def _save_jobs():
    """Caller must hold LOCK."""
    try:
        tmp = JOBS_FILE.with_name(JOBS_FILE.name + ".tmp")
        tmp.write_text(json.dumps(list(JOBS.values()), indent=2))
        tmp.replace(JOBS_FILE)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# log buffer


def _append_line(text):
    global SEQ
    with LOCK:
        SEQ += 1
        seq = SEQ
        RING.append((seq, text))
        for q in list(WATCHERS):
            try:
                q.put_nowait(("line", {"seq": seq, "text": text}))
            except Exception:
                pass


def tail_logs(qs):
    try:
        after = int((qs.get("after") or ["0"])[0])
    except (ValueError, IndexError):
        after = 0
    try:
        limit = int((qs.get("limit") or ["300"])[0])
    except (ValueError, IndexError):
        limit = 300
    limit = max(1, min(limit, 1000))
    with LOCK:
        lines = [list(it) for it in RING if it[0] > after][-limit:]
        seq = SEQ
    return {"lines": lines, "next": seq}


# ---------------------------------------------------------------------------
# cli / git detection


def _cli_version():
    try:
        r = subprocess.run(
            ["aidlc", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            timeout=15,
        )
        out = r.stdout.decode("utf-8", "replace").strip()
        m = re.search(r"(\d+\.\d+[\w.-]*)", out)
        return m.group(1) if m else (out[:64] or None)
    except Exception:
        return None


def cli_info():
    path = shutil.which("aidlc")
    git_path = shutil.which("git")
    return {
        "platform": "windows" if IS_WINDOWS else "linux",
        "aidlc": {
            "installed": bool(path),
            "path": path,
            "version": _cli_version() if path else None,
        },
        "git": {
            "installed": bool(git_path),
            "version": (
                subprocess.run(
                    ["git", "--version"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                    timeout=10,
                ).stdout.decode("utf-8", "replace").strip()
                if git_path
                else None
            ),
        },
        "install_command": INSTALL_CMD,
    }


# ---------------------------------------------------------------------------
# projects


def _slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s[:32] or "project"


def _validate_project_path(raw, create=False):
    p = str(raw or "").strip()
    if not p:
        raise ApiError(400, "path is required")
    p = os.path.expanduser(p)
    try:
        p = os.path.normpath(p)
    except Exception:
        raise ApiError(400, "invalid path")
    if len(p) > 512:
        raise ApiError(400, "path too long (max 512)")
    if create:
        Path(p).mkdir(parents=True, exist_ok=True)
    if not os.path.isdir(p):
        raise ApiError(400, "folder does not exist: %s (tick 'create folder' to make it)" % p)
    return p


def create_project(d):
    p = _validate_project_path(d.get("path"), create=bool(d.get("create")))
    name = str(d.get("name") or "").strip() or Path(p).name
    if len(name) > 64:
        raise ApiError(400, "name too long (max 64)")
    with LOCK:
        for proj in STATE["projects"]:
            if os.path.normpath(str(proj.get("path", ""))) == p:
                raise ApiError(409, "a project at this folder is already registered")
        proj = {
            "id": "%s-%s" % (_slugify(name), uuid.uuid4().hex[:6]),
            "name": name,
            "path": p,
            "harness": None,
            "preset": None,
            "scope": None,
            "setup_done": False,
            "git": os.path.isdir(os.path.join(p, ".git")),
            # "solo" = just you + the harness; "crew" = a named issue-radar crew
            # is enabled on this repo and wakes on new issues.
            "mode": "solo",
            "crew": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        STATE["projects"].append(proj)
        _save_state()
    _append_line("[si-crewapp-aidlc] project added: %s (%s)" % (name, p))
    return proj


def get_project(pid):
    with LOCK:
        proj = next((p for p in STATE["projects"] if p.get("id") == pid), None)
    if proj is None:
        raise ApiError(404, "no such project: %s" % pid)
    return proj


def delete_project(pid):
    with LOCK:
        before = len(STATE["projects"])
        STATE["projects"] = [p for p in STATE["projects"] if p.get("id") != pid]
        if len(STATE["projects"]) == before:
            raise ApiError(404, "no such project: %s" % pid)
        _save_state()
    _append_line("[si-crewapp-aidlc] project removed from registry: %s (folder untouched)" % pid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# jobs (one at a time)


def _start_job(kind, project_id=None):
    global JOB
    with LOCK:
        if JOB is not None:
            raise ApiError(409, "a job is already running: %s" % JOB["kind"])
        job = {
            "id": uuid.uuid4().hex[:10],
            "kind": kind,
            "project_id": project_id,
            "status": "running",
            "started_at": time.time(),
            "finished_at": None,
            "exit_code": None,
            "summary": None,
        }
        JOB = job
        JOBS[job["id"]] = job
        _save_jobs()
    return job


def _finish_job(job, ok, summary, exit_code=None):
    global JOB
    with LOCK:
        job["status"] = "done" if ok else "failed"
        job["finished_at"] = time.time()
        job["exit_code"] = exit_code
        job["summary"] = summary
        if JOB is job:
            JOB = None
        _save_jobs()
    _append_line(
        "[si-crewapp-aidlc] job %s %s: %s" % (job["kind"], job["status"], summary or "")
    )
    return job


def _run_cmd(argv, cwd, timeout, label):
    """Run a command, streaming output to the log ring. Returns (exit_code, output)."""
    _append_line("[si-crewapp-aidlc] $ %s   (cwd: %s)" % (" ".join(argv), cwd))
    proc = subprocess.Popen(
        argv,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    lines = []
    try:
        for line in proc.stdout:
            text = line.rstrip("\n")
            if text:
                lines.append(text)
                _append_line("[%s] %s" % (label, text))
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise ApiError(504, "%s timed out after %ds" % (label, timeout))
    return proc.returncode, "\n".join(lines)


def _apply_preset(project_dir, preset, label="preset"):
    """Record the effort preset through the CLI (writes aidlc.settings.json)."""
    code, out = _run_cmd(
        ["aidlc", "config", "models", "--project-dir", project_dir, "--preset", preset, "--project", "--yes"],
        project_dir,
        120,
        label,
    )
    if code != 0:
        _append_line("[si-crewapp-aidlc] preset not recorded (aidlc config models exited %d) - continuing" % code)
    return code


def job_setup(job):
    """aidlc config -> models preset -> aidlc doctor."""
    proj = get_project(job["project_id"])
    p = proj["path"]
    harness = proj.get("harness") or "kiro"
    preset = proj.get("preset") or "balanced"
    scope = proj.get("scope") or "express"
    if not shutil.which("aidlc"):
        return _finish_job(job, False, "aidlc CLI not found on PATH - install it first")
    try:
        code, out = _run_cmd(
            ["aidlc", "config", "--project-dir", p, "--harness", harness, "--yes"],
            p,
            600,
            "config",
        )
        if code != 0:
            return _finish_job(job, False, "aidlc config exited %d" % code, code)
        _apply_preset(p, preset)
        _append_line("[si-crewapp-aidlc] recorded preset=%s (default scope hint: %s - pass it at workflow start)" % (preset, scope))
        dcode, dout = _run_cmd(["aidlc", "doctor"], p, 300, "doctor")
        with LOCK:
            proj["setup_done"] = True
            proj["updated_at"] = time.time()
            _save_state()
        summary = "setup complete" + ("" if dcode == 0 else " (doctor exited %d - see log)" % dcode)
        return _finish_job(job, dcode == 0, summary, dcode)
    except ApiError as e:
        return _finish_job(job, False, e.msg, e.status)
    except Exception as e:
        return _finish_job(job, False, "setup crashed: %s" % e, None)


def setup_preview(pid, harness):
    """Read-only preview: the CLI's own transaction plan (--dry-run)."""
    proj = get_project(pid)
    if not shutil.which("aidlc"):
        raise ApiError(409, "aidlc CLI not found on PATH - install it first")
    try:
        code, out = _run_cmd(
            ["aidlc", "config", "--project-dir", proj["path"], "--harness", harness, "--dry-run"],
            proj["path"],
            120,
            "preview",
        )
    except ApiError as e:
        raise e
    return {"ok": code == 0, "exit_code": code, "plan": out}


def job_install(job):
    """Install/upgrade the native aidlc CLI for this platform."""
    if IS_WINDOWS:
        argv = [
            "powershell",
            "-NoProfile",
            "-Command",
            "irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex",
        ]
    else:
        argv = [
            "sh",
            "-c",
            "curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh",
        ]
    try:
        code, out = _run_cmd(argv, str(Path.home()), 900, "install")
        ok = code == 0
        return _finish_job(job, ok, "install finished" if ok else "install exited %d" % code, code)
    except ApiError as e:
        return _finish_job(job, False, e.msg, e.status)
    except Exception as e:
        return _finish_job(job, False, "install crashed: %s" % e, None)


def job_git_init(job):
    """Optional second step: turn the folder into a git repo with a first commit."""
    proj = get_project(job["project_id"])
    p = proj["path"]
    if not shutil.which("git"):
        return _finish_job(job, False, "git not found on PATH")
    try:
        if not os.path.isdir(os.path.join(p, ".git")):
            code, out = _run_cmd(["git", "init"], p, 60, "git-init")
            if code != 0:
                return _finish_job(job, False, "git init exited %d" % code, code)
        code, out = _run_cmd(["git", "add", "-A"], p, 300, "git-add")
        if code == 0:
            code, out = _run_cmd(
                ["git", "commit", "-m", "Initial commit (AI-DLC project)"], p, 300, "git-commit"
            )
            if code != 0:
                _append_line("[si-crewapp-aidlc] no commit created (nothing to commit?)")
        with LOCK:
            proj["git"] = True
            proj["updated_at"] = time.time()
            _save_state()
        return _finish_job(job, True, "git repository ready")
    except ApiError as e:
        return _finish_job(job, False, e.msg, e.status)
    except Exception as e:
        return _finish_job(job, False, "git-init crashed: %s" % e, None)


JOB_KINDS = {"setup": job_setup, "install": job_install, "git-init": job_git_init}


def start_job(kind, project_id=None):
    if kind not in JOB_KINDS:
        raise ApiError(400, "unknown job kind: %s" % kind)
    if project_id:
        get_project(project_id)  # 404 if missing
    job = _start_job(kind, project_id)
    threading.Thread(target=JOB_KINDS[kind], args=(job,), daemon=True).start()
    return job


def run_doctor_now(pid):
    proj = get_project(pid)
    if not shutil.which("aidlc"):
        raise ApiError(409, "aidlc CLI not found on PATH - install it first")
    try:
        code, out = _run_cmd(["aidlc", "doctor"], proj["path"], 300, "doctor")
    except ApiError as e:
        raise e
    return {"ok": code == 0, "exit_code": code, "raw": out, "at": time.time()}


# ---------------------------------------------------------------------------
# read-only dashboard state


def _read_json(path):
    try:
        d = json.loads(Path(path).read_text())
        return d if d is not None else None
    except Exception:
        return None


def _read_text(path, max_bytes=400_000):
    try:
        p = Path(path)
        if not p.is_file():
            return None
        data = p.read_bytes()[:max_bytes]
        return data.decode("utf-8", "replace")
    except Exception:
        return None


def _normalize_stage_graph(raw):
    """Return a list of stage dicts (slug, number, name, phase, execution, scopes)."""
    stages = None
    if isinstance(raw, list):
        stages = raw
    elif isinstance(raw, dict):
        for key in ("stages", "items", "nodes"):
            if isinstance(raw.get(key), list):
                stages = raw[key]
                break
        if stages is None and raw.get("slug"):
            stages = [raw]
    if not stages:
        return []
    out = []
    for s in stages:
        if not isinstance(s, dict):
            continue
        out.append(
            {
                "slug": str(s.get("slug") or s.get("id") or ""),
                "number": str(s.get("number") or s.get("num") or ""),
                "name": str(s.get("name") or s.get("title") or s.get("slug") or ""),
                "phase": str(s.get("phase") or "unknown"),
                "execution": str(s.get("execution") or ""),
                "lead_agent": s.get("lead_agent") or s.get("leadAgent") or "",
                "scopes": [str(x) for x in s.get("scopes", [])] if isinstance(s.get("scopes"), list) else [],
            }
        )
    out.sort(key=lambda s: (s["number"] or "99", s["slug"]))
    return out


def _normalize_scope_grid(raw):
    """Normalize scope-grid to {stage_slug: {scope: 'EXECUTE'|'SKIP'}}.

    Handles {stage: {scope: v}}, {scope: {stage: v}} and the shipped
    {scope: {"stages": {stage: v}}} shape.
    """
    if not isinstance(raw, dict):
        return {}
    out = {}
    # shape A: {stage: {scope: v}}
    for k, v in raw.items():
        if isinstance(v, dict) and any(
            isinstance(sv, str) and sv.upper() in ("EXECUTE", "SKIP") for sv in v.values()
        ):
            out[str(k)] = {str(sk).lower(): str(sv).upper() for sk, sv in v.items()}
    if out:
        return out
    # shape B: {scope: {stage: v}} or {scope: {"stages": {stage: v}}}
    for scope, val in raw.items():
        if not isinstance(val, dict):
            continue
        stage_map = val.get("stages") if isinstance(val.get("stages"), dict) else val
        for stage, v in stage_map.items():
            if isinstance(v, str):
                cell = out.setdefault(str(stage), {})
                cell[str(scope).lower()] = v.upper()
    return out


def _parse_state_file(text):
    """Best-effort parse of aidlc-state.md. Returns dict or None."""
    if not text:
        return None
    found = {}
    m = re.search(r"""current[_\s-]*stage["' ]*[:=]\s*["']?([A-Za-z0-9._-]+)""", text, re.I)
    if m:
        found["current_stage"] = m.group(1)
    m = re.search(r"""active[_\s-]*intent["' ]*[:=]\s*["']?([A-Za-z0-9._-]+)""", text, re.I)
    if m:
        found["active_intent"] = m.group(1)
    m = re.search(r"""workspace[_\s-]*scaffold["' ]*[:=]\s*["']?([A-Za-z0-9._-]+)""", text, re.I)
    statuses = {}
    for sm in re.finditer(
        r"""^\s*[-*]?\s*(?P<num>\d+(?:\.\d+)?)\s+(?P<name>[A-Z][A-Za-z0-9 -]{2,40}?)\s*[:|]\s*(?P<st>[A-Za-z]+)""",
        text,
        re.M,
    ):
        st = sm.group("st").upper()
        if st in ("DONE", "COMPLETE", "COMPLETED", "PENDING", "CURRENT", "IN", "PROGRESS", "SKIPPED", "RUNNING", "WAITING", "FAILED"):
            statuses[sm.group("name").strip()] = st
    if statuses:
        found["stage_statuses"] = statuses
    if not found:
        return None
    return found


def _open_questions(text):
    """Count unanswered [Answer]: markers in a questions file."""
    if not text:
        return 0
    n = 0
    for line in text.splitlines():
        if re.search(r"\[Answer\]\s*:", line, re.I):
            tail = line.split("[Answer]:", 1)[-1].strip() if "[Answer]:" in line else ""
            if not tail:
                n += 1
    return n


def project_state(pid):
    proj = get_project(pid)
    p = Path(proj["path"])
    cli = cli_info()

    stamp = _read_json(p / ".aidlc" / "tools" / "data" / "aidlc-stamp.json")
    settings = _read_json(p / "aidlc.settings.json")
    graph = _normalize_stage_graph(_read_json(p / ".aidlc" / "tools" / "data" / "stage-graph.json"))
    grid = _normalize_scope_grid(_read_json(p / ".aidlc" / "tools" / "data" / "scope-grid.json"))

    space = "default"
    raw_space = _read_text(p / "aidlc" / "active-space", 64)
    if raw_space and raw_space.strip():
        space = raw_space.strip()

    intent_dir = p / "aidlc" / "spaces" / space / "intents"
    intents = []
    if intent_dir.is_dir():
        for d in sorted(intent_dir.iterdir()):
            if d.is_dir() and not d.name.startswith("."):
                intents.append(d.name)

    state_file = None
    state_raw = None
    state_parsed = None
    q_file = None
    q_open = 0
    audit_tail = []
    if intents:
        active = intents[-1]
        idir = intent_dir / active
        for cand in (
            p / "aidlc-state.md",
            idir / "aidlc-state.md",
            idir / "state" / "aidlc-state.md",
        ):
            state_raw = _read_text(str(cand))
            if state_raw:
                state_file = str(cand.relative_to(p))
                state_parsed = _parse_state_file(state_raw)
                break
        for qname in ("questions.md", "questions-open.md", "open-questions.md"):
            q_raw = _read_text(str(idir / qname))
            if q_raw is not None:
                q_file = qname
                q_open = _open_questions(q_raw)
                break
        adir = idir / "audit"
        if adir.is_dir():
            shards = sorted(adir.glob("*.md"), key=lambda f: f.stat().st_mtime)
            if shards:
                tail = _read_text(str(shards[-1]), 200_000)
                if tail:
                    audit_tail = tail.splitlines()[-50:]

    scope = proj.get("scope")
    scope_info = SCOPES.get(scope)
    # effective plan: prefer each stage's own `scopes` list (shipped shape),
    # fall back to the scope grid, fall back to showing everything
    effective = []
    if scope:
        for s in graph:
            if s["scopes"]:
                if scope in s["scopes"]:
                    effective.append(s)
            else:
                cell = grid.get(s["slug"])
                if not cell or not cell.get(scope) or cell[scope] == "EXECUTE":
                    effective.append(s)

    launch = LAUNCH_HINTS.get(proj.get("harness") or "kiro", "kiro-cli chat")
    if scope and scope_info:
        launch = "%s   (suggest: /aidlc --scope %s)" % (launch, scope)

    return {
        "project": proj,
        "cli": cli,
        "stamp": stamp,
        "settings": settings,
        "space": space,
        "intents": intents,
        "stages": graph,
        "effective_stages": effective,
        "scope_grid": grid,
        "scope": scope,
        "scope_info": (
            {"label": scope_info[0], "stages": scope_info[1], "blurb": scope_info[2]}
            if scope_info
            else None
        ),
        "state_file": state_file,
        "state_raw": state_raw,
        "state_parsed": state_parsed,
        "questions_file": q_file,
        "questions_open": q_open,
        "audit_tail": audit_tail,
        "launch": launch,
        "at": time.time(),
    }


# ---------------------------------------------------------------------------
# state snapshot


def state_snapshot():
    with LOCK:
        projects = [dict(p) for p in STATE["projects"]]
        job = dict(JOB) if JOB else None
        last_jobs = sorted(JOBS.values(), key=lambda j: j.get("started_at") or 0)[-5:]
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "now": time.time(),
        "projects": projects,
        "job": job,
        "recent_jobs": last_jobs,
        "cli": cli_info(),
        "log_seq": SEQ,
        "harnesses": HARNESSES,
        "presets": PRESETS,
        "scopes": [
            {"id": k, "label": v[0], "stages": v[1], "blurb": v[2]} for k, v in SCOPES.items()
        ],
    }


# ---------------------------------------------------------------------------
# HTTP


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ZensAIDLC/" + APP_VERSION
    timeout = 60

    def log_message(self, fmt, *args):
        print("[zens-http] %s %s" % (self.address_string(), fmt % args), file=sys.stderr, flush=True)

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _json(self, status, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _authorized(self, body):
        if not PROXY_SECRET:
            return False
        header = self.headers.get("X-KiroCrew-Proxy", "")
        parts = header.split(":", 1)
        if len(parts) != 2:
            return False
        ts, sig = parts
        try:
            ts_i = int(ts)
        except ValueError:
            return False
        if abs(time.time() - ts_i) > MAX_SKEW_S:
            return False
        body_hash = hashlib.sha256(body).hexdigest()
        msg = "%s:%s:%s:%s" % (ts, self.command, self.path, body_hash)
        expected = hmac.new(PROXY_SECRET.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)

    # -- routing ------------------------------------------------------------

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method):
        body = self._body()
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/health":
                return self._json(
                    200,
                    {"ok": True, "app": APP_NAME, "version": APP_VERSION, "pid": os.getpid()},
                )
            if not path.startswith("/api/"):
                return self._json(404, {"error": "not found"})
            if not self._authorized(body):
                return self._json(401, {"error": "proxy authentication failed"})
            api = path[len("/api/"):]
            qs = parse_qs(parsed.query)

            if method == "GET" and api == "state":
                return self._json(200, state_snapshot())
            if method == "GET" and api == "cli":
                return self._json(200, cli_info())
            if method == "POST" and api == "cli/install":
                return self._json(202, start_job("install"))
            if method == "POST" and api == "projects":
                return self._json(201, create_project(_json_body(body)))
            m = re.fullmatch(r"projects/([^/]+)", api)
            if m:
                if method == "DELETE":
                    return self._json(200, delete_project(m.group(1)))
            m = re.fullmatch(r"projects/([^/]+)/setup", api)
            if m and method == "POST":
                d = _json_body(body)
                pid = m.group(1)
                proj = get_project(pid)
                harness = str(d.get("harness") or "kiro")
                preset = str(d.get("preset") or "balanced")
                scope = str(d.get("scope") or "express")
                if harness not in HARNESSES:
                    raise ApiError(400, "unknown harness: %s" % harness)
                if preset not in PRESETS:
                    raise ApiError(400, "unknown preset: %s" % preset)
                if scope not in SCOPES:
                    raise ApiError(400, "unknown scope: %s" % scope)
                with LOCK:
                    proj["harness"] = harness
                    proj["preset"] = preset
                    proj["scope"] = scope
                    _save_state()
                return self._json(202, start_job("setup", pid))
            m = re.fullmatch(r"projects/([^/]+)/setup-preview", api)
            if m and method == "POST":
                d = _json_body(body)
                harness = str(d.get("harness") or "kiro")
                if harness not in HARNESSES:
                    raise ApiError(400, "unknown harness: %s" % harness)
                return self._json(200, setup_preview(m.group(1), harness))
            m = re.fullmatch(r"projects/([^/]+)/doctor", api)
            if m and method == "POST":
                return self._json(200, run_doctor_now(m.group(1)))
            m = re.fullmatch(r"projects/([^/]+)/state", api)
            if m and method == "GET":
                return self._json(200, project_state(m.group(1)))
            m = re.fullmatch(r"projects/([^/]+)/git-init", api)
            if m and method == "POST":
                return self._json(202, start_job("git-init", m.group(1)))
            if method == "GET" and api == "logs/tail":
                return self._json(200, tail_logs(qs))
            if method == "GET" and api == "logs/stream":
                return self._sse(qs)

            # -- crew / forge / terminal (companion-app + cockpit surface) -----
            m = re.fullmatch(r"projects/([^/]+)/git-remote", api)
            if m and method == "GET":
                return self._json(200, forge.git_remote(get_project(m.group(1))["path"]))
            m = re.fullmatch(r"projects/([^/]+)/issue", api)
            if m and method == "POST":
                d = _json_body(body)
                proj = get_project(m.group(1))
                try:
                    created = forge.create_issue(
                        proj["path"],
                        str(d.get("title") or ""),
                        str(d.get("body") or ""),
                        d.get("labels"),
                    )
                except forge.ForgeError as e:
                    return self._json(e.status, {"error": e.msg})
                _append_line("[si-crewapp-aidlc] issue created on %s: %s" % (proj["name"], created.get("url") or created.get("number")))
                return self._json(201, created)
            m = re.fullmatch(r"projects/([^/]+)/mode", api)
            if m and method == "POST":
                d = _json_body(body)
                mode = str(d.get("mode") or "").strip()
                if mode not in ("solo", "crew"):
                    raise ApiError(400, "mode must be 'solo' or 'crew'")
                proj = get_project(m.group(1))
                with LOCK:
                    proj["mode"] = mode
                    # Persist which issue-radar crew this project enabled, so the
                    # cockpit can highlight it. The crew itself lives in
                    # issue-radar; this is just a pointer back to it.
                    crew = d.get("crew")
                    if isinstance(crew, dict):
                        proj["crew"] = {
                            "id": str(crew.get("id") or ""),
                            "name": str(crew.get("name") or ""),
                            "owner": str(crew.get("owner") or ""),
                            "repo": str(crew.get("repo") or ""),
                        }
                    elif mode == "solo":
                        proj["crew"] = None
                    proj["updated_at"] = time.time()
                    _save_state()
                return self._json(200, {"id": proj["id"], "mode": mode, "crew": proj.get("crew")})

            m = re.fullmatch(r"projects/([^/]+)/terminal", api)
            if m and method == "POST":
                d = _json_body(body)
                proj = get_project(m.group(1))
                # command is optional: the UI can launch the harness agent, or
                # leave it None for a plain interactive shell.
                command = d.get("command")
                command = str(command) if command is not None else None
                sess = terminal.spawn(proj["path"], command)
                _append_line("[si-crewapp-aidlc] terminal %s spawned (%s, cwd %s)" % (sess["id"], command or "shell", proj["path"]))
                return self._json(201, {"terminal_id": sess["id"], "pid": sess["pid"], "shell": sess["shell"]})

            m = re.fullmatch(r"terminals/([^/]+)/stream", api)
            if m and method == "GET":
                return self._terminal_stream(m.group(1))
            m = re.fullmatch(r"terminals/([^/]+)/input", api)
            if m and method == "POST":
                d = _json_body(body)
                tid = m.group(1)
                if not terminal.has(tid):
                    return self._json(404, {"error": "no such terminal: %s" % tid})
                terminal.send_input(tid, terminal.base64_decode(str(d.get("data") or "")))
                return self._json(200, {"ok": True})
            m = re.fullmatch(r"terminals/([^/]+)/resize", api)
            if m and method == "POST":
                d = _json_body(body)
                tid = m.group(1)
                if not terminal.has(tid):
                    return self._json(404, {"error": "no such terminal: %s" % tid})
                terminal.resize(tid, int(d.get("cols") or 80), int(d.get("rows") or 24))
                return self._json(200, {"ok": True})
            m = re.fullmatch(r"terminals/([^/]+)", api)
            if m and method == "DELETE":
                killed = terminal.kill(m.group(1))
                return self._json(200 if killed else 404, {"ok": killed})

            return self._json(404, {"error": "no such api: %s %s" % (method, api)})
        except ApiError as e:
            return self._json(e.status, {"error": e.msg, **e.extra})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:
            traceback.print_exc()
            try:
                self._json(500, {"error": "internal error"})
            except Exception:
                pass

    # -- SSE -----------------------------------------------------------------

    def _sse(self, qs):
        try:
            after = int((qs.get("after") or ["0"])[0])
        except (ValueError, IndexError):
            after = 0
        last_event_id = self.headers.get("Last-Event-ID")
        if last_event_id:
            try:
                after = max(after, int(last_event_id))
            except ValueError:
                pass
        q = queue.Queue()
        with LOCK:
            seed = [it for it in RING if it[0] > after][-500:]
            WATCHERS.append(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "keep-alive")
        self.close_connection = True
        self.end_headers()
        try:
            self.wfile.write(b"retry: 500\n\n")
            for seq, text in seed:
                self._sse_event("line", {"seq": seq, "text": text}, seq)
            while True:
                try:
                    kind, payload = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self._sse_event(kind, payload, payload.get("seq"))
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with LOCK:
                if q in WATCHERS:
                    WATCHERS.remove(q)
            self.close_connection = True

    def _sse_event(self, event, payload, event_id=None):
        out = ""
        if event_id is not None:
            out += "id: %d\n" % event_id
        out += "event: %s\ndata: %s\n\n" % (event, json.dumps(payload))
        self.wfile.write(out.encode("utf-8"))
        self.wfile.flush()

    def _terminal_stream(self, tid):
        """SSE: stream one terminal session's I/O to xterm.js.

        Emits ``out`` events (``{"data": <base64>}``) as the pty produces output
        and a final ``exit`` event (``{"exit": <code>}``) when the process ends.
        15s heartbeats keep the gateway's proxy from idling the connection out.
        """
        try:
            sess = terminal.get(tid)
        except KeyError:
            return self._json(404, {"error": "no such terminal: %s" % tid})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "keep-alive")
        self.close_connection = True
        self.end_headers()
        try:
            self.wfile.write(b"retry: 500\n\n")
            while True:
                try:
                    item = sess["out_q"].get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self._sse_event("out" if "data" in item else "exit", item)
                if "exit" in item:
                    break
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.close_connection = True


def _json_body(body):
    if not body:
        return {}
    try:
        d = json.loads(body)
    except Exception:
        raise ApiError(400, "invalid JSON body")
    if not isinstance(d, dict):
        raise ApiError(400, "JSON object expected")
    return d


# ---------------------------------------------------------------------------
# shutdown


def _handle_term(signum, frame):
    threading.Thread(target=_shutdown, daemon=True).start()


def _shutdown():
    if SERVER is not None:
        try:
            SERVER.shutdown()
        except Exception:
            pass


def main():
    global SERVER
    port = int(os.environ.get("PORT") or "9148")
    _load_state()
    SERVER = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    _append_line("[si-crewapp-aidlc] backend started (pid %d, port %d, %s)" % (os.getpid(), port, "windows" if IS_WINDOWS else "linux"))
    import signal

    signal.signal(signal.SIGTERM, _handle_term)
    signal.signal(signal.SIGINT, _handle_term)
    try:
        SERVER.serve_forever()
    finally:
        SERVER.server_close()


if __name__ == "__main__":
    main()
