// SI AIDLC - shared UI helpers.
//
// Imported by the UI bundle (index.mjs). All traffic goes to the Kiro Crew
// gateway at /apps/si-crewapp-aidlc/api/* with the dashboard session cookie; the
// gateway HMAC-signs and proxies to the app backend. Plain fetch - no host
// SDK needed.

const APP = "si-crewapp-aidlc"

export const apiPath = (p) => `/apps/${APP}/api/${p}`

export async function http(method, path, body) {
  const res = await fetch(apiPath(path), {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `request failed: HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// -- actions ---------------------------------------------------------------

export const getState = () => http("GET", "state")
export const getProjectState = (pid) => http("GET", `projects/${pid}/state`)
export const addProject = (d) => http("POST", "projects", d)
export const removeProject = (pid) => http("DELETE", `projects/${pid}`)
export const startSetup = (pid, harness, preset, scope) =>
  http("POST", `projects/${pid}/setup`, { harness, preset, scope })
export const setupPreview = (pid, harness) =>
  http("POST", `projects/${pid}/setup-preview`, { harness })
export const runDoctor = (pid) => http("POST", `projects/${pid}/doctor`)
export const gitInit = (pid) => http("POST", `projects/${pid}/git-init`)
export const installCli = () => http("POST", "cli/install", {})
export const tailLogs = (after, limit) =>
  http("GET", `logs/tail?after=${encodeURIComponent(after || 0)}&limit=${limit || 300}`)

// -- crew / forge / terminal (companion-app + cockpit surface) -------------

// AIDLC backend: the app owns issue creation (issue-radar has no create-issue
// route) and the local terminal. These hit the app's own /api/* surface.
export const getGitRemote = (pid) => http("GET", `projects/${pid}/git-remote`)
export const createIssue = (pid, d) => http("POST", `projects/${pid}/issue`, d)
export const setMode = (pid, mode, crew) => http("POST", `projects/${pid}/mode`, { mode, crew })
// Read-only folder tree for the project's right-hand file column (capped,
// .git and other noise dirs ignored server-side).
export const getProjectFiles = (pid) => http("GET", `projects/${pid}/files`)
// Open the project folder - or a file/folder inside it (relative `path`) - in
// the OS file manager / default app (Explorer on Windows, xdg-open on Linux).
export const openInExplorer = (pid, path) =>
  http("POST", `projects/${pid}/open-in-explorer`, { path: path ?? null })
// Open a native terminal window OUTSIDE the app (Windows Terminal, else a
// detached PowerShell console) in the project folder, optionally running the
// harness command. The window is fully detached - it outlives the app.
export const openTerminal = (pid, command) =>
  http("POST", `projects/${pid}/open-terminal`, { command: command ?? null })

// -- issue-radar (companion crew service, app-to-app "case a") ------------
//
// issue-radar is a SEPARATE app. Its routes are served by the gateway at the
// same-origin path /api/apps/issue-radar/* (its own route prefix), NOT under
// this app's /apps/si-crewapp-aidlc/api/*. The dashboard session cookie
// authenticates the call, so the browser (this app's UI) is the caller -- the
// crew routes refuse a backend-to-backend internal secret and require the
// owner's cookie. We never re-implement issue-radar; we call it as a service.

const RADAR = "/api/apps/issue-radar"

async function radarFetch(method, path, body) {
  const res = await fetch(`${RADAR}${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `issue-radar ${method} ${path} failed: HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// owner/repo -> query string (provider/host optional; default to public GitHub).
function radarQ(owner, repo, provider, host) {
  const q = new URLSearchParams()
  q.set("owner", owner)
  q.set("repo", repo)
  if (provider) q.set("provider", provider)
  if (host) q.set("host", host)
  return q.toString()
}
function radarBody(owner, repo, provider, host) {
  const b = { owner, repo }
  if (provider) b.provider = provider
  if (host) b.host = host
  return b
}

export const radarCrews = (owner, repo, provider, host) =>
  radarFetch("GET", `/crews?${radarQ(owner, repo, provider, host)}`)
export const radarCrew = (owner, repo, id, provider, host) =>
  radarFetch("GET", `/crew?${radarQ(owner, repo, provider, host)}&id=${encodeURIComponent(id)}`)
export const radarCreateCrew = (owner, repo, spec, provider, host) =>
  radarFetch("POST", "/crews", { ...radarBody(owner, repo, provider, host), ...spec })
export const radarCrewSettings = (owner, repo, patch, provider, host) =>
  radarFetch("PUT", "/crews/settings", { ...radarBody(owner, repo, provider, host), settings: patch })
export const radarIssues = (owner, repo, provider, host) =>
  radarFetch("GET", `/issues?${radarQ(owner, repo, provider, host)}`)
export const radarPulls = (owner, repo, provider, host) =>
  radarFetch("GET", `/pulls?${radarQ(owner, repo, provider, host)}`)

// Live log stream.
//
// Opens an EventSource against /logs/stream. The gateway's per-request timeout
// cuts the proxied stream every ~30s, so we rely on EventSource reconnecting
// (the server sends `retry: 500`); the backend reseeds from the Last-Event-ID
// header / ?after= cursor, so no lines are lost (ring buffer holds 2000).
// If the stream dies repeatedly (backend down), fall back to tail polling.
//
// Returns { close() }.
export function subscribeLogs({ after = 0, onLine, onExit } = {}) {
  let seq = after
  let es = null
  let closed = false
  let failCount = 0
  let openedAt = 0
  let timer = null
  let pollTimer = null

  function clearTimers() {
    if (timer) clearTimeout(timer)
    timer = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPolling() {
    // backend appears down - poll the tail instead
    const poll = async () => {
      try {
        const r = await tailLogs(seq)
        for (const [s, text] of r.lines) {
          if (s > seq) {
            seq = s
            onLine && onLine({ seq: s, text })
          }
        }
        failCount = 0
      } catch {
        /* keep polling */
      }
    }
    if (pollTimer) return
    poll()
    pollTimer = setInterval(poll, 2000)
  }

  function open() {
    if (closed) return
    openedAt = Date.now()
    try {
      es = new EventSource(`${apiPath("logs/stream")}?after=${seq}`)
    } catch {
      startPolling()
      return
    }
    es.addEventListener("line", (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d && d.seq) seq = Math.max(seq, d.seq)
        onLine && onLine(d)
      } catch {
        /* ignore malformed */
      }
    })
    es.addEventListener("exit", (e) => {
      try {
        onExit && onExit(JSON.parse(e.data))
      } catch {
        /* ignore malformed */
      }
    })
    es.onerror = () => {
      try {
        es.close()
      } catch {
        /* already closed */
      }
      const instantFail = Date.now() - openedAt < 500
      if (instantFail) failCount += 1
      else failCount = 0
      if (closed) return
      if (failCount >= 3) {
        startPolling()
        return
      }
      timer = setTimeout(open, 800)
    }
  }

  open()

  return {
    close() {
      closed = true
      clearTimers()
      try {
        es && es.close()
      } catch {
        /* already closed */
      }
    },
  }
}

// -- formatters ------------------------------------------------------------

export function fmtDur(seconds) {
  if (seconds == null || !isFinite(seconds)) return ""
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function fmtTime(epoch) {
  if (!epoch) return ""
  try {
    return new Date(epoch * 1000).toLocaleString()
  } catch {
    return ""
  }
}

export function fmtAgo(epoch, now) {
  if (!epoch) return ""
  const s = Math.max(0, Math.floor((now || Date.now() / 1000) - epoch))
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
