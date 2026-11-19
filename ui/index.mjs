// SI AIDLC - dashboard page bundle.
//
// Hand-written ESM (no build step): the Kiro Crew host loads this module and
// renders the default-exported component. React and lucide-react are injected
// by the host on window.__kirocrew_modules before the import.
//
// Two distinct contexts, kept separate (never blended on one screen):
//   - "All projects" (admin): manage your AI-DLC portfolio - add/remove local
//     folders, check global CLI health. A clean portfolio surface.
//   - "Working in {project}" (focused): one project at a time - its setup
//     wizard or live dashboard, doctor, git-init, harness handoff, live log.
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
  getGitRemote,
  createIssue,
  setMode,
  spawnTerminal,
  terminalInput,
  terminalResize,
  killTerminal,
  subscribeTerminal,
  radarCrews,
  radarCrew,
  radarCreateCrew,
  radarCrewSettings,
  radarIssues,
  radarPulls,
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
  ArrowLeft,
  ChevronRight,
  Users,
  Bot,
  ListChecks,
  MessageSquare,
  Zap,
  Square,
  RefreshCw,
  Maximize,
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
                color: l.text.startsWith("[si-crewapp-aidlc]") ? "#67e8f9" : undefined,
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

function ProjectDashboard({ pstate, busy, onDoctor, onGitInit, onRefresh }) {
  const [doctor, setDoctor] = useState(null)
  const [copied, setCopied] = useState(false)
  const proj = pstate.project
  const parsed = pstate.state_parsed || {}
  const current =
    parsed.current_stage ||
    Object.keys(parsed.stage_statuses || {}).find((k) => parsed.stage_statuses[k] === "CURRENT")

  const copyLaunch = async () => {
    try {
      // copy the clean, runnable command when we have one (IDE harnesses fall
      // back to the display hint)
      await navigator.clipboard.writeText(pstate.launch_cmd || pstate.launch || "")
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
// ADMIN view - "all projects" (portfolio management). No project focus.

function ProjectsView({ state, np, setNp, busy, onOpen, onAdd, onRemove }) {
  const projects = (state && state.projects) || []
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 16 } },
    // page title bar
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          paddingBottom: 8,
          borderBottom: "1px solid rgba(148,163,184,.18)",
        },
      },
      h("span", { style: { fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: ".01em" } }, "Project Management"),
      h("span", { style: { fontSize: 11.5, color: "#64748b" } },
        projects.length ? `${projects.length} tracked in your AI-DLC portfolio` : "your AI-DLC portfolio")
    ),
    // add project
    h(
      Card,
        { title: "Add a project", icon: h(FolderPlus, { size: 14, style: { color: "#34d399" } }) },
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
      h(Button, { onClick: onAdd, disabled: busy }, h(FolderPlus, { size: 13 }), "Add project")
    ),
    // all projects label - just above the list itself
    projects.length > 0 &&
      h(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 } },
        h("span", { style: { fontSize: 13, fontWeight: 700, color: "#e2e8f0" } }, "All Projects"),
        h("span", { style: { fontSize: 11, color: "#64748b" } }, `${projects.length} tracked`)
      ),
    // project cards
    projects.length === 0
      ? h("div", { style: { fontSize: 12.5, color: "#64748b", padding: "4px 2px" } },
          "No projects yet. Add a local folder above to get started.")
      : h(
          "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 } },
          projects.map((p) =>
            h(
              "div",
                {
                  key: p.id,
                  onClick: () => onOpen(p.id),
                  style: {
                    border: "1px solid rgba(148,163,184,.22)",
                    borderRadius: 12,
                    background: "rgba(15,23,42,.35)",
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    cursor: "pointer",
                  },
                },
              h(
                "div",
                { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
                h(Dot, { tone: p.setup_done ? "#34d399" : "#fbbf24" }),
                h("div", { style: { flex: 1, minWidth: 0 } },
                  h("div", { style: { fontSize: 14, fontWeight: 600, color: "#e2e8f0" } }, p.name),
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
                  )
                ),
                h(
                  "button",
                    {
                      style: { ...btnStyle("ghost"), padding: "3px 7px", borderRadius: 6, cursor: "pointer" },
                      title: "Remove from registry (folder untouched)",
                      onClick: (e) => {
                        e.stopPropagation()
                        onRemove(p)
                      },
                    },
                    h(Trash2, { size: 12, style: { color: "#64748b" } })
                  )
              ),
              h(
                "div",
                { style: { display: "flex", gap: 5, flexWrap: "wrap" } },
                p.harness && h(Chip, null, p.harness),
                p.scope && h(Chip, null, p.scope),
                p.setup_done && h(Chip, { tone: "#34d399" }, "set up"),
                p.git && h(Chip, { tone: "#67e8f9" }, h(GitBranch, { size: 10 }), "git")
              ),
              h(
                "div",
                { style: { display: "flex", justifyContent: "flex-end" } },
                h(Button, { kind: "ghost", small: true, onClick: (e) => { e.stopPropagation(); onOpen(p.id) } },
                  "Open", h(ChevronRight, { size: 12 }))
              )
            )
          )
        )
  )
}

// ---------------------------------------------------------------------------
// WORKING view - "the current project" (focused, one at a time)

function WorkingView({
  proj,
  pstate,
  busy,
  state,
  cliOk,
  onBack,
  onDoctor,
  onGitInit,
  onRefresh,
  onInstallCli,
  onRunSetup,
  onSetMode,
  lines,
  autoScroll,
  setAutoScroll,
}) {
  return h(
    "div",
    { style: { display: "flex", gap: 12, alignItems: "stretch" } },
    // main content (left column)
    h(
      "div",
      { style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 } },
      // back + project header
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10 } },
        h(Button, { kind: "ghost", onClick: onBack }, h(ArrowLeft, { size: 14 }), "Project Management"),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", { style: { fontSize: 18, fontWeight: 700 } }, proj.name),
          h(
            "div",
            {
              style: {
                fontSize: 11,
                fontFamily: MONO,
                color: "#64748b",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            proj.path
          )
        ),
        pstate &&
          h(Chip, { tone: pstate.setup_done ? "#34d399" : "#fbbf24" },
            pstate.setup_done ? "set up" : "needs setup")
      ),
      // the one project's surface: setup wizard (pre-setup) or dashboard (post-setup)
      !proj.setup_done
        ? h(SetupWizard, { proj, state, cliOk, busy, onInstallCli, onRun: (harness, preset, scope) => onRunSetup(harness, preset, scope) })
        : pstate
          ? h(ProjectDashboard, { pstate, busy, onDoctor, onGitInit, onRefresh })
          : h("div", { style: { fontSize: 12, color: "#64748b" } }, "loading project state…"),
      // the crew cockpit: mode toggle + (crew mode) dashboard/kanban/intake
      h(CrewCockpit, { proj, onSetMode }),
      // live log (belongs to the working context, not the admin one)
      h(
        "div",
        { style: { marginTop: 4 } },
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
    ),
    // terminal drawer (right column) - pops out, resizable, session persists when collapsed
    h(TerminalDrawer, {
      pid: proj.id,
      launchCmd: pstate && pstate.launch_cmd,
      launchHint: pstate && pstate.launch_hint,
    })
  )
}

// ---------------------------------------------------------------------------
// crew cockpit - issue-radar as a companion service (app-to-app, "case a")
//
// SI AIDLC is the client; issue-radar is the crew service. They stay decoupled
// and meet only at the shared repo: we create the crew + arm wake-on-new-work
// through issue-radar's HTTP surface, we mint GitHub issues ourselves (issue-
// radar has no create-issue route), and issue-radar's watcher wakes the crew.

// Solo / Crew-Enabled mode toggle.
function ModeToggle({ mode, onMode }) {
  const opt = (m, label, icon) =>
    h(
      "button",
      {
        onClick: () => onMode(m),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          border: mode === m ? "1px solid rgba(52,211,153,.6)" : "1px solid rgba(148,163,184,.3)",
          background: mode === m ? "rgba(52,211,153,.15)" : "transparent",
          color: mode === m ? "#34d399" : "#94a3b8",
        },
      },
      icon,
      label
    )
  return h(
    "div",
    {
      style: {
        display: "inline-flex",
        gap: 4,
        alignItems: "center",
        background: "rgba(2,6,23,.5)",
        padding: 4,
        borderRadius: 999,
        border: "1px solid rgba(148,163,184,.2)",
      },
    },
    opt("solo", "Solo", h(Users, { size: 12 })),
    opt("crew", "Crew", h(Bot, { size: 12 }))
  )
}

// A compact stat tile for the status dashboard.
function StatTile({ icon, label, value, sub, tone = "#e2e8f0" }) {
  return h(
    "div",
    {
      style: {
        border: "1px solid rgba(148,163,184,.22)",
        borderRadius: 12,
        background: "rgba(15,23,42,.35)",
        padding: 13,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        flex: "1 1 140px",
        minWidth: 140,
      },
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 7 } },
      icon,
      h(
        "span",
        {
          style: {
            fontSize: 10.5,
            fontWeight: 600,
            color: "#94a3b8",
            letterSpacing: ".05em",
            textTransform: "uppercase",
          },
        },
        label
      )
    ),
    h("div", { style: { fontSize: 22, fontWeight: 700, color: tone, lineHeight: 1 } }, value),
    sub ? h("div", { style: { fontSize: 11, color: "#64748b" } }, sub) : null
  )
}

// One kanban card (an issue or a PR).
function KanbanCard({ item, isPr }) {
  const labels = (item.labels || []).slice(0, 3)
  const checks = item.checks_state
  return h(
    "div",
    {
      style: {
        border: "1px solid rgba(148,163,184,.2)",
        borderRadius: 8,
        background: "rgba(15,23,42,.5)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      },
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b", fontFamily: MONO } },
      h("span", { style: { color: "#67e8f9" } }, isPr ? "!" : "#", item.number),
      isPr &&
        checks &&
        h(
          Chip,
          {
            tone:
              checks === "success"
                ? "#34d399"
                : checks === "failure"
                  ? "#f87171"
                  : checks === "running"
                    ? "#fbbf24"
                    : "#94a3b8",
            bg: "transparent",
          },
          checks
        ),
      h("span", { style: { flex: 1 } })
    ),
    h(
      "div",
      {
        style: {
          fontSize: 12.5,
          color: "#e2e8f0",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
        title: item.title,
      },
      item.title
    ),
    labels.length
      ? h(
          "div",
          { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
          labels.map((l) => h(Chip, { key: l, tone: "#94a3b8" }, l))
        )
      : null
  )
}

// Backlog / In progress / Done. Driven by the live issue + PR lists from
// issue-radar. An open issue is "in progress" when an open PR references it.
function KanbanBoard({ issues, pulls }) {
  const openIssues = (issues || []).filter((i) => !i.state || i.state === "open")
  const closedIssues = (issues || []).filter((i) => i.state === "closed").slice(0, 12)
  const openPulls = (pulls || []).filter((p) => !p.state || p.state === "open")
  const mergedPulls = (pulls || []).filter((p) => p.merged_at).slice(0, 12)

  const linked = new Set()
  for (const pr of openPulls) {
    const m = (pr.body || "").match(/(?:fixes|closes|resolves)\s+#(\d+)/i)
    if (m) linked.add(Number(m[1]))
  }
  const inProgressIssues = openIssues.filter((i) => linked.has(i.number))
  const backlog = openIssues.filter((i) => !linked.has(i.number))

  const empty = (t) => h("div", { style: { fontSize: 11, color: "#475569" } }, t)
  const column = (title, tone, children) =>
    h(
      "div",
      {
        style: {
          flex: "1 1 0",
          minWidth: 190,
          border: "1px solid rgba(148,163,184,.18)",
          borderRadius: 10,
          background: "rgba(2,6,23,.4)",
          display: "flex",
          flexDirection: "column",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 11px",
            borderBottom: "1px solid rgba(148,163,184,.15)",
            fontSize: 11,
            fontWeight: 700,
            color: tone,
            letterSpacing: ".05em",
            textTransform: "uppercase",
          },
        },
        title
      ),
      h(
        "div",
        {
          style: {
            padding: 9,
            display: "flex",
            flexDirection: "column",
            gap: 7,
            overflowY: "auto",
            maxHeight: 280,
          },
        },
        children
      )
    )

  return h(
    "div",
    { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
    column(
      `Backlog (${backlog.length})`,
      "#94a3b8",
      backlog.length ? backlog.map((i) => h(KanbanCard, { key: "i" + i.number, item: i })) : empty("no open issues")
    ),
    column(
      `In progress (${openPulls.length + inProgressIssues.length})`,
      "#34d399",
      openPulls.length || inProgressIssues.length
        ? [
            ...openPulls.map((p) => h(KanbanCard, { key: "p" + p.number, item: p, isPr: true })),
            ...inProgressIssues.map((i) => h(KanbanCard, { key: "i" + i.number, item: i })),
          ]
        : empty("no work in flight")
    ),
    column(
      `Done (${closedIssues.length + mergedPulls.length})`,
      "#67e8f9",
      closedIssues.length || mergedPulls.length
        ? [
            ...mergedPulls.map((p) => h(KanbanCard, { key: "m" + p.number, item: p, isPr: true })),
            ...closedIssues.map((i) => h(KanbanCard, { key: "c" + i.number, item: i })),
          ]
        : empty("nothing completed yet")
    )
  )
}

// AI intake: describe the work -> mint a GitHub issue (the trigger that wakes
// the crew). issue-radar has no create-issue route, so we own this via `gh`.
function IntakeForm({ pid, onCreated }) {
  const [text, setText] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [err, setErr] = useState("")

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    setErr("")
    setCreated(null)
    try {
      const parts = text.trim().split("\n")
      const title = (parts[0] || "New work").slice(0, 120)
      const body = parts.slice(1).join("\n")
      const r = await createIssue(pid, { title, body, labels: label.trim() ? [label.trim()] : undefined })
      setCreated(r)
      setText("")
      setLabel("")
      onCreated && onCreated(r)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 8 } },
    h(
      "textarea",
      {
        style: { ...inputStyle, minHeight: 72, resize: "vertical", fontFamily: "inherit" },
        value: text,
        placeholder: "What do you want to work on, fix, or add? A sentence or two is enough.",
        onChange: (e) => setText(e.target.value),
      }
    ),
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
      h(
        "input",
        {
          style: { ...inputStyle, width: 170, flex: "0 0 auto" },
          value: label,
          placeholder: "label (optional)",
          onChange: (e) => setLabel(e.target.value),
        }
      ),
      h(
        Button,
        { onClick: submit, disabled: busy || !text.trim() },
        busy ? h(LoaderCircle, { size: 13, style: { animation: "spin 1.2s linear infinite" } }) : h(MessageSquare, { size: 13 }),
        "Create issue & wake crew"
      ),
      created &&
        h(
          "span",
          { style: { fontSize: 11.5, color: "#34d399", display: "inline-flex", alignItems: "center", gap: 5 } },
          h(CircleCheck, { size: 12 }),
          created.url
            ? h("a", { href: created.url, target: "_blank", rel: "noreferrer", style: { color: "#34d399" } }, created.url)
            : `issue #${created.number} created`
        )
    ),
    err && h("div", { style: { fontSize: 11.5, color: "#f87171" } }, err)
  )
}

// Self-contained terminal: streams a local shell's I/O (spawned by the backend
// PTY bridge) and forwards input. No xterm.js / no build step - ANSI stripped,
// output in a scroll pane, a command line at the bottom.
// Self-contained terminal: streams a local shell's I/O (spawned by the backend
// PTY bridge) and forwards input. No xterm.js / no build step - ANSI stripped,
// output in a scroll pane that fills its parent, a command line at the bottom.
// Reports liveness via onActiveChange so the enclosing drawer can show a dot.
function TerminalWidget({ pid, launchCmd, launchHint, onActiveChange }) {
  const [tid, setTid] = useState(null)
  const [out, setOut] = useState("")
  const [exited, setExited] = useState(null)
  const [cmd, setCmd] = useState("")
  const [spawning, setSpawning] = useState(false)
  const subRef = useRef(null)
  const preRef = useRef(null)

  const spawn = useCallback(
    async (command) => {
      if (subRef.current) subRef.current.close()
      setSpawning(true)
      setOut("")
      setExited(null)
      try {
        const r = await spawnTerminal(pid, command)
        setTid(r.terminal_id)
        subRef.current = subscribeTerminal(r.terminal_id, {
          onOut: (d) => {
            if (d && d.data) {
              let s
              try {
                s = atob(d.data)
              } catch {
                return
              }
              setOut((prev) => (prev.length > 60000 ? prev.slice(-40000) : prev) + s)
            }
          },
          onExit: (d) => setExited(d && d.exit != null ? d.exit : -1),
        })
      } catch (e) {
        setOut("terminal spawn failed: " + (e.message || e))
      } finally {
        setSpawning(false)
      }
    },
    [pid]
  )

  const send = () => {
    const c = cmd
    if (!tid || !c) return
    try {
      terminalInput(tid, btoa(c + "\r")).catch(() => {})
      setOut((prev) => prev + "\n> " + c + "\n")
      setCmd("")
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [out])

  useEffect(
    () => () => {
      if (subRef.current) subRef.current.close()
    },
    []
  )

  const running = tid != null && exited == null
  useEffect(() => {
    if (onActiveChange) onActiveChange(running || spawning)
  }, [running, spawning, onActiveChange])

  const clean = out.replace(/\x1b\[[0-9;?]*[ -~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
  const placeholder = spawning
    ? "spawning…"
    : tid
      ? "running - waiting for the harness to produce output…"
      : "no terminal yet - start a shell or launch the harness above"

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0 } },
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
      h(Button, { small: true, kind: "ghost", onClick: () => spawn(null), disabled: spawning || running },
        h(Terminal, { size: 12 }),
        "Shell"),
      launchCmd
        ? h(
            Button,
            { small: true, kind: "ghost", onClick: () => spawn(launchCmd), disabled: spawning || running },
            h(Rocket, { size: 12 }),
            "Launch harness"
          )
        : h(
            "span",
            { style: { fontSize: 11, color: "#64748b" } },
            "no CLI for this harness"
          ),
      tid &&
        h(Button, { small: true, kind: "danger", onClick: () => killTerminal(tid).catch(() => {}) },
          h(Square, { size: 12 }),
          "Stop"),
      h("div", { style: { flex: 1 } }),
      tid &&
        h(
          "span",
          { style: { fontSize: 11, color: running ? "#34d399" : "#64748b", fontFamily: MONO } },
          running ? "· running" : "· exited (" + exited + ")"
        )
    ),
    launchHint &&
      h(
        "div",
        { style: { fontSize: 11, color: "#64748b", fontFamily: MONO } },
        h("span", { style: { color: "#a78bfa" } }, "tip: "),
        launchHint
      ),
    h(
      "div",
      {
        ref: preRef,
        style: {
          flex: 1,
          minHeight: 120,
          overflow: "auto",
          background: "rgba(2,6,23,.85)",
          border: "1px solid rgba(148,163,184,.25)",
          borderRadius: 8,
          padding: "10px 12px",
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "#cbd5e1",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
      },
      clean ? clean : h("span", { style: { color: "#475569" } }, placeholder)
    ),
    h(
      "div",
      { style: { display: "flex", gap: 8 } },
      h(
        "input",
        {
          style: { ...inputStyle, flex: 1 },
          value: cmd,
          placeholder: running ? "type a command and press Enter (sent to the live shell)" : "start a terminal first",
          disabled: !running,
          onChange: (e) => setCmd(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              send()
            }
          },
        }
      ),
      h(Button, { small: true, onClick: send, disabled: !running || !cmd }, "Send")
    )
  )
}

// clamp a number into [lo, hi]
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// Right-hand terminal drawer. Collapses to a slim vertical tab and "pops out"
// into a resizable panel (drag the left edge, double-click it, or maximize).
// The TerminalWidget stays mounted while collapsed so a live session keeps
// streaming - closing the drawer never kills the process.
function TerminalDrawer({ pid, launchCmd, launchHint }) {
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState(460)
  const [maximized, setMaximized] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [active, setActive] = useState(false)

  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev) => setWidth(clamp(startW + (startX - ev.clientX), 300, 880))
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    setDragging(true)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const panelW = maximized ? "calc(100% - 4px)" : width + "px"

  return h(
    "div",
    {
      style: {
        position: "relative",
        flex: "0 0 auto",
        width: open ? panelW : 44,
        maxWidth: "100%",
        minHeight: 360,
        border: "1px solid rgba(148,163,184,.25)",
        borderRadius: 10,
        background: "rgba(2,6,23,.6)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: open ? "default" : "pointer",
        transition: dragging ? "none" : "width .18s ease",
      },
      onClick: () => !open && setOpen(true),
    },
    // left-edge resize handle (open + not maximized only)
    open &&
      !maximized &&
      h("div", {
        onMouseDown: startDrag,
        onDoubleClick: () => setMaximized(true),
        title: "Drag to resize · double-click to maximize",
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: "col-resize",
          zIndex: 2,
          background: dragging ? "rgba(52,211,153,.35)" : "transparent",
        },
      }),
    // header (open only)
    open &&
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            borderBottom: "1px solid rgba(148,163,184,.18)",
          },
        },
        h(Terminal, { size: 14, style: { color: "#34d399" } }),
        h("span", { style: { fontSize: 12.5, fontWeight: 600, color: "#e2e8f0", flex: 1 } }, "Terminal"),
        h(
          Button,
          {
            small: true,
            kind: "ghost",
            onClick: () => setMaximized((m) => !m),
            title: maximized ? "Restore" : "Maximize",
          },
          maximized ? h(Square, { size: 12 }) : h(Maximize, { size: 12 })
        ),
        h(Button, { small: true, kind: "ghost", onClick: () => setOpen(false), title: "Collapse" }, h(X, { size: 12 }))
      ),
    // collapsed vertical tab (icon + label + live dot)
    !open &&
      h(
        "div",
        {
          style: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            paddingTop: 14,
          },
        },
        h(Terminal, { size: 16, style: { color: active ? "#34d399" : "#94a3b8" } }),
        active &&
          h("span", {
            style: { width: 7, height: 7, borderRadius: 999, background: "#34d399", boxShadow: "0 0 8px #34d399" },
          }),
        h(
          "span",
          {
            style: {
              writingMode: "vertical-rl",
              fontSize: 11,
              fontWeight: 600,
              color: "#94a3b8",
              letterSpacing: ".08em",
            },
          },
          "Terminal"
        )
      ),
    // body - always mounted (hidden when collapsed) so a live session persists
    h(
      "div",
      { style: { flex: 1, minHeight: 0, display: open ? "flex" : "none", flexDirection: "column", padding: 10 } },
      h(TerminalWidget, { pid, launchCmd, launchHint, onActiveChange: setActive })
    )
  )
}

// The crew cockpit: mode toggle + status dashboard + "enable a crew" auto-setup
// + kanban + AI intake. The dashboard/kanban/intake show in crew mode; the mode
// toggle is always present. The terminal lives in its own right-hand drawer.
function CrewCockpit({ proj, onSetMode }) {
  const pid = proj.id
  const mode = proj.mode || "solo"
  const [remote, setRemote] = useState(null)
  const [radar, setRadar] = useState(null)
  const [radarErr, setRadarErr] = useState("")
  const [crewName, setCrewName] = useState(
    (proj.name || "crew").trim().replace(/\s+/g, "-").toLowerCase() + "-crew"
  )
  const [enabling, setEnabling] = useState(false)

  // the git remote (owner/repo) the crew binds to
  useEffect(() => {
    let stop = false
    getGitRemote(pid).then((r) => !stop && setRemote(r)).catch(() => {})
    return () => {
      stop = true
    }
  }, [pid])

  const owner = remote && remote.owner
  const repo = remote && remote.repo
  const hasCrew = mode === "crew"

  const load = useCallback(async () => {
    if (!owner || !repo) return
    try {
      const [c, i, p] = await Promise.all([radarCrews(owner, repo), radarIssues(owner, repo), radarPulls(owner, repo)])
      setRadar({
        crews: c.crews || [],
        counts: c.counts || {},
        settings: c.settings || {},
        issues: i.issues || [],
        pulls: p.pulls || [],
      })
      setRadarErr("")
    } catch (e) {
      setRadarErr(e.message || String(e))
    }
  }, [owner, repo])

  useEffect(() => {
    if (!owner || !repo) return
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load, owner, repo])

  const enableCrew = async () => {
    if (!owner || !repo) return
    setEnabling(true)
    setRadarErr("")
    try {
      const r = await radarCreateCrew(owner, repo, { name: crewName })
      const crew = r.crew || {}
      // arm the trigger: a new issue wakes the crew
      await radarCrewSettings(owner, repo, { crew_wake_on_new_work: true })
      onSetMode("crew", { id: crew.id, name: crew.name, owner, repo })
      await load()
    } catch (e) {
      setRadarErr("enable crew: " + (e.message || String(e)))
    } finally {
      setEnabling(false)
    }
  }

  const counts = (radar && radar.counts) || {}
  const issues = (radar && radar.issues) || []
  const pulls = (radar && radar.pulls) || []
  const crews = (radar && radar.crews) || []
  const openIssues = issues.filter((i) => !i.state || i.state === "open").length
  const openPulls = pulls.filter((p) => !p.state || p.state === "open").length
  const wakeOn = radar && radar.settings && radar.settings.crew_wake_on_new_work

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 12 } },
    // mode toggle
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      h(ModeToggle, { mode, onMode: (m) => onSetMode(m, null) }),
      h("span", { style: { fontSize: 11, color: "#64748b" } },
        hasCrew
          ? "a named issue-radar crew works this repo in its own worktree; you work in the main checkout"
          : "just you and the harness - no crew on this project")
    ),
    // repo binding
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontFamily: MONO,
          color: "#94a3b8",
          background: "rgba(15,23,42,.3)",
          border: "1px solid rgba(148,163,184,.2)",
          borderRadius: 8,
          padding: "8px 12px",
        },
      },
      h(GitBranch, { size: 13, style: { color: "#67e8f9" } }),
      owner && repo
        ? h("span", null, owner + "/" + repo, h("span", { style: { color: "#475569" } }, "  ·  origin"))
        : h("span", { style: { color: "#fbbf24" } }, "no git origin - a crew needs a repo remote to bind to")
    ),
    // status dashboard (crew mode, first-class)
    hasCrew &&
      h(
        "div",
        { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
        h(StatTile, {
          icon: h(Bot, { size: 15, style: { color: "#34d399" } }),
          label: "Crews on duty",
          value: counts.on_duty != null ? counts.on_duty : crews.length,
          sub:
            counts.working != null
              ? `${counts.working} working · ${counts.paused || 0} paused`
              : `${crews.length} total`,
          tone: "#34d399",
        }),
        h(StatTile, {
          icon: h(ListChecks, { size: 15, style: { color: "#fbbf24" } }),
          label: "Open issues",
          value: openIssues,
          sub: "the crew's queue",
          tone: "#fbbf24",
        }),
        h(StatTile, {
          icon: h(GitBranch, { size: 15, style: { color: "#67e8f9" } }),
          label: "Open PRs",
          value: openPulls,
          sub: "in review / CI",
          tone: "#67e8f9",
        }),
        h(StatTile, {
          icon: h(Zap, { size: 15, style: { color: wakeOn ? "#a78bfa" : "#64748b" } }),
          label: "Wake on new work",
          value: wakeOn ? "on" : "off",
          sub: "new issues wake the crew",
          tone: wakeOn ? "#a78bfa" : "#64748b",
        })
      ),
    // enable a crew (auto-setup) - shown until a crew exists for this repo
    (!hasCrew || crews.length === 0) &&
      h(
        Card,
        { title: "Enable a crew on this repo", icon: h(Bot, { size: 14, style: { color: "#34d399" } }) },
        h(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" } },
          h(Field, { label: "Crew name" },
            h("input", {
              style: { ...inputStyle, width: 220, flex: "0 0 auto" },
              value: crewName,
              onChange: (e) => setCrewName(e.target.value),
            })),
          h(
            Button,
            { onClick: enableCrew, disabled: enabling || !owner || !repo },
            enabling
              ? h(LoaderCircle, { size: 13, style: { animation: "spin 1.2s linear infinite" } })
              : h(Zap, { size: 13 }),
            "Enable crew")
        ),
        h(
          "div",
          { style: { fontSize: 11, color: "#64748b" } },
          "Creates a named issue-radar crew bound to this repo and turns on wake-on-new-work, so any issue you create here wakes the crew. The crew works in its own git worktree; you keep the main checkout.")
      ),
    // kanban
    hasCrew &&
      h(
        Card,
        { title: "Board", icon: h(ListChecks, { size: 14, style: { color: "#22d3ee" } }) },
        radar
          ? h(KanbanBoard, { issues, pulls })
          : h("div", { style: { fontSize: 12, color: "#64748b" } }, "loading board…")
      ),
    // intake
    hasCrew &&
      h(
        Card,
        {
          title: "Intake - what should the crew do next?",
          icon: h(MessageSquare, { size: 14, style: { color: "#a78bfa" } }),
        },
        h(IntakeForm, { pid, onCreated: () => load() })
      ),
    // error
    radarErr &&
      h(
        "div",
        {
          style: {
            fontSize: 11.5,
            color: "#f87171",
            background: "rgba(248,113,113,.08)",
            border: "1px solid rgba(248,113,113,.3)",
            borderRadius: 8,
            padding: "8px 12px",
          },
        },
        radarErr
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
      // jump straight into the working context for the new project
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

  const doRunSetup = (harness, preset, scope) => {
    if (!proj) return
    if (
      window.confirm(
        `Run "aidlc config --harness ${harness}" in ${proj.path}?\n\nThis creates the AI-DLC engine, ${harness} glue and your workspace (about 420 files), then records your preset (${preset}) and runs doctor.`
      )
    )
      act(() => startSetup(proj.id, harness, preset, scope))
  }

  // switch Solo <-> Crew, optionally persisting the issue-radar crew ref
  const doSetMode = (mode, crew) => act(() => setMode(proj.id, mode, crew))

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
            `job running: ${job.kind}${job.project_id ? ` (project ${job.project_id})` : ""}`
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
      // the two contexts, never blended: admin portfolio OR one focused project
      sel && proj
        ? h(WorkingView, {
            proj,
            pstate,
            busy,
            state,
            cliOk,
            onBack: () => setSel(null),
            onDoctor: doDoctor,
            onGitInit: () => act(() => gitInit(proj.id)),
            onRefresh: refreshProject,
            onInstallCli: doInstall,
            onRunSetup: doRunSetup,
            onSetMode: doSetMode,
            lines,
            autoScroll,
            setAutoScroll,
          })
        : h(ProjectsView, {
            state,
            np,
            setNp,
            busy,
            onOpen: (id) => setSel(id),
            onAdd: doAdd,
            onRemove: doRemove,
          })
    )
}
