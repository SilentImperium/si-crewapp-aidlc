# SI AIDLC

A KiroCrew app for working with [AI-DLC](https://dunlop.geek.nz/aidlc-one-year-on-kiro/) — **folder-first** and **cross-platform** (Windows + Linux).

The idea: you start with a plain local folder, not a repository. The app finds (or installs) the native `aidlc` CLI, runs a short setup wizard that controls *what* the CLI scaffolds (harness, effort preset, workflow profile — with a preview of the ~360 files that will land on disk), verifies health with `aidlc doctor`, and then gives you a live, read-only dashboard of where the AI-DLC lifecycle stands. The git repo is a deliberate second step, not a precondition.

> Inspired by `warren830/kirocrew-app-aidlc`, reimagined: that app is macOS/Linux and repo-first; this one is Windows+Linux and folder-first.

## Flow

1. **New project** — pick or create a local folder. No git, no registry of repos.
2. **CLI check** — the app detects `aidlc` on PATH and can install/upgrade the native CLI for your OS (PowerShell installer on Windows, shell installer on Linux).
3. **Setup wizard** — choose:
   - **Harness** (kiro, kiro-v2, opencode, claude, codex, cursor, copilot)
   - **Effort preset** (minimal / balanced / thorough → written to `aidlc.settings.json`)
   - **Workflow profile** (the 11 AI-DLC scopes: express = 10 stages, bugfix = 9, … enterprise = 33)

   You see a preview of the three ownership domains (`.aidlc/` engine, `<harness>/` glue, `aidlc/` workspace) *before* anything runs.
4. **Doctor** — `aidlc doctor` runs automatically after setup; re-run any time.
5. **Dashboard** — stage map (effective plan for the active scope), current stage, open questions, audit tail, settings summary, a harness handoff command, a live folder tree (right-hand column), and one-click "open folder / open file" in the OS Explorer (Windows) or file manager (Linux).
6. **Optional git** — “Make it a git repo” (`git init` + first commit) when you're ready.

The app never mutates AI-DLC state, audit trails, or artifacts — the dashboard is observation only; the work happens in your harness conversation.

## Architecture

Follows the house conventions of `si-local-inferencing`:

```
si-crewapp-aidlc/
├── app.json            # KiroCrew manifest (os: windows + linux)
├── backend/server.py   # stdlib-only Python: ThreadingHTTPServer, HMAC proxy
│                      #   verification, jobs, SSE log stream, state parser
├── ui/index.mjs        # dashboard (hand-written ESM + host-injected React)
├── ui/lib.mjs          # gateway API helpers + SSE subscription
├── assets/icon.png     # 512px icon (regenerate: python tools/make-icon.py)
└── tools/make-icon.py  # stdlib-only PNG generator for the icon
```

- **Backend** — stdlib only (the gateway spawns it with a scrubbed env). Drives the `aidlc` CLI via `subprocess` (PowerShell on Windows, POSIX sh on Linux), one job at a time, all output streamed to an SSE log ring. Persists projects under `KIROCREW_HOME/apps/si-crewapp-aidlc/data/`.
- **UI** — no build step; React + lucide-react are injected by the KiroCrew host. Polls `/api/state` every 3 s, project state every 4 s, and streams CLI output over SSE with tail-polling fallback.
- **State parsing** — read-only, best-effort: `aidlc-state.md`, `aidlc/spaces/<space>/intents/…`, `stage-graph.json`, `scope-grid.json`, `aidlc.settings.json`, audit shards. Unrecognized formats degrade to raw display.

## API (as seen by the gateway, which prepends `/api/`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | open liveness probe |
| GET | `/api/state` | projects + CLI/git detection + active job + catalogs |
| GET | `/api/cli` | CLI/git detection + install command |
| POST | `/api/cli/install` | install/upgrade the native CLI (job) |
| POST | `/api/projects` | add a project folder `{path, name?, create?}` |
| DELETE | `/api/projects/<id>` | remove from registry (folder untouched) |
| POST | `/api/projects/<id>/setup-preview` | CLI transaction plan via `--dry-run` (read-only) |
| POST | `/api/projects/<id>/setup` | `aidlc config` + preset + doctor (job) |
| POST | `/api/projects/<id>/doctor` | run `aidlc doctor` now |
| GET | `/api/projects/<id>/state` | read-only dashboard state |
| POST | `/api/projects/<id>/git-init` | optional `git init` + first commit (job) |
| GET | `/api/projects/<id>/files` | read-only folder tree (depth/node-capped, `.git` + noise dirs ignored) |
| POST | `/api/projects/<id>/open-in-explorer` | open the folder (or a file inside it) in Explorer / file manager |
| GET | `/api/logs/tail` | `?after=<seq>&limit=<n>` |
| GET | `/api/logs/stream` | SSE: `line` events, 15 s heartbeats |

## Development

- Regenerate the icon: `python tools/make-icon.py` (stdlib only, writes `assets/icon.png`).
- The backend is stdlib-only Python 3.8+; run it with `PORT=9148 KIROCREW_HOME=... python backend/server.py` for local testing (note: without `KIROCREW_PROXY_SECRET`, all `/api/*` routes return 401 by design).
