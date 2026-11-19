// SI AIDLC - dashboard page bundle.
//
// Hand-written ESM (no build step): the Kiro Crew host loads this module and
// renders the default-exported component. React and lucide-react are injected
// by the host on window.__kirocrew_modules before the import.
//
// Flow (deliberately folder-first, not repo-first):
//   1. add a local project folder (git is optional and comes later)
//   2. the app checks (and can install) the native `aidlc` CLI for your OS
//   3. setup wizard: pick harness + effort preset + workflow profile, preview
//      what lands on disk, run `aidlc config` + doctor
//   4. project dashboard: live stage map, open questions, audit tail, doctor,
//      optional git-init, harness handoff

import {
  getState,
  getProjectState,
  addProject,
  removeProject,
  startSetup,
  setupPreview,
  runDoctor,
  gitInit,
  installCli,
  subscribeLogs,
  fmtAgo,
  fmtTime,
} from "./lib.mjs"

const React = window.__kirocrew_modules.react
const { useState, useEffect, useRef, useCallback, useMemo } = React
const h = React.createElement
const {
  FolderPlus,
  Folder,
  Workflow,
  Terminal,
  Download,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  Trash2,
  GitBranch,
  Activity,
  Settings2,
  Rocket,
  Stethoscope,
  Copy,
  X,
} = window.__kirocrew_modules["lucide-react"]

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

// ---------------------------------------------------------------------------
// shared bits

function Dot({ tone = "#6b7280", pulse = false }) {
  return h(
    "span",
    {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: tone,
        display: "inline-block",
        flexShrink: 0,
        boxShadow: pulse ? `0 0 6px ${tone}` : "none",
      },
    }
  )
}

function Chip({ children, tone = "#94a3b8", bg, title }) {
  return h(
    "span",
    {
      title,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color: tone,
        background: bg || "rgba(148,163,184,.08)",
        border: `1px solid ${tone}33`,
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      },
    },
    children
  )
}

function btnStyle(kind = "ok") {
  if (kind === "ghost")
    return {
      background: "transparent",
      border: "1px solid rgba(148,163,184,.3)",
      color: "#cbd5e1",
    }
  if (kind === "danger")
    return {
      background: "rgba(248,113,113,.1)",
      border: "1px solid rgba(248,113,113,.4)",
      color: "#fca5a5",
    }
  return {
    background: "linear-gradient(135deg, #34d399, #22d3ee)",
    border: "1px solid rgba(52,211,153,.5)",
    color: "#06201a",
    fontWeight: 600,
  }
}

function Button({ kind, onClick, disabled, children, title, small }) {
  return h(
    "button",
    {
      onClick,
      disabled,
      title,
      style: {
        ...btnStyle(kind),
        padding: small ? "4px 10px" : "7px 14px",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? 12 : 13,
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      },
    },
    children
  )
}

function Card({ title, icon, actions, children, tone }) {
  return h(
    "div",
    {
      style: {
        border: "1px solid rgba(148,163,184,.22)",
        borderRadius: 12,
        background: "rgba(15,23,42,.35)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      },
    },
    (title || actions) &&
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8 } },
        title &&
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontWeight: 600,
                fontSize: 13,
                color: tone || "#e2e8f0",
                flex: 1,
              },
            },
            icon,
            title
          ),
        actions
      ),
    children
  )
}

const inputStyle = {
  width: "100%",
  fontFamily: MONO,
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(148,163,184,.3)",
  background: "rgba(15,23,42,.5)",
  color: "#e2e8f0",
  outline: "none",
  boxSizing: "border-box",
}

function Field({ label, children, hint }) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 5 } },
    h(
      "label",
      { style: { fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" } },
      label
    ),
    children,
    hint && h("div", { style: { fontSize: 11, color: "#64748b" } }, hint)
  )
}

// ---------------------------------------------------------------------------
// log console

function LogConsole({ lines, autoScroll }) {
  const ref = useRef(null)
  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, autoScroll])
  return h(
    "div",
    {
      ref,
      style: {
        height: 220,
        overflowY: "auto",
        background: "rgba(2,6,23,.7)",
        border: "1px solid rgba(148,163,184,.2)",
        borderRadius: 8,
        padding: "10px 12px",
        fontFamily: MONO,
        fontSize: 11.5,
        lineHeight: 1.55,
        color: "#94a3b8",
      },
    },
    lines.length
      ? lines.map((l) =>
          h(
            "div",
            {
              key: l.seq,
              style: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: l.text.startsWith("[si-crewapp-AIDLC]") ? "#67e8f9" : undefined,
              },
            },
            l.text
          )
        )
      : h("div", { style: { color: "#475569" } }, "no activity yet")
  )
}

// ---------------------------------------------------------------------------
// stage map (read-only view of the effective plan for the active scope)

function StageMap({ pstate }) {
  const scope = pstate.scope
  const grid = pstate.scope_grid || {}
  const stages = pstate.stages || []
  // server computes the effective plan from each stage's own scope list when
  // possible; fall back to the scope grid, then to showing everything
  let eff = pstate.effective_stages
  if (!eff) {
    eff = stages.filter((s) => {
      const cell = grid[s.slug]
      if (!cell || !cell[scope]) return true
      return cell[scope] === "EXECUTE"
    })
  }
  const phases = []
  for (const s of eff) {
    let ph = phases.find((p) => p.name === s.phase)
    if (!ph) {
      ph = { name: s.phase, stages: [] }
      phases.push(ph)
    }
    ph.stages.push(s)
  }
  const parsed = pstate.state_parsed || {}
  const current =
    parsed.current_stage ||
    Object.keys(parsed.stage_statuses || {}).find((k) => parsed.stage_statuses[k] === "CURRENT")

  if (!eff.length)
    return h(
      "div",
      { style: { fontSize: 12, color: "#64748b" } },
      "No stage data yet - run setup first, then open the project in your harness."
    )

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 10 } },
    phases.map((ph) =>
      h(
        "div",
        { key: ph.name, style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
        h(
          "span",
          {
            style: {
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "#64748b",
              width: 92,
              flexShrink: 0,
            },
          },
          ph.name
        ),
        ph.stages.map((s) => {
          const isCur = current && (s.slug === current || s.name === current)
          return h(
            "span",
            {
              key: s.slug || s.name,
              title: `${s.slug} - ${s.name}`,
              style: {
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                fontFamily: MONO,
                background: isCur ? "rgba(52,211,153,.18)" : "rgba(148,163,184,.08)",
                border: `1px solid ${isCur ? "rgba(52,211,153,.6)" : "rgba(148,163,184,.25)"}`,
                color: isCur ? "#34d399" : "#94a3b8",
                fontWeight: isCur ? 700 : 400,
              },
            },
            `${s.number ? s.number + " " : ""}${s.name || s.slug}`
          )
        })
      )
    ),
    h(
      "div",
      { style: { fontSize: 11, color: "#64748b" } },
      `${eff.length} of ${stages.length || 33} stages effective for scope "${scope || "default"}"`
    )
  )
}

// ---------------------------------------------------------------------------
// setup wizard (the "control what the CLI sets up" surface)

function SetupWizard({ proj, state, onRun, busy, onInstallCli, cliOk }) {
  const scopes = state.scopes || []
  const [harness, setHarness] = useState(proj.harness || "kiro")
  const [preset, setPreset] = useState(proj.preset || "balanced")
  const [scope, setScope] = useState(proj.scope || "express")
  const [preview, setPreview] = useState("") // "" = closed; text = CLI plan (or fallback)
  const [previewing, setPreviewing] = useState(false)

  const scopeInfo = scopes.find((s) => s.id === scope)
  const glueName =
    { kiro: ".kiro/", "kiro-v2": ".kiro-v2/", opencode: ".opencode/", claude: ".claude/", codex: ".codex/", cursor: ".cursor/", copilot: ".copilot/" }[
    harness
  ] || `.${harness}/`

  const doPreview = async () => {
    setPreviewing(true)
    try {
      const r = await setupPreview(proj.id, harness)
      setPreview(r.plan && r.plan.trim() ? r.plan : "(the CLI returned no plan output)")
    } catch (e) {
      setPreview(
        `(preview unavailable: ${e.message})\n\nExpected layout:\n  .aidlc/          engine (stage graph, scope grid, sensors, agents)\n  ${glueName}  glue for the ${harness} harness\n  aidlc/          your workspace (spaces, intents, audit, memory)\n  AGENTS.md, aidlc.settings.json, .gitignore managed block`
      )
    } finally {
      setPreviewing(false)
    }
  }

  return h(
    Card,
    { title: "Setup wizard", icon: h(Settings2, { size: 14, style: { color: "#34d399" } }) },
    !cliOk &&
      h(
        "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#fbbf24",
              background: "rgba(251,191,36,.08)",
              border: "1px solid rgba(251,191,36,.3)",
              borderRadius: 8,
              padding: "8px 10px",
            },
          },
          h(CircleAlert, { size: 14 }),
          "aidlc CLI not found on this machine.",
          h(Button, {
            kind: "ghost",
            small: true,
            onClick: onInstallCli,
            disabled: busy,
          },
            h(Download, { size: 12 }),
            "Install CLI")
        ),
    h(
      "div",
      { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 10 } },
      h(
        Field,
        { label: "Harness" },
        h(
          "select",
          { style: inputStyle, value: harness, onChange: (e) => setHarness(e.target.value) },
          (state.harnesses || []).map((v) => h("option", { key: v, value: v }, v))
        )
      ),
      h(
        Field,
        { label: "Effort preset" },
        h(
          "select",
          { style: inputStyle, value: preset, onChange: (e) => setPreset(e.target.value) },
          (state.presets || []).map((v) => h("option", { key: v, value: v }, v))
        )
      ),
      h(
        Field,
        { label: "Workflow profile", hint: scopeInfo ? `${scopeInfo.stages} of 33 stages` : null },
        h(
          "select",
          { style: inputStyle, value: scope, onChange: (e) => setScope(e.target.value) },
          scopes.map((s) => h("option", { key: s.id, value: s.id }, `${s.label} (${s.stages})`))
        )
      )
    ),
    preview !== "" &&
      h(
        "div",
          {
            style: {
              background: "rgba(2,6,23,.7)",
              border: "1px solid rgba(52,211,153,.3)",
              borderRadius: 8,
              padding: 12,
              fontFamily: MONO,
              fontSize: 11.5,
              lineHeight: 1.6,
              color: "#94a3b8",
              whiteSpace: "pre-wrap",
              maxHeight: 260,
              overflowY: "auto",
            },
          },
        h("div", { style: { color: "#34d399", fontWeight: 700, marginBottom: 6 } },
          "What the CLI will create (dry-run plan):"),
        preview,
        h(
          "div",
            { style: { marginTop: 8, color: "#67e8f9" } },
            `Preset: ${preset}. Default scope: ${scope} - only ${scopeInfo ? scopeInfo.stages : "?"} of 33 stages will run.`
        )
      ),
    h(
      "div",
      { style: { display: "flex", gap: 8 } },
      preview === ""
        ? h(
            Button,
            {
              onClick: doPreview,
              disabled: busy || previewing || !cliOk,
            },
            previewing ? h(LoaderCircle, { size: 14, style: { animation: "spin 1.2s linear infinite" } }) : h(Settings2, { size: 14 }),
            previewing ? "Reading CLI plan…" : "Preview what it creates"
          )
        : h(
            Button,
            {
              onClick: () => onRun(harness, preset, scope),
              disabled: busy,
            },
            h(Rocket, { size: 14 }),
            "Run setup"
          ),
      preview !== "" && h(Button, { kind: "ghost", onClick: () => setPreview("") }, "Back")
    )
  )
}

// ---------------------------------------------------------------------------
// project dashboard (post-setup)

function ProjectDashboard({ pstate, busy, onDoctor, onGitInit, onRefresh, onRunSetup }) {
  const [doctor, setDoctor] = useState(null)
  const [copied, setCopied] = useState(false)
  const proj = pstate.project
  const parsed = pstate.state_parsed || {}
  const current =
    parsed.current_stage ||
    Object.keys(parsed.stage_statuses || {}).find((k) => parsed.stage_statuses[k] === "CURRENT")

  const copyLaunch = async () => {
    try {
      await navigator.clipboard.writeText(pstate.launch || "")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 12 } },
    // stat chips
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      h(Chip, { tone: current ? "#34d399" : "#94a3b8", bg: current ? "rgba(52,211,153,.1)" : undefined },
        h(CircleCheck, { size: 11 }),
        current ? `stage: ${current}` : "no active stage"),
      pstate.questions_open > 0 &&
        h(Chip, { tone: "#fbbf24", bg: "rgba(251,191,36,.1)" },
          h(CircleAlert, { size: 11 }),
          `${pstate.questions_open} open question${pstate.questions_open > 1 ? "s" : ""}`),
      pstate.intents.length > 0 &&
        h(Chip, null, `space: ${pstate.space} · ${pstate.intents.length} intent${pstate.intents.length > 1 ? "s" : ""}`),
      pstate.settings && pstate.settings.models &&
        h(Chip, null, `preset: ${pstate.settings.models.preset || "?"}`)
    ),
    // stage map
    h(Card, { title: "Stage map", icon: h(Workflow, { size: 14, style: { color: "#22d3ee" } }) },
      h(StageMap, { pstate })),
    // actions
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      h(
        Button,
        {
          kind: "ghost",
          onClick: async () => {
            try {
              setDoctor(await onDoctor())
            } catch (e) {
              setDoctor({ ok: false, raw: e.message })
            }
          },
          disabled: busy,
        },
        h(Stethoscope, { size: 13 }),
        "Run doctor"
      ),
      !proj.git &&
        h(
          Button,
          {
            kind: "ghost",
            onClick: () => {
              if (window.confirm(`Turn "${proj.path}" into a git repository with an initial commit?`))
                onGitInit()
            },
            disabled: busy,
          },
          h(GitBranch, { size: 13 }),
          "Make it a git repo"
        ),
      h(Button, { kind: "ghost", onClick: onRefresh, disabled: busy }, "Refresh")
    ),
    // launch handoff
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(34,211,238,.06)",
          border: "1px solid rgba(34,211,238,.25)",
          borderRadius: 8,
          padding: "8px 12px",
          fontFamily: MONO,
          fontSize: 12,
          color: "#67e8f9",
        },
      },
      h(Rocket, { size: 13, style: { flexShrink: 0 } }),
      h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: pstate.launch },
        pstate.launch || "open the project in your harness"),
      h(
        Button,
        {
          kind: "ghost",
          small: true,
          onClick: copyLaunch,
          title: "Copy the launch command",
        },
        copied ? h(CircleCheck, { size: 12, style: { color: "#34d399" } }) : h(Copy, { size: 12 }),
        copied ? "copied" : "copy"
      )
    ),
    // doctor result
    doctor &&
      h(
        "div",
          {
            style: {
              background: "rgba(2,6,23,.6)",
              border: `1px solid ${doctor.ok ? "rgba(52,211,153,.35)" : "rgba(248,113,113,.35)"}`,
              borderRadius: 8,
              padding: 10,
              fontFamily: MONO,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              maxHeight: 220,
              overflowY: "auto",
              color: doctor.ok ? "#94a3b8" : "#fca5a5",
            },
          },
          h(
            "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 700,
                  marginBottom: 6,
                  color: doctor.ok ? "#34d399" : "#f87171",
                },
              },
            doctor.ok ? h(CircleCheck, { size: 12 }) : h(CircleAlert, { size: 12 }),
            doctor.ok ? "doctor: all checks passed" : `doctor: problems found (exit ${doctor.exit_code ?? "?"})`,
            h("span", { style: { flex: 1 } }),
            h("button", {
              style: { ...btnStyle("ghost"), padding: "2px 8px", borderRadius: 6, fontSize: 11, cursor: "pointer" },
              onClick: () => setDoctor(null),
            }, h(X, { size: 11 })),
          ),
          doctor.raw || "(no output)"
        ),
    // audit tail
    (pstate.audit_tail || []).length > 0 &&
      h(
        Card,
          { title: "Recent activity", icon: h(Activity, { size: 14, style: { color: "#94a3b8" } }) },
          h(
            "div",
              {
                style: {
                  fontFamily: MONO,
                  fontSize: 10.5,
                  lineHeight: 1.6,
                  color: "#64748b",
                  maxHeight: 160,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                },
              },
            pstate.audit_tail.join("\n")
          )
      )
  )
}

// ---------------------------------------------------------------------------
// main

export default function SiCrewappAidlcApp() {
  const [state, setState] = useState(null)
  const [sel, setSel] = useState(null)
  const [pstate, setPstate] = useState(null)
  const [lines, setLines] = useState([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [np, setNp] = useState({ name: "", path: "", create: true })

  const logRef = useRef(null)
  const lastSeq = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setState(await getState())
      setError("")
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const refreshProject = useCallback(async () => {
    if (!sel) {
      setPstate(null)
      return
    }
    try {
      setPstate(await getProjectState(sel))
    } catch {
      /* project may be mid-removal; next poll recovers */
    }
  }, [sel])

  useEffect(() => {
    refreshProject()
    const t = setInterval(refreshProject, 4000)
    return () => clearInterval(t)
  }, [refreshProject])

  const onLine = useCallback((d) => {
    if (!d || !d.seq || d.seq <= lastSeq.current) return
    lastSeq.current = d.seq
    setLines((prev) => {
      const next = prev.length >= 1500 ? prev.slice(-1200) : prev.slice()
      next.push(d)
      return next
    })
  }, [])

  useEffect(() => {
    const sub = subscribeLogs({ after: 0, onLine })
    return () => sub.close()
  }, [onLine])

  const act = async (fn) => {
    setBusy(true)
    setError("")
    try {
      await fn()
      await refresh()
      await refreshProject()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const proj = state && state.projects.find((p) => p.id === sel)
  const cli = (state && state.cli) || {}
  const job = state && state.job
  const cliOk = cli.aidlc && cli.aidlc.installed

  const doAdd = () => {
    if (!np.path.trim()) {
      setError("a folder path is required")
      return
    }
    act(async () => {
      const p = await addProject({
        name: np.name.trim() || undefined,
        path: np.path.trim(),
        create: np.create,
      })
      setSel(p.id)
      setNp({ name: "", path: "", create: true })
    })
  }

  const doRemove = (p) => {
    if (!window.confirm(`Remove "${p.name}" from the registry? The folder itself is not touched.`)) return
    act(async () => {
      await removeProject(p.id)
      if (sel === p.id) setSel(null)
    })
  }

  const doInstall = () => {
    if (!window.confirm("Install (or update) the native aidlc CLI for this machine?")) return
    act(() => installCli())
  }

  const doDoctor = async () => {
    if (!sel) return
    setBusy(true)
    try {
      const r = await runDoctor(sel)
      return r
    } finally {
      setBusy(false)
    }
  }

  return h(
    "div",
      {
        className: "px-6 pt-4 pb-8",
        style: { maxWidth: 1180, margin: "0 auto" },
      },
      // header
      h(
        "div",
          { key: "hdr", style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" } },
          h("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(52,211,153,.08)",
              border: "1px solid rgba(52,211,153,.3)",
            },
          },
            h(Workflow, { size: 18, style: { color: "#34d399" } }),
            h("span", { style: { fontWeight: 700, fontSize: 15, letterSpacing: ".02em" } }, "SI AIDLC"),
            h("span", { style: { fontSize: 11, color: "#64748b" } }, "folder-first AI-DLC studio")),
          h(
            "div",
              { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: cliOk ? "#34d399" : "#fbbf24" } },
            h(Dot, { tone: cliOk ? "#34d399" : "#fbbf24", pulse: !!job && job.kind === "install" }),
            cliOk ? `aidlc ${cli.aidlc.version || "?"}` : "aidlc CLI not installed"),
          cli.git &&
            h("span", { style: { fontSize: 12, color: "#64748b" } }, cli.git.version || "git"),
          h("div", { style: { flex: 1 } }),
          h(Button, { kind: "ghost", onClick: doInstall, disabled: busy },
            h(Download, { size: 13 }),
            cliOk ? "Update CLI" : "Install CLI")
        ),
      // job banner
      job &&
        h(
          "div",
            {
              key: "job",
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                marginBottom: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(34,211,238,.07)",
                border: "1px solid rgba(34,211,238,.3)",
                color: "#67e8f9",
              },
            },
            h(LoaderCircle, { size: 14, style: { animation: "spin 1.2s linear infinite" } }),
            `job running: ${job.kind}${job.project_id ? ` (project ${job.project_id})` : ""} - watch the log below`
          ),
      // error
      error &&
        h(
          "div",
            {
              key: "err",
              style: {
                fontSize: 12,
                color: "#fca5a5",
                background: "rgba(248,113,113,.08)",
                border: "1px solid rgba(248,113,113,.3)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 12,
              },
            },
            error
          ),
      // main grid
      h(
        "div",
          { style: { display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" } },
        // left: projects
        h(
          "div",
            { key: "left", style: { display: "flex", flexDirection: "column", gap: 12 } },
          h(
            Card,
              {
                title: "New project",
                icon: h(FolderPlus, { size: 14, style: { color: "#34d399" } }),
              },
            h(Field, { label: "Folder path", hint: "a local folder - git is optional, and a later step" },
              h("input", {
                style: inputStyle,
                value: np.path,
                placeholder: "e.g. ~/projects/my-app  (or D:\\projects\\my-app)",
                onChange: (e) => setNp({ ...np, path: e.target.value }),
              })),
            h(Field, { label: "Name (optional)" },
              h("input", {
                style: inputStyle,
                value: np.name,
                placeholder: "defaults to the folder name",
                onChange: (e) => setNp({ ...np, name: e.target.value }),
              })),
            h(
              "label",
                { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#94a3b8", cursor: "pointer" } },
              h("input", {
                type: "checkbox",
                checked: np.create,
                onChange: (e) => setNp({ ...np, create: e.target.checked }),
                style: { accentColor: "#34d399" },
              }),
              "create the folder if it does not exist"),
            h(Button, { onClick: doAdd, disabled: busy }, h(FolderPlus, { size: 13 }), "Add project")
          ),
          h(
            Card,
              {
                title: `Projects (${(state && state.projects.length) || 0})`,
                icon: h(Folder, { size: 14, style: { color: "#22d3ee" } }),
              },
            (state && state.projects.length === 0) &&
              h("div", { style: { fontSize: 12, color: "#64748b" } }, "No projects yet. Add a local folder to get started."),
            (state && state.projects || []).map((p) => {
              const active = p.id === sel
              return h(
                "div",
                  {
                    key: p.id,
                    onClick: () => setSel(p.id),
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: active ? "rgba(34,211,238,.08)" : "transparent",
                      border: `1px solid ${active ? "rgba(34,211,238,.4)" : "rgba(148,163,184,.18)"}`,
                    },
                  },
                h(Dot, { tone: p.setup_done ? "#34d399" : "#fbbf24" }),
                h(
                  "div",
                    { style: { flex: 1, minWidth: 0 } },
                  h("div", { style: { fontSize: 13, fontWeight: 600, color: "#e2e8f0" } }, p.name),
                  h(
                    "div",
                      {
                        style: {
                          fontSize: 10.5,
                          fontFamily: MONO,
                          color: "#64748b",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      },
                    p.path
                  ),
                  h(
                    "div",
                      { style: { display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" } },
                    p.harness && h(Chip, null, p.harness),
                    p.scope && h(Chip, null, p.scope),
                    p.setup_done && h(Chip, { tone: "#34d399" }, "set up"),
                    p.git && h(Chip, { tone: "#67e8f9" }, h(GitBranch, { size: 10 }), "git")
                  )
                ),
                h(
                  "button",
                    {
                      style: { ...btnStyle("ghost"), padding: "3px 7px", borderRadius: 6, cursor: "pointer" },
                      title: "Remove from registry (folder untouched)",
                      onClick: (e) => {
                        e.stopPropagation()
                        doRemove(p)
                      },
                    },
                    h(Trash2, { size: 12, style: { color: "#64748b" } })
                  )
              )
            })
          )
        ),
        // right: selected project
        h(
          "div",
            { key: "right", style: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } },
          !proj
            ? h(
                Card,
                  { title: "No project selected", icon: h(Folder, { size: 14, style: { color: "#64748b" } }) },
                h(
                  "div",
                    { style: { fontSize: 12.5, color: "#64748b", lineHeight: 1.7 } },
                  "Pick a project on the left, or add a new local folder. The repo comes second - start with a plain folder and let the app install and configure the aidlc CLI for you.")
              )
            : h(
                "div",
                  { key: "proj", style: { display: "flex", flexDirection: "column", gap: 12 } },
              h(
                "div",
                  { style: { display: "flex", alignItems: "center", gap: 10 } },
                h("div", { style: { flex: 1, minWidth: 0 } },
                  h("div", { style: { fontSize: 16, fontWeight: 700 } }, proj.name),
                  h(
                    "div",
                      { style: { fontSize: 11, fontFamily: MONO, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                    proj.path
                  )
                ),
                pstate &&
                  h(Chip, { tone: pstate.setup_done ? "#34d399" : "#fbbf24" },
                    pstate.setup_done ? "set up" : "needs setup")
              ),
              !proj.setup_done &&
                h(SetupWizard, {
                  proj,
                  state,
                  cliOk,
                  busy,
                  onInstallCli: doInstall,
                  onRun: (harness, preset, scope) => {
                    if (
                      window.confirm(
                        `Run "aidlc config --harness ${harness}" in ${proj.path}?\n\nThis creates the AI-DLC engine, ${harness} glue and your workspace (about 420 files), then records your preset (${preset}) and runs doctor.`
                      )
                    )
                      act(() => startSetup(proj.id, harness, preset, scope))
                  },
                }),
              proj.setup_done &&
                (pstate ? (
                  h(ProjectDashboard, {
                    pstate,
                    busy,
                    onDoctor: doDoctor,
                    onGitInit: () => act(() => gitInit(proj.id)),
                    onRefresh: refreshProject,
                    onRunSetup: () => setSel(null),
                  })
                ) : (
                  h("div", { style: { fontSize: 12, color: "#64748b" } }, "loading project state…")
                ))
            )
        )
      ),
      // log console
      h(
        "div",
          { key: "log", style: { marginTop: 16 } },
        h(
          "div",
            { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
          h("span", { style: { fontSize: 12, fontWeight: 600, color: "#94a3b8" } }, "Live log"),
          h("div", { style: { flex: 1 } }),
          h(
            "label",
              { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#64748b", cursor: "pointer" } },
            h("input", {
              type: "checkbox",
              checked: autoScroll,
              onChange: (e) => setAutoScroll(e.target.checked),
              style: { accentColor: "#34d399" },
            }),
            "auto-scroll")
        ),
        h(LogConsole, { lines, autoScroll })
      )
    )
}
