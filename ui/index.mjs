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
  openTerminal,
  getProjectFiles,
  openInExplorer,
  getGhStatus,
  hostOnGithub,
  radarConnect,
  radarCrews,
  radarCrew,
  radarCreateCrew,
  radarCrewSettings,
  radarIssues,
  radarPulls,
  radarRepos,
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
  File,
  FolderOpen,
  RefreshCw,
} = window.__kirocrew_modules["lucide-react"]

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

// ---------------------------------------------------------------------------
// shared bits

function Dot({ tone = "#6b7280", pulse = false, size = 8 }) {
  return h("span", {
    className: pulse ? "aidlc-dot-pulse" : undefined,
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      background: tone,
      display: "inline-block",
      flexShrink: 0,
      boxShadow: `0 0 ${size * 0.8}px ${tone}cc, 0 0 ${size * 1.8}px ${tone}55`,
    },
  })
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
        textShadow: `0 0 8px ${tone}66`,
      },
    },
    children
  )
}

function btnStyle(kind = "ok") {
  if (kind === "ghost")
    return {
      background: "rgba(34,211,238,.04)",
      border: "1px solid rgba(34,211,238,.35)",
      color: "#a5f3fc",
    }
  if (kind === "danger")
    return {
      background: "rgba(248,113,113,.1)",
      border: "1px solid rgba(248,113,113,.45)",
      color: "#fca5a5",
      boxShadow: "0 0 14px rgba(248,113,113,.18)",
    }
  return {
    background: "linear-gradient(135deg, #4ade80, #22d3ee 70%, #818cf8)",
    border: "1px solid rgba(34,211,238,.6)",
    color: "#04120f",
    fontWeight: 700,
    boxShadow: "0 0 16px rgba(34,211,238,.35)",
  }
}

function Button({ kind, onClick, disabled, children, title, small }) {
  return h(
    "button",
    {
      onClick,
      disabled,
      title,
      className: "aidlc-btn",
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

function Card({ title, icon, actions, children, tone, pulse }) {
  return h(
    "div",
    {
      className: "aidlc-card aidlc-fade-up" + (pulse ? " aidlc-heartbeat" : ""),
      style: {
        border: "1px solid rgba(34,211,238,.16)",
        borderRadius: 14,
        background: "rgba(10,14,26,.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 0 0 1px rgba(34,211,238,.04), 0 0 22px rgba(34,211,238,.09), 0 10px 34px rgba(2,6,23,.55)",
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
  border: "1px solid rgba(34,211,238,.28)",
  background: "rgba(5,7,18,.72)",
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
// NEON theme - a <style> block with keyframes + scoped aidlc-* classes that give
// the app its "futuristic / fluorescent" look: a deep-space grid background,
// glass panels with neon borders, glow-on-hover, and a few orchestrated motions
// (fade-up entrance, live-dot glow, title flicker). All motion respects the
// user's prefers-reduced-motion. Scoped with an `aidlc-` prefix so it never
// collides with the host's own CSS.
const NEON_CSS = `
@keyframes aidlc-spin { to { transform: rotate(360deg); } }
@keyframes aidlc-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes aidlc-glow {
  0%, 100% { box-shadow: 0 0 10px rgba(34,211,238,.20); }
  50%      { box-shadow: 0 0 28px rgba(34,211,238,.50); }
}
@keyframes aidlc-dot-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.45); }
}
@keyframes aidlc-flicker {
  0%, 91%, 100% { opacity: 1; }
  92% { opacity: .55; }
  93% { opacity: 1; }
  95% { opacity: .8; }
  96% { opacity: 1; }
}
.aidlc-root {
  position: relative;
  min-height: 100vh;
  background-color: #05060f;
  background-image:
    radial-gradient(1200px 620px at 18% -8%, rgba(34,211,238,.17), transparent 62%),
    radial-gradient(1000px 520px at 92% 2%, rgba(168,85,247,.17), transparent 62%),
    radial-gradient(900px 460px at 50% 118%, rgba(52,211,153,.12), transparent 60%),
    linear-gradient(rgba(34,211,238,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34,211,238,.05) 1px, transparent 1px);
  background-size: auto, auto, auto, 44px 44px, 44px 44px;
}
.aidlc-neon-title { text-shadow: 0 0 10px rgba(34,211,238,.7), 0 0 22px rgba(34,211,238,.35); }
.aidlc-card { transition: border-color .25s ease, box-shadow .25s ease, transform .25s ease; }
.aidlc-card:hover {
  border-color: rgba(34,211,238,.55);
  box-shadow: 0 0 26px rgba(34,211,238,.20), inset 0 0 18px rgba(34,211,238,.06);
  transform: translateY(-2px);
}
.aidlc-btn { transition: box-shadow .2s ease, transform .15s ease, filter .2s ease; }
.aidlc-btn:hover:not(:disabled) {
  box-shadow: 0 0 18px rgba(52,211,153,.55);
  transform: translateY(-1px);
  filter: brightness(1.1);
}
.aidlc-btn:active:not(:disabled) { transform: translateY(0); }
.aidlc-input { transition: border-color .2s ease, box-shadow .2s ease; }
.aidlc-input:focus {
  border-color: rgba(34,211,238,.75);
  box-shadow: 0 0 0 3px rgba(34,211,238,.16), 0 0 20px rgba(34,211,238,.28);
}
.aidlc-fade-up { animation: aidlc-fade-up .55s cubic-bezier(.22,1,.36,1) both; }
.aidlc-glow-pulse { animation: aidlc-glow 3.2s ease-in-out infinite; }
.aidlc-dot-pulse { animation: aidlc-dot-pulse 1.6s ease-in-out infinite; }
.aidlc-flicker { animation: aidlc-flicker 7s linear infinite; }
.aidlc-neon-top { position: relative; border-radius: 14px; }
.aidlc-neon-top::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(90deg, transparent, #22d3ee 30%, #a855f7 70%, transparent);
  box-shadow: 0 0 14px rgba(34,211,238,.8);
}
@keyframes aidlc-heartbeat {
  0%        { box-shadow: 0 0 0 0 rgba(52,211,153,.50);  opacity: .9; }
  14%       { box-shadow: 0 0 26px 4px rgba(52,211,153,.80); opacity: 1; }
  30%       { box-shadow: 0 0 5px 1px rgba(52,211,153,.25); opacity: .5; }
  44%       { box-shadow: 0 0 18px 3px rgba(52,211,153,.65); opacity: .95; }
  75%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0);    opacity: .3; }
}
.aidlc-heartbeat { position: relative; }
.aidlc-heartbeat::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 16px;
  border: 1px solid rgba(52,211,153,.35);
  pointer-events: none;
  animation: aidlc-heartbeat 2.2s ease-in-out infinite;
}
@keyframes aidlc-scan {
  0%   { top: -15%; }
  100% { top: 115%; }
}
.aidlc-scan-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 40;
}
.aidlc-scanline {
  position: absolute;
  left: 0;
  right: 0;
  top: -15%;
  height: 140px;
  background: linear-gradient(180deg, transparent, rgba(34,211,238,.06) 45%, rgba(168,85,247,.05) 55%, transparent);
  pointer-events: none;
  animation: aidlc-scan 10s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .aidlc-fade-up, .aidlc-glow-pulse, .aidlc-dot-pulse, .aidlc-flicker { animation: none !important; }
  .aidlc-heartbeat::after, .aidlc-scanline { animation: none !important; }
  .aidlc-scanline { display: none; }
  .aidlc-card, .aidlc-btn, .aidlc-input { transition: none !important; }
}
`

function NeonStyles() {
  return h("style", null, NEON_CSS)
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
        border: "1px solid rgba(34,211,238,.22)",
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
            previewing ? h(LoaderCircle, { size: 14, style: { animation: "aidlc-spin 1.2s linear infinite" } }) : h(Settings2, { size: 14 }),
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
          borderBottom: "1px solid rgba(34,211,238,.2)",
        },
      },
      h("span", { className: "aidlc-neon-title", style: { fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: ".01em" } }, "Project Management"),
      h("span", { style: { fontSize: 11.5, color: "#64748b" } },
        projects.length ? `${projects.length} tracked in your AI-DLC portfolio` : "your AI-DLC portfolio")
    ),
    // top row: the global settings status (left) + the compact add-project panel (right)
    h(
      "div",
      { style: { display: "flex", gap: 16, alignItems: "flex-start" } },
      // left column: the global settings status dashboard (connectors, not a
      // per-project git stage)
      h(
        "div",
        { style: { flex: "0 0 240px", width: 240, display: "flex", flexDirection: "column", gap: 12 } },
        h(DependencyStatusDashboard)
      ),
      // right column: the compact add-project panel, left-aligned so it lines
      // up with the full-width project grid below
      h(
        "div",
        { style: { flex: "1 1 0", minWidth: 0 } },
        h(
          "div",
            { className: "aidlc-neon-top", style: { width: 560, maxWidth: "100%" } },
        h(
          Card,
            { title: "Add a project", icon: h(FolderPlus, { size: 14, style: { color: "#4ade80" } }), pulse: true },
          h(Field, { label: "Folder path", hint: "a local folder - git is optional, and a later step" },
            h("input", {
              className: "aidlc-input",
              style: inputStyle,
              value: np.path,
              placeholder: "e.g. ~/projects/my-app  (or D:\\projects\\my-app)",
              onChange: (e) => setNp({ ...np, path: e.target.value }),
            })),
          h(Field, { label: "Name (optional)" },
            h("input", {
              className: "aidlc-input",
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
              style: { accentColor: "#4ade80", width: 14, height: 14 },
            }),
            "create the folder if it does not exist"),
          h(Button, { onClick: onAdd, disabled: busy }, h(FolderPlus, { size: 13 }), "Add project")
        )
      )
    )
  ),
  // all projects - full width, below the top row
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
                  className: "aidlc-card",
                  style: {
                    border: "1px solid rgba(34,211,238,.16)",
                    borderRadius: 12,
                    background: "rgba(10,14,26,.55)",
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
// setup status - what's actually missing, so "needs setup" is explainable

// Name the specific gaps for a project that isn't set up yet. Drives the
// "needs setup" tooltip so the user sees *what* to fix, not just a bare flag.
function missingSetup(pstate) {
  if (!pstate) return ["project state is still loading"]
  const items = []
  const cli = pstate.cli || {}
  if (!cli.aidlc || !cli.aidlc.installed)
    items.push("aidlc CLI is not installed - use “Install CLI” in the setup wizard")
  if (!pstate.settings) items.push("aidlc.settings.json is missing")
  if (!pstate.stamp) items.push("the .aidlc/ engine hasn’t been generated - run the setup wizard")
  if (pstate.project && !pstate.project.git)
    items.push("the folder is not a git repository (optional - “Make it a git repo” when ready)")
  if (items.length === 0) items.push("no gaps detected - the engine is already on disk, status will refresh")
  return items
}

// A small warning icon that, on hover, pops a bubble listing what's missing.
// Falls back to a native title tooltip too, so the info is never lost.
function SetupTip({ items }) {
  const [show, setShow] = useState(false)
  return h(
    "span",
    {
      style: { position: "relative", display: "inline-flex" },
      onMouseEnter: () => setShow(true),
      onMouseLeave: () => setShow(false),
    },
    h(
      "span",
      {
        style: { display: "inline-flex", color: "#fbbf24", cursor: "help", padding: 2, borderRadius: "50%" },
        title: items.join("  ·  "),
      },
      h(CircleAlert, { size: 15 })
    ),
    show &&
      h(
        "div",
        {
          style: {
            position: "absolute",
            top: "100%",
            right: -6,
            marginTop: 8,
            width: 296,
            background: "#0b0e14",
            border: "1px solid rgba(251,191,36,.45)",
            borderRadius: 10,
            padding: "10px 12px",
            zIndex: 60,
            boxShadow: "0 12px 32px rgba(0,0,0,.55)",
          },
        },
        h(
          "div",
          { style: { fontSize: 10.5, fontWeight: 700, color: "#fbbf24", letterSpacing: ".05em", marginBottom: 7 } },
          "NEEDS SETUP"
        ),
        h(
          "ul",
          { style: { margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 5 } },
          items.map((it) =>
            h(
              "li",
              { key: it, style: { fontSize: 11.5, color: "#cbd5e1", lineHeight: 1.45 } },
              it
            )
          )
        )
      )
  )
}

// ---------------------------------------------------------------------------
// file tree (right-hand column) - the project's folder structure, read-only.
// Manual refresh only: it loads when the project opens and on the refresh
// button. Clicking a folder toggles it; clicking a file opens it with the OS
// default app (open-in-explorer).

const AIDLC_NAMES = new Set([".aidlc", "aidlc", "aidlc.settings.json", "AGENTS.md"])

function fmtSize(n) {
  if (n == null) return ""
  if (n < 1024) return n + " B"
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB"
  return (n / 1024 / 1024).toFixed(1) + " MB"
}

// One recursive level of tree rows.
function TreeRows({ node, depth, open, onToggle, onOpenPath }) {
  if (!node.children || !node.children.length) return null
  return h(
    "div",
    null,
    node.children.map((c) => {
      const isDir = c.type === "dir"
      const expanded = !!open[c.path]
      const hot = AIDLC_NAMES.has(c.name)
      return h(
        "div",
        { key: c.path },
        h(
          "div",
          {
            onClick: () => (isDir ? onToggle(c.path) : onOpenPath(c.path)),
            title: isDir ? c.path : "open " + c.path,
            style: {
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 6px",
              paddingLeft: 6 + depth * 12,
              cursor: "pointer",
              borderRadius: 5,
              fontSize: 11.5,
              fontFamily: MONO,
              color: hot ? "#34d399" : "#cbd5e1",
              userSelect: "none",
            },
          },
          isDir
            ? h(ChevronRight, {
                size: 11,
                style: {
                  transform: expanded ? "rotate(90deg)" : "none",
                  transition: "transform .12s",
                  color: "#64748b",
                  flexShrink: 0,
                },
              })
            : h("span", { style: { width: 11, flexShrink: 0 } }),
          isDir
            ? h(Folder, { size: 12, style: { color: hot ? "#34d399" : "#67e8f9", flexShrink: 0 } })
            : h(File, { size: 12, style: { color: "#64748b", flexShrink: 0 } }),
          h(
            "span",
            { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
            c.name
          ),
          !isDir && c.size != null
            ? h(
                "span",
                { style: { marginLeft: "auto", fontSize: 10, color: "#475569", flexShrink: 0 } },
                fmtSize(c.size)
              )
            : null
        ),
        isDir && expanded ? h(TreeRows, { node: c, depth: depth + 1, open, onToggle, onOpenPath }) : null
      )
    })
  )
}

function FileTree({ pid, onOpenPath }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState("")
  const [open, setOpen] = useState({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const r = await getProjectFiles(pid)
      setData(r)
      // auto-expand the top level so the tree is useful on arrival
      const o = {}
      for (const c of ((r && r.tree && r.tree.children) || [])) {
        if (c.type === "dir") o[c.path] = true
      }
      setOpen(o)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pid])

  useEffect(() => {
    load()
  }, [load])

  const toggle = (path) => setOpen((o) => ({ ...o, [path]: !o[path] }))

  return h(
    Card,
    {
      title: "Files",
      icon: h(Folder, { size: 14, style: { color: "#67e8f9" } }),
      actions: h(
        "div",
        { style: { display: "flex", gap: 4 } },
        h(
          Button,
          {
            kind: "ghost",
            small: true,
            title: "Open the project folder in Explorer (Windows) / file manager (Linux)",
            onClick: () => onOpenPath(null),
          },
          h(FolderOpen, { size: 12 }),
          "Open"
        ),
        h(
          Button,
          { kind: "ghost", small: true, title: "Refresh the file tree", onClick: load, disabled: loading },
          loading
            ? h(LoaderCircle, { size: 12, style: { animation: "aidlc-spin 1.2s linear infinite" } })
            : h(RefreshCw, { size: 12 })
        )
      ),
    },
    err
      ? h("div", { style: { fontSize: 11.5, color: "#f87171" } }, err)
      : !data
        ? h("div", { style: { fontSize: 11.5, color: "#64748b" } }, loading ? "loading files…" : "no data yet")
        : h(
            "div",
            {
              style: {
                maxHeight: 420,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
              },
            },
            h(TreeRows, { node: data.tree, depth: 0, open, onToggle: toggle, onOpenPath }),
            data.truncated &&
              h(
                "div",
                { style: { fontSize: 10.5, color: "#64748b", padding: "4px 6px" } },
                "showing the first " + data.count + " entries (truncated)"
              )
          )
  )
}

// ---------------------------------------------------------------------------
// STATUS dashboard - a compact red/amber/green "is this project ready?" panel:
// GitHub connection, Issue-Radar connection, and per-harness setup. The GitHub
// dot folds in the host `gh` auth state (/api/gh-status); the Issue-Radar dot
// checks the repo against issue-radar's connected list (/repos); the harness
// dots show which of the known harnesses are deployed, with a Deploy action for
// the missing ones.
const DOT = { green: "#34d399", amber: "#fbbf24", red: "#f87171" }
// per-tone row tint so each RAG row glows in its own color
const ROW_TINT = {
  "#34d399": { bg: "rgba(52,211,153,.09)", glow: "0 0 14px rgba(52,211,153,.14)" },
  "#fbbf24": { bg: "rgba(251,191,36,.09)", glow: "0 0 14px rgba(251,191,36,.16)" },
  "#f87171": { bg: "rgba(248,113,113,.10)", glow: "0 0 14px rgba(248,113,113,.18)" },
}

// Turn a git origin URL into a browsable one, or "" when it isn't web-shaped:
// https://github.com/o/r(.git) → as-is (minus .git); git@github.com:o/r.git →
// https://github.com/o/r. Local paths and other schemes stay unlinked.
function originWebUrl(url) {
  if (!url) return ""
  if (/^https?:\/\//.test(url)) return url.replace(/\.git$/i, "")
  const m = url.match(/^git@([^:]+):(.+)$/)
  if (m) return "https://" + m[1] + "/" + m[2].replace(/\.git$/i, "")
  return ""
}

function StatusDashboard({ pstate, proj, onRunSetup, busy }) {
  const [ghStatus, setGhStatus] = useState(null)
  const [repos, setRepos] = useState(null)

  useEffect(() => {
    let stop = false
    const tick = () => {
      getGhStatus().then((r) => !stop && setGhStatus(r)).catch(() => {})
      // poll so the Issue-Radar dot turns green once the repo gets connected
      radarRepos().then((r) => !stop && setRepos(r.repos || [])).catch(() => !stop && setRepos([]))
    }
    tick()
    const t = setInterval(tick, 10000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  const gh = (pstate && pstate.github) || {}
  const owner = gh.owner
  const repo = gh.repo

  // GitHub DEPENDENCY: the host's GitHub connectivity - the KiroCrew host
  // connector (Settings → Connections) first, the host `gh` CLI auth as the
  // fallback. Purely host-level: it says nothing about this folder's git state
  // (that's the "GitHub remote" row in the Project Setup section below).
  const conn = ghStatus && ghStatus.connector
  let depDot, depSub
  if (!ghStatus) {
    depDot = DOT.amber
    depSub = "checking…"
  } else if (conn && conn.connected) {
    depDot = DOT.green
    depSub =
      "KiroCrew connection" +
      (conn.connected_since ? " · since " + new Date(conn.connected_since).toLocaleDateString() : "")
  } else if (ghStatus.authenticated) {
    depDot = DOT.green
    depSub = "gh CLI authed as @" + (ghStatus.owner || "?")
  } else if (!ghStatus.available) {
    depDot = DOT.red
    depSub = "gh CLI not installed"
  } else {
    depDot = DOT.amber
    depSub = "not connected - connect GitHub in KiroCrew (Settings → Connections) or run `gh auth login`"
  }

  // GitHub REMOTE: this folder's own git state (repo + origin), independent of
  // the host connector. When the origin is a web URL, the repo name is a link
  // that opens the remote in the browser.
  const remoteWeb = originWebUrl(gh.url)
  let remDot, remSub
  if (!gh.is_git) {
    remDot = DOT.red
    remSub = "not a git repo"
  } else if (!gh.has_origin) {
    remDot = DOT.amber
    remSub = "git repo, no origin remote"
  } else {
    remDot = DOT.green
    const name = (owner || "?") + "/" + (repo || "?")
    remSub = remoteWeb
      ? h(
          "span",
          null,
          h(
            "a",
            {
              href: remoteWeb,
              target: "_blank",
              rel: "noreferrer",
              title: "Open " + remoteWeb,
              style: {
                color: "#67e8f9",
                textDecoration: "none",
                borderBottom: "1px solid rgba(103,232,249,.4)",
                cursor: "pointer",
              },
            },
            name
          ),
          " · " +
            (remoteWeb.includes("github.com")
              ? "github.com"
              : (remoteWeb.match(/^https?:\/\/([^/]+)/) || [])[1] || "remote")
        )
      : name
  }

  // Issue-Radar dot: green = repo is in issue-radar's connected list; amber =
  // has an origin (connectable) but not connected; red = no origin to connect.
  const connected = !!(repos && owner && repo && repos.some((r) => r.owner === owner && r.repo === repo))
  let irDot, irSub
  if (!gh.has_origin) {
    irDot = DOT.red
    irSub = "no origin to connect"
  } else if (connected) {
    irDot = DOT.green
    irSub = owner + "/" + repo + " connected"
  } else {
    irDot = DOT.amber
    irSub = (owner || "?") + "/" + (repo || "?") + " not connected"
  }

  // Harnesses: one row per known harness, green = deployed, red = not.
  const H = (pstate && pstate.harnesses) || { all: [], deployed: [], launch: {} }
  const deployed = new Set(H.deployed || [])
  const preset = (proj && proj.preset) || "balanced"
  const scope = (proj && proj.scope) || "express"

  const row = (key, dot, label, sub, extra) => {
    const tint = ROW_TINT[dot] || { bg: "rgba(34,211,238,.05)", glow: "none" }
    return h(
      "div",
      {
        key,
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "7px 9px",
          borderRadius: 8,
          background: tint.bg,
          borderLeft: `2px solid ${dot}`,
          boxShadow: tint.glow,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 7 } },
        h(Dot, { tone: dot, pulse: true, size: 10 }),
        h(
          "span",
          { style: { fontWeight: 600, color: "#e2e8f0", fontSize: 12, flex: 1, minWidth: 0 } },
          label
        ),
        extra
      ),
      sub
        ? h(
            "div",
            {
              style: {
                fontSize: 10.5,
                color: "#64748b",
                fontFamily: MONO,
                paddingLeft: 15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            sub
          )
        : null
    )
  }

  // overall project readiness - moved here from the title bar so the far-right
  // dashboard is the single "is this project ready?" surface
  const setupDone = !!(pstate && pstate.project && pstate.project.setup_done)
  const setupGaps = missingSetup(pstate)
  // section header (same look as the old inline "Harnesses" label)
  const sectionLabel = (key, text) =>
    h(
      "div",
      {
        key,
        style: {
          fontSize: 10,
          fontWeight: 700,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: ".07em",
          marginTop: 2,
        },
      },
      text
    )

  const children = [
    sectionLabel("deplabel", "Dependencies"),
    row("gh", depDot, "GitHub", depSub),
    row("ir", irDot, "Issue Radar", irSub),
    sectionLabel("setuplabel", "Project Setup"),
    row(
      "setup",
      setupDone ? DOT.green : DOT.amber,
      "Setup",
      setupDone ? "engine on disk · ready" : "needs setup - " + setupGaps.length + " gap(s)",
      !setupDone && h(SetupTip, { items: setupGaps })
    ),
    row("ghremote", remDot, "GitHub remote", remSub),
    sectionLabel("hlabel", "Harnesses"),
  ]
  ;(H.all || []).forEach((hh) => {
    const isDep = deployed.has(hh)
    const launch = (H.launch || {})[hh] || {}
    children.push(
      row(
        "hh-" + hh,
        isDep ? DOT.green : DOT.red,
        hh,
        (isDep ? "set up" : "not set up") + (isDep && launch.hint ? " · " + launch.hint : ""),
        !isDep
          ? h(
              Button,
              {
                kind: "ghost",
                small: true,
                onClick: () => onRunSetup && onRunSetup(hh, preset, scope),
                disabled: !!busy,
                title: "Run `aidlc config --harness " + hh + "` to deploy it here",
              },
              "Deploy")
          : null
      )
    )
  })

  return h(
    Card,
    { title: "Dependency Status", icon: h(Activity, { size: 14, style: { color: "#34d399" } }), pulse: true },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, children)
  )
}

// ---------------------------------------------------------------------------
// DEPENDENCY status dashboard - the GLOBAL connector health, shown on the main
// (Project Management) page's right-hand column. Unlike the per-project
// dashboard (whose "Project Setup" section reports one folder's setup/git
// state: "not a git repo", "no origin", …), this is host-level: the GitHub
// connector (the KiroCrew host connection from Settings → Connections, or the
// host `gh` auth when no connection is set up) and the Issue Radar connector
// (the issue-radar companion app). It answers "are my services wired up?" -
// not "is this folder ready?".
function DependencyStatusDashboard() {
  const [gh, setGh] = useState(null)
  const [radar, setRadar] = useState(null)
  const [radarErr, setRadarErr] = useState("")

  useEffect(() => {
    let stop = false
    const tick = () => {
      getGhStatus().then((r) => !stop && setGh(r)).catch(() => !stop && setGh(null))
      radarRepos()
        .then((r) => {
          if (stop) return
          setRadar(r.repos || [])
          setRadarErr("")
        })
        .catch((e) => {
          if (stop) return
          setRadar(null)
          setRadarErr(e.message || String(e))
        })
    }
    tick()
    const t = setInterval(tick, 10000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  // GitHub connector: the KiroCrew host connection (Settings → Connections →
  // GitHub) is the primary signal - when the host shows it green, we show
  // green. The host `gh` CLI auth is the fallback when no host connection is
  // set up (the two are separate auth systems: the connector's token lives in
  // the host vault, not in `gh`'s hosts.yml).
  const conn = gh && gh.connector
  let ghDot, ghSub
  if (!gh) {
    ghDot = DOT.amber
    ghSub = "checking…"
  } else if (conn && conn.connected) {
    ghDot = DOT.green
    ghSub =
      "KiroCrew connection" +
      (conn.connected_since ? " · since " + new Date(conn.connected_since).toLocaleDateString() : "")
  } else if (!gh.available) {
    ghDot = DOT.red
    ghSub = "gh CLI not installed"
  } else if (!gh.authenticated) {
    ghDot = DOT.amber
    ghSub = "not connected - connect GitHub in KiroCrew (Settings → Connections) or run `gh auth login`"
  } else {
    ghDot = DOT.green
    ghSub = "connected as @" + (gh.owner || "?")
  }

  // Issue Radar connector: reachable? how many repos are connected?
  let irDot, irSub
  if (radarErr) {
    irDot = DOT.red
    irSub = "not reachable"
  } else if (radar == null) {
    irDot = DOT.amber
    irSub = "checking…"
  } else {
    irDot = DOT.green
    irSub = "reachable · " + radar.length + " repo" + (radar.length === 1 ? "" : "s") + " connected"
  }

  const row = (key, dot, label, sub) => {
    const tint = ROW_TINT[dot] || { bg: "rgba(34,211,238,.05)", glow: "none" }
    return h(
      "div",
      {
        key,
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "7px 9px",
          borderRadius: 8,
          background: tint.bg,
          borderLeft: "2px solid " + dot,
          boxShadow: tint.glow,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 7 } },
        h(Dot, { tone: dot, pulse: true, size: 10 }),
        h("span", { style: { fontWeight: 600, color: "#e2e8f0", fontSize: 12, flex: 1, minWidth: 0 } }, label)
      ),
      sub
        ? h(
            "div",
            {
              style: {
                fontSize: 10.5,
                color: "#64748b",
                fontFamily: MONO,
                paddingLeft: 15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            sub
          )
        : null
    )
  }

  return h(
    Card,
    { title: "Dependency Status", icon: h(Settings2, { size: 14, style: { color: "#67e8f9" } }), pulse: true },
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 8 } },
      row("gh", ghDot, "GitHub connector", ghSub),
      row("ir", irDot, "Issue Radar", irSub)
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
  const [termErr, setTermErr] = useState("")
  const [explorerErr, setExplorerErr] = useState("")
  // which deployed harness the terminal "Launch" button starts (multi-harness)
  const [launchHarness, setLaunchHarness] = useState("")
  const openTerm = (command) => {
    setTermErr("")
    openTerminal(proj.id, command).catch((e) =>
      setTermErr("terminal: " + (e && e.message ? e.message : String(e)))
    )
  }
  const openPath = (rel) => {
    setExplorerErr("")
    openInExplorer(proj.id, rel).catch((e) =>
      setExplorerErr("explorer: " + (e && e.message ? e.message : String(e)))
    )
  }

  // multi-harness terminal launch: the deployed harnesses that have a CLI command
  // (IDE-based harnesses like cursor/copilot have no terminal command). The
  // picker lets you pick which one "Launch" starts in a native terminal.
  const launchable = ((pstate && pstate.harnesses && pstate.harnesses.deployed) || []).filter(
    (hh) => (pstate.harnesses.launch[hh] || {}).cmd
  )
  const selHarness =
    launchHarness && launchable.includes(launchHarness) ? launchHarness : launchable[0]
  const selCmd = selHarness ? (pstate.harnesses.launch[selHarness] || {}).cmd : null
  return h(
    "div",
    { style: { display: "flex", gap: 12, alignItems: "stretch" } },
    // main content (left column)
    h(
      "div",
      { style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 } },
      // back button (small, its own line) + headline project name + status
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        h(
          Button,
          { kind: "ghost", small: true, onClick: onBack },
          h(ArrowLeft, { size: 12 }),
          "Project Management"
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 10 } },
          h("div", { style: { flex: 1, minWidth: 0 } },
            h(
              "div",
              { style: { fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.1 } },
              proj.name
            ),
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
          // native terminal, OUTSIDE the app (Windows Terminal / PowerShell)
          h(
            "div",
            { style: { display: "flex", gap: 6 } },
            h(
              Button,
              {
                small: true,
                kind: "ghost",
                title: "Open a native terminal in the project folder (outside the app)",
                onClick: () => openTerm(null),
              },
              h(Terminal, { size: 13 }),
              "Terminal"
            ),
            pstate &&
              launchable.length > 0 &&
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 4 } },
                h(
                  "select",
                  {
                    value: selHarness,
                    onChange: (e) => setLaunchHarness(e.target.value),
                    title: "Pick which deployed harness to launch in the terminal",
                    style: {
                      fontFamily: MONO,
                      fontSize: 11,
                      padding: "3px 6px",
                      borderRadius: 6,
                      border: "1px solid rgba(34,211,238,.3)",
                      background: "rgba(5,7,18,.72)",
                      color: "#e2e8f0",
                      outline: "none",
                    },
                  },
                  launchable.map((hh) => h("option", { key: hh, value: hh }, hh))
                ),
                h(
                  Button,
                  {
                    small: true,
                    kind: "ghost",
                    title: "Launch " + selHarness + " in a native terminal\n" + (selCmd || ""),
                    onClick: () => openTerm(selCmd),
                  },
                  h(Rocket, { size: 13 }),
                  "Launch"
                )
              ),
            h(
              Button,
              {
                small: true,
                kind: "ghost",
                title: "Open the project folder in Explorer (Windows) / file manager (Linux)",
                onClick: () => openPath(null),
              },
              h(FolderOpen, { size: 13 }),
              "Open folder"
            ),
            termErr &&
              h("span", { style: { fontSize: 11, color: "#f87171" } }, termErr),
            explorerErr &&
              h("span", { style: { fontSize: 11, color: "#f87171" } }, explorerErr)
        )
      ),
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
    // middle column: the project's folder tree + open-in-explorer
    h(
      "div",
      { style: { flex: "0 0 280px", width: 280, display: "flex", flexDirection: "column", gap: 12 } },
      h(FileTree, { pid: proj.id, onOpenPath: openPath })
    ),
    // right column (thinner): the mini status dashboard
    pstate &&
      h(
        "div",
        { style: { flex: "0 0 220px", width: 220, display: "flex", flexDirection: "column", gap: 12 } },
        h(StatusDashboard, { pstate, proj, onRunSetup, busy })
      )
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
function ModeToggle({ mode, onMode, crewReady }) {
  // the "Crew" option is only selectable once a crew is actually enabled for
  // this project (crewReady). Until then it stays greyed out so the user can't
  // flip into a crew view that has no crew behind it.
  const opt = (m, label, icon, disabled) =>
    h(
      "button",
      {
        onClick: () => !disabled && onMode(m),
        disabled: disabled || undefined,
        title: disabled ? "Enable a crew first (see “Enable a crew on this repo” below)" : undefined,
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          border: mode === m ? "1px solid rgba(52,211,153,.6)" : "1px solid rgba(148,163,184,.3)",
          background: mode === m ? "rgba(34,211,238,.14)" : "transparent",
          color: mode === m ? "#67e8f9" : disabled ? "#475569" : "#94a3b8",
          opacity: disabled ? 0.55 : 1,
          textShadow: mode === m ? "0 0 10px rgba(34,211,238,.6)" : "none",
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
        border: "1px solid rgba(34,211,238,.22)",
      },
    },
    opt("solo", "Solo", h(Users, { size: 12 })),
    opt("crew", "Crew", h(Bot, { size: 12 }), !crewReady)
  )
}

// A compact stat tile for the status dashboard.
function StatTile({ icon, label, value, sub, tone = "#e2e8f0" }) {
  return h(
    "div",
    {
      className: "aidlc-card",
      style: {
        border: "1px solid rgba(34,211,238,.16)",
        borderRadius: 12,
        background: "rgba(10,14,26,.55)",
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
        border: "1px solid rgba(34,211,238,.18)",
        borderRadius: 8,
        background: "rgba(10,14,26,.5)",
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
          border: "1px solid rgba(34,211,238,.18)",
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
            borderBottom: "1px solid rgba(34,211,238,.18)",
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
          className: "aidlc-input",
          style: { ...inputStyle, width: 170, flex: "0 0 auto" },
          value: label,
          placeholder: "label (optional)",
          onChange: (e) => setLabel(e.target.value),
        }
      ),
      h(
        Button,
        { onClick: submit, disabled: busy || !text.trim() },
        busy ? h(LoaderCircle, { size: 13, style: { animation: "aidlc-spin 1.2s linear infinite" } }) : h(MessageSquare, { size: 13 }),
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
  // "Set up a GitHub origin" (shown only while there is no origin remote yet)
  const [ghStatus, setGhStatus] = useState(null)
  const [repoName, setRepoName] = useState(
    (proj.name || "repo").trim().replace(/\s+/g, "-").toLowerCase()
  )
  const [hosting, setHosting] = useState(false)
  const [hostErr, setHostErr] = useState("")
  const [hostDone, setHostDone] = useState(null)

  // the git remote (owner/repo) the crew binds to
  useEffect(() => {
    let stop = false
    getGitRemote(pid).then((r) => !stop && setRemote(r)).catch(() => {})
    return () => {
      stop = true
    }
  }, [pid])

  // host gh auth state (the KiroCrew GitHub connector / `gh auth login`)
  useEffect(() => {
    let stop = false
    getGhStatus().then((r) => !stop && setGhStatus(r)).catch(() => {})
    return () => {
      stop = true
    }
  }, [])

  const owner = remote && remote.owner
  const repo = remote && remote.repo
  const hasCrew = mode === "crew"
  // a crew binds to a GitHub repo, so the origin must exist AND be on github.com
  const onGithub = !!(remote && remote.on_github)
  // show the "Set up a GitHub origin" card while there's no origin, or the
  // origin points at a non-GitHub host (gitlab, self-hosted, …)
  const showGithubSetup = !remote || !onGithub

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
    // a crew binds to a GitHub repo - the origin must exist and be on github.com
    if (!owner || !repo || !remote || !remote.on_github) return
    setEnabling(true)
    setRadarErr("")
    try {
      // issue-radar gates crew creation on the repo being connected first
      await radarConnect("https://github.com/" + owner + "/" + repo)
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

  const hostRepo = async () => {
    setHosting(true)
    setHostErr("")
    try {
      const r = await hostOnGithub(pid, { repo: repoName, private: true, push: true })
      setHostDone(r)
      // origin is now set - re-read it so owner/repo populate and "Enable crew" unblocks
      const fresh = await getGitRemote(pid)
      setRemote(fresh)
    } catch (e) {
      setHostErr(e.message || String(e))
    } finally {
      setHosting(false)
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
      h(ModeToggle, { mode, onMode: (m) => onSetMode(m, null), crewReady: hasCrew }),
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
          background: "rgba(5,7,18,.5)",
          border: "1px solid rgba(34,211,238,.25)",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 0 14px rgba(34,211,238,.12)",
        },
      },
      h(GitBranch, { size: 13, style: { color: "#67e8f9" } }),
      owner && repo
        ? h(
            "span",
            null,
            owner + "/" + repo,
            h(
              "span",
              { style: { color: "#475569" } },
              "  ·  origin" + (remote && remote.host ? "  ·  " + remote.host : "")
            ),
            !onGithub && h("span", { style: { color: "#fbbf24" } }, "  ·  not on github.com")
          )
        : h("span", { style: { color: "#fbbf24" } }, "no git origin - set one below to bind a crew")
    ),
    // set up a GitHub origin (shown while there's no origin, or the origin
    // isn't on github.com - a crew can only bind to a GitHub repo)
    showGithubSetup &&
      h(
        Card,
        {
          title: "Set up a GitHub origin",
          icon: h(GitBranch, { size: 14, style: { color: "#67e8f9" } }),
          tone: "#67e8f9",
        },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 8 } },
          ghStatus && !ghStatus.available
            ? h(
                "div",
                { style: { fontSize: 12, color: "#fbbf24" } },
                "the gh CLI is not installed - install it and run `gh auth login`, then retry")
            : ghStatus && !ghStatus.authenticated
              ? h(
                  "div",
                  { style: { fontSize: 12, color: "#fbbf24" } },
                  (ghStatus.connector && ghStatus.connector.connected
                    ? "the KiroCrew GitHub connection is active, but the host `gh` CLI is not authenticated (the connection does not cover it) - run `gh auth login` on this host, then refresh"
                    : "gh is not authenticated - run `gh auth login` on this host, then refresh"))
              : null,
          ghStatus &&
            ghStatus.authenticated &&
            h(
              "div",
              { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" } },
              h(Field, { label: "Repo (name or owner/name)" },
                h("input", {
                  className: "aidlc-input",
                  style: { ...inputStyle, width: 240, flex: "0 0 auto" },
                  value: repoName,
                  onChange: (e) => setRepoName(e.target.value),
                })
              ),
              h(
                Button,
                {
                  onClick: hostRepo,
                  disabled: hosting,
                  title: "Create the GitHub repo (if missing), set it as the git origin, and push",
                },
                hosting
                  ? h(LoaderCircle, { size: 13, style: { animation: "aidlc-spin 1.2s linear infinite" } })
                  : h(Rocket, { size: 13 }),
                "Create on GitHub + set origin + push")
            ),
          hostDone
            ? h(
                "div",
                { style: { fontSize: 11.5, color: "#34d399" } },
                "origin set to " + hostDone.url + (hostDone.pushed ? " (pushed)" : "") + " - you can now enable a crew")
            : null,
          hostErr ? h("div", { style: { fontSize: 11.5, color: "#f87171" } }, hostErr) : null
        )
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
              className: "aidlc-input",
              style: { ...inputStyle, width: 220, flex: "0 0 auto" },
              value: crewName,
              onChange: (e) => setCrewName(e.target.value),
            })),
          h(
            Button,
            {
              onClick: enableCrew,
              disabled: enabling || !owner || !repo || !onGithub,
              title:
                owner && repo && onGithub
                  ? "Create a named crew on this repo and arm wake-on-new-work"
                  : !owner || !repo
                    ? "greyed out: this folder has no git origin remote - use “Set up a GitHub origin” above to create the repo + set origin, a crew binds to a repo"
                    : "greyed out: the git origin is on " + (remote && remote.host ? remote.host : "a non-GitHub host") + ", not github.com - a crew binds to a GitHub repo. Use “Set up a GitHub origin” above to point the origin at GitHub first",
            },
            enabling
              ? h(LoaderCircle, { size: 13, style: { animation: "aidlc-spin 1.2s linear infinite" } })
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
        className: "aidlc-root px-6 pt-4 pb-8",
        style: { width: "100%" },
      },
      h(NeonStyles),
      h("div", { className: "aidlc-scan-clip", "aria-hidden": true },
        h("div", { className: "aidlc-scanline" })),
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
              background: "rgba(34,211,238,.07)",
              border: "1px solid rgba(34,211,238,.35)",
              boxShadow: "0 0 18px rgba(34,211,238,.15)",
            },
          },
            h(Workflow, { size: 18, style: { color: "#22d3ee" } }),
            h("span", { className: "aidlc-neon-title aidlc-flicker", style: { fontWeight: 700, fontSize: 15, letterSpacing: ".02em", color: "#e2e8f0" } }, "SI AIDLC"),
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
            h(LoaderCircle, { size: 14, style: { animation: "aidlc-spin 1.2s linear infinite" } }),
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
