"""SI AIDLC - forge helpers: git remote + GitHub issue creation.

The AIDLC app is the *client* that owns issue creation: issue-radar (the
companion crew service) deliberately has no create-issue route, so a GitHub
issue is minted here through the ``gh`` CLI that the user is already
authenticated to (issue-radar itself shells out to ``gh`` for its forge reads).

Creating the issue is the trigger: once it lands on the repo, issue-radar's
watcher sees the new issue and wakes the repo's crew (when the repo's
``crew_wake_on_new_work`` setting is on, or the issue carries a label in the
crew's scope). This module never talks to issue-radar; the two apps stay
decoupled and meet only at the repo.

Stdlib only.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from urllib.parse import urlparse

GH_TIMEOUT_S = 60


class ForgeError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status
        self.msg = msg


def _run(argv: list[str], cwd: str, timeout: int = GH_TIMEOUT_S) -> tuple[int, str]:
    proc = subprocess.run(
        argv,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return proc.returncode, proc.stdout


def gh_available() -> bool:
    return bool(shutil.which("gh"))


def _parse_remote(url: str) -> tuple[str | None, str | None]:
    """Split a git remote URL into ``(owner, repo)``.

    Handles https, ssh (``git@host:o/r.git``), ``ssh://`` and self-hosted forms.
    For a nested group (GitLab ``group/sub/project``) the owner is the full path
    ``group/sub`` and the repo is the final segment -- which is what issue-radar's
    GitLab ``RepoKey`` expects.
    """
    u = (url or "").strip()
    if not u:
        return None, None
    m = re.match(r"^[a-z][a-z0-9+.-]*://", u)
    if m:
        u = u[m.end():]
    if "@" in u and ":" in u:
        u = u.split("@", 1)[1]
    if ":" in u:
        _host, path = u.split(":", 1)
    else:
        parts = u.split("/")
        if len(parts) < 2:
            return None, None
        path = "/".join(parts[1:])
    path = path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if "/" not in path:
        return None, path
    owner, repo = path.rsplit("/", 1)
    return (owner or None), (repo or None)


def git_remote(project_dir: str) -> dict:
    """Parse ``owner``/``repo`` out of the project's ``origin`` remote URL.

    Returns ``{"owner","repo","remote","url"}`` (any field ``None`` when the
    folder is not a git repo with an origin).
    """
    out = {"owner": None, "repo": None, "remote": "origin", "url": None}
    if not shutil.which("git"):
        return out
    try:
        code, raw = _run(["git", "remote", "get-url", "origin"], project_dir, timeout=15)
    except (subprocess.SubprocessError, OSError):
        return out
    if code != 0:
        return out
    url = raw.strip()
    if not url:
        return out
    out["url"] = url
    owner, repo = _parse_remote(url)
    out["owner"] = owner
    out["repo"] = repo
    return out


def _current_branch(project_dir: str) -> str:
    """The project's current branch name (``main`` when detached)."""
    code, raw = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], project_dir, 15)
    b = raw.strip()
    if code != 0 or not b or b == "HEAD":
        return "main"
    return b


def _ensure_commit(project_dir: str) -> None:
    """Make sure the repo has at least one commit (create one if it does not)."""
    code, _ = _run(["git", "rev-parse", "--verify", "-q", "HEAD"], project_dir, 15)
    if code == 0:
        return  # already has commits
    _run(["git", "add", "-A"], project_dir, 60)
    _run(["git", "commit", "-q", "-m", "initial commit (AIDLC project)"], project_dir, 60)


def gh_auth_status() -> dict:
    """Whether the host ``gh`` CLI is present and authenticated, and its login.

    ``gh`` reads its token from the host config (``~/.config/gh/hosts.yml``),
    which the KiroCrew GitHub connector / ``gh auth login`` populates - so this
    works even in the app backend's scrubbed env (no ``GITHUB_TOKEN`` passthrough).
    """
    out = {"available": False, "authenticated": False, "owner": None}
    if not gh_available():
        return out
    out["available"] = True
    try:
        code, raw = _run(["gh", "api", "user", "--jq", ".login"], os.getcwd(), timeout=20)
    except (subprocess.SubprocessError, OSError):
        return out
    login = raw.strip()
    if code == 0 and login:
        out["authenticated"] = True
        out["owner"] = login
    return out


def host_on_github(
    project_dir: str,
    repo_name: str,
    private: bool = True,
    push: bool = True,
) -> dict:
    """Host the project folder on GitHub and wire it as the ``origin`` remote.

    Ensures the folder is a git repo, creates the remote repo on GitHub (via the
    host ``gh`` auth that the KiroCrew connector / ``gh auth login`` provides) if
    it does not exist, sets ``origin`` to it, and optionally pushes the branch.
    If an ``origin`` is already configured the remote-repo step is skipped (no
    ``gh`` needed), so this is safe to re-run.
    """
    name = (repo_name or "").strip()
    if not name:
        raise ForgeError(400, "a repo name is required")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?", name):
        raise ForgeError(400, "repo must be 'name' or 'owner/name'")

    # ensure it is a git repo
    inited = False
    code, _ = _run(["git", "rev-parse", "--is-inside-work-tree"], project_dir, 15)
    if code != 0:
        code, raw = _run(["git", "init"], project_dir, 30)
        if code != 0:
            raise ForgeError(400, "not a git repo and git init failed: %s" % raw.strip()[-200:])
        inited = True

    # origin already configured? then no remote-repo work is needed
    code, existing = _run(["git", "remote", "get-url", "origin"], project_dir, 15)
    if code == 0 and existing.strip():
        url = existing.strip()
        owner, repo = _parse_remote(url)
        if push:
            _ensure_commit(project_dir)
            branch = _current_branch(project_dir)
            code, raw = _run(["git", "push", "-u", "origin", branch], project_dir, 120)
            if code != 0:
                raise ForgeError(422, "git push failed: %s" % raw.strip()[-300:])
            return {"owner": owner, "repo": repo, "url": url, "created": False, "pushed": True, "branch": branch, "inited": inited}
        return {"owner": owner, "repo": repo, "url": url, "created": False, "pushed": False, "branch": None, "inited": inited}

    # no origin - create the remote repo via the host gh auth
    if not gh_available():
        raise ForgeError(409, "no git origin and the gh CLI is not on PATH - install gh and run `gh auth login`")
    full = name
    if "/" not in name:
        code, owner_out = _run(["gh", "api", "user", "--jq", ".login"], project_dir, 20)
        if code != 0 or not owner_out.strip():
            raise ForgeError(409, "gh is not authenticated - run `gh auth login` (or connect GitHub in KiroCrew), then retry")
        full = "%s/%s" % (owner_out.strip(), name)

    created = False
    code, _ = _run(["gh", "repo", "view", full], project_dir, 20)
    if code != 0:
        argv = ["gh", "repo", "create", full, "--quiet"]
        if private:
            argv.append("--private")
        code, raw = _run(argv, project_dir, 60)
        if code != 0:
            raise ForgeError(422, "gh repo create failed: %s" % raw.strip()[-300:])
        created = True

    url = "https://github.com/%s.git" % full
    code, _ = _run(["git", "remote", "add", "origin", url], project_dir, 15)
    if code != 0:
        code, raw = _run(["git", "remote", "set-url", "origin", url], project_dir, 15)
        if code != 0:
            raise ForgeError(500, "could not set git origin: %s" % raw.strip()[-200:])

    branch = None
    if push:
        _ensure_commit(project_dir)
        branch = _current_branch(project_dir)
        code, raw = _run(["git", "push", "-u", "origin", branch], project_dir, 120)
        if code != 0:
            raise ForgeError(422, "git push failed: %s" % raw.strip()[-300:])

    owner, repo = _parse_remote(url)
    return {"owner": owner, "repo": repo, "url": url, "created": created, "pushed": bool(push), "branch": branch, "inited": inited}


def create_issue(
    project_dir: str,
    title: str,
    body: str,
    labels: list[str] | None = None,
) -> dict:
    """Open a GitHub issue on the project's repo via ``gh``; return its metadata.

    ``gh`` resolves the repo from *project_dir* (its git remote), so no owner/repo
    is passed. ``--label`` accepts a comma-joined list; labels that do not exist
    on the repo are created on the fly by ``gh`` (matching issue-radar's own
    label behaviour), which is what makes the crew's scope label stick.
    """
    if not gh_available():
        raise ForgeError(409, "gh CLI not found on PATH - install it and `gh auth login` first")
    title = (title or "").strip()
    if not title:
        raise ForgeError(400, "issue title is required")
    body = (body or "").strip()
    labels = [l for l in (labels or []) if str(l).strip()]

    argv = ["gh", "issue", "create", "--title", title, "--body", body or ""]
    if labels:
        argv += ["--label", ",".join(labels)]
    try:
        code, raw = _run(argv, project_dir, timeout=GH_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise ForgeError(504, "gh issue create timed out")
    except (subprocess.SubprocessError, OSError) as e:
        raise ForgeError(500, "gh issue create failed: %s" % e)

    if code != 0:
        raise ForgeError(422, "gh issue create exited %d: %s" % (code, raw.strip()[-400:]))

    # gh prints the new issue's URL on the last line.
    url = ""
    for line in reversed(raw.splitlines()):
        if line.strip().startswith("http"):
            url = line.strip()
            break
    number = None
    if url:
        m = re.search(r"/issues/(\d+)$", url)
        if m:
            number = int(m.group(1))
    return {"number": number, "url": url or None, "title": title}
