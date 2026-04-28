# Pair — AI Code Editor Companion

## Overview

Editor-agnostic AI coding companion built in Rust. **Ships as a single Windows `.exe`** — download, double-click, sign in with your Claude subscription, done. No API key, no installer, no terminal, no WSL, no Node.js, no dependencies. Developed on WSL2, compiled to native Windows for release. Replaces Cursor with more features and stronger security — least-privilege agent permissions, pre-edit interception, and full audit logging.

**Core features (all surpass Cursor's equivalents):** Non-destructive checkpoints with branching/compare, thread history with resume, message editing with timeline branching, sub-agent swarms/teams with shared task lists, built-in prompt optimization lab (Promptfoo), best-in-class codebase indexing (AST-aware embeddings with plans for graph-aware/multi-modal/intent indexing — see `pair-codebase-indexing.md`), and a simple but robust security layer.

**User:** Solo beginner dev managing multiple projects. Doesn't code — Claude writes everything. Priorities: quality code, security, polished experience.

**Name:** Pair

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| UI | Rust + GPUI (Zed's GPU framework) | Native GPU rendering, best performance |
| Components | gpui-component (Longbridge) | Code editor (tree-sitter + ropey), resizable panels, 60+ components, CLAUDE.md in repo |
| AI Bridge | TypeScript sidecar (~100 lines), compiled to standalone binary via Node.js SEA, embedded in the .exe | Wraps Claude Agent SDK, communicates via JSON stdin/stdout. Zero runtime dependencies. |
| Database | SQLite + sqlite-vec (bundled extension) | Thread history, checkpoints, embeddings — single DB, no external services |
| File State | Git | Checkpoint file state via SDK's `enableFileCheckpointing` + branches for compare/delete |
| Testing | Promptfoo | Eval for task templates, skills, model comparison, red teaming |

### Why GPUI

- gpui-component provides ~70% of Pair's UI out of the box (code editor, resizable panels, virtual lists, tabs)
- 22,500+ GPUI Context7 snippets + 1,340 gpui-component snippets — high AI coding confidence
- Same renderer as Zed — native GPU, proven at scale
- Alternatives eliminated: Dioxus (WebView on desktop), Freya (experimental), Tauri (mixed stack), Iced (too rigid)
- **Trade-off:** GPUI is pre-1.0, API may change between versions. Mitigated by pinning versions and gpui-component's abstraction layer.

### Windows Distribution

Pair ships as a **single `pair.exe`** — no installer, no dependencies, no WSL. Download and run.

| Concern | Solution |
|---------|----------|
| No console window | `#![windows_subsystem = "windows"]` in main.rs |
| Node.js for sidecar | Sidecar compiled to standalone binary via Node.js SEA (Single Executable Application), then embedded into `pair.exe` as a Windows resource. At launch, Pair extracts it to `%LOCALAPPDATA%/Pair/` on first run. |
| Single file distribution | One `.exe` download. No installer needed (but optional NSIS installer can add Start Menu shortcut + uninstall entry for polish). |
| No WSL at runtime | WSL is dev-only. The release `.exe` is pure native Windows — GPUI compiles to Windows natively (same as Zed), sidecar is a self-contained Node SEA binary. |
| Authentication | OAuth sign-in via browser — works with Claude Pro/Max subscription (same as Claude Code). Also supports API key for teams/enterprise. Token stored in `%LOCALAPPDATA%/Pair/`. |
| Auto-update | Future: check GitHub releases on launch, download new `.exe` in-place |
| Dev workflow | Develop on WSL2 (Linux target for fast iteration), Windows release builds via GitHub Actions or local MSVC toolchain |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PAIR (Rust/GPUI)                  │
│                                                     │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ UI Layer│  │  Engine   │  │  Hook Handlers    │  │
│  │ (GPUI)  │◄─┤  (Core)  │◄─┤ (Pre/Post Tool)   │  │
│  └─────────┘  └────┬─────┘  └───────────────────┘  │
│                     │                                │
│              ┌──────┴──────┐                         │
│              │ Sidecar IPC │                         │
│              │ JSON/stdin/  │                         │
│              │ stdout       │                         │
│              └──────┬──────┘                         │
│                     │                                │
├─────────────────────┼───────────────────────────────┤
│                     ▼                                │
│  ┌──────────────────────────┐   ┌────────────────┐  │
│  │  TypeScript Sidecar      │   │   SQLite DB    │  │
│  │  (Claude Agent SDK)      │   │  threads,      │  │
│  │  - Streaming events      │   │  checkpoints,  │  │
│  │  - Hooks (Pre/PostTool)  │   │  embeddings    │  │
│  │  - Checkpointing         │   └────────────────┘  │
│  │  - Sub-agent teams       │                        │
│  │  - Session resume        │   ┌────────────────┐  │
│  └──────────────────────────┘   │   Git (files)  │  │
│                                  └────────────────┘  │
│                                                      │
│  ◄── filesystem events ──►  ZED EDITOR               │
│  ◄── zed filepath:line  ──►                          │
└──────────────────────────────────────────────────────┘
```

**Three layers:**
1. **UI Layer** — GPUI window with resizable panel layout, all panels render here
2. **Engine** — Core logic: sidecar communication, checkpoint management, SQLite ops, Zed integration, codebase indexer
3. **Sidecar** — TypeScript process wrapping Claude Agent SDK, talks to Rust via JSON lines over stdin/stdout

**External integrations:**
- **Zed** — filesystem events (auto-reloads changed files) + `zed filepath:line` CLI to open files
- **SQLite** — thread history, checkpoint metadata, conversation persistence, vector embeddings
- **Git** — file state for checkpoints + branches for compare/delete

## Sidecar Protocol

JSON lines over stdin/stdout. Each message has a `type` field.

### Rust → Sidecar

| Type | Purpose | Key Fields |
|------|---------|------------|
| `start` | Begin new conversation | `prompt`, `projectDir`, `options` (checkpointing, agents) |
| `resume` | Resume existing thread | `sessionId`, `prompt` |
| `hook_response` | Accept/reject a pending edit | `hookId`, `decision` ("allow"/"deny") |
| `rewind` | Revert to checkpoint | `checkpointId` |
| `abort` | Cancel/pause current operation | — |

### Sidecar → Rust

| Type | Purpose | Key Fields |
|------|---------|------------|
| `text_delta` | Streaming response text | `content` |
| `pre_tool_use` | Edit intercepted, awaiting approval | `tool`, `file`, `old_string`, `new_string`, `hookId` |
| `tool_start` | Agent starting a tool | `tool`, `file` |
| `tool_done` | Tool completed | `tool`, `file` |
| `checkpoint` | Auto-checkpoint created | `id`, `messageIndex` |
| `subagent_start` | Sub-agent spawned | `name`, `team` |
| `subagent_stop` | Sub-agent finished | `name`, `result` |
| `context_request` | Agent needs codebase context | `query` |
| `done` | Turn complete | `sessionId` |
| `error` | Something went wrong | `message` |

The sidecar is stateless — all persistence lives in SQLite and git on the Rust side.

## UI Layout

Default layout using gpui-component's resizable panel system:

```
┌──────────────────────────────────────────────────┐
│  Pair — project-name                    [─][□][×]│
├──────────────────────────────────────────────────┤
│                    │                              │
│   CHAT             │   DIFF PREVIEW               │
│                    │   (code editor widget)       │
│   Streaming        │   - red/green highlighting   │
│   markdown with    │   - syntax via tree-sitter   │
│   typing indicator │   - [Accept] [Reject]        │
│                    │   - [Accept All] [Open Zed]  │
│                    │                              │
│                    │   ACTIVITY FEED               │
│   [message input]  │   Real-time tool usage log   │
│                    │                              │
├────────────────────┴────────────────┬─────────────┤
│             │  FILES TOUCHED        │ SUB-AGENTS  │
│             │  Click → open in Zed  │ Dashboard   │
├─────────────┴───────────────────────┴─────────────┤
│  CHECKPOINT TIMELINE                               │
│  ●────●────●────◉────○    [Rewind] [Branch]       │
├────────────────────────────────────────────────────┤
│  THREADS: Current ▼  │  Today (3)  │  Yesterday   │
└────────────────────────────────────────────────────┘
```

**8 panels:** Chat, Diff Preview, Activity Feed, Files Touched, Sub-Agent Dashboard, Checkpoint Timeline, Thread History, Status Bar.

**Panel interactions:**
- Click file in Files Touched → opens in Zed via `zed filepath:line`
- Click checkpoint in Timeline → rewinds via sidecar
- Click thread in History → resumes via sidecar
- Diff Preview updates live as `pre_tool_use` events arrive
- Click [Diff] on any sub-agent file → loads into main Diff Preview

**Layout persistence:** Panel positions/sizes serialize to JSON, restored on launch.

**Reference mockup:** `projects/pair-mockups/pair-layout-v1.html`

## Feature: Follow the AI

PreToolUse hook intercept → code editor diff → accept/reject.

1. `pre_tool_use` event arrives with `file`, `old_string`, `new_string`, `hookId`
2. Pair reads current file, computes diff
3. Diff Preview panel shows red/green changes with tree-sitter syntax highlighting
4. User clicks:
   - **Accept** → `hook_response` with `decision: "allow"` → file written → Zed reloads
   - **Reject** → `hook_response` with `decision: "deny"` → agent adjusts
   - **Accept All** → approves all pending diffs
   - **Open in Zed** → runs `zed filepath:line` to jump to exact change

## Feature: Checkpoints

Two layers working together.

**Layer 1 — SDK-native (automatic):**
Every message creates a checkpoint via `enableFileCheckpointing`. Each gets a UUID. `rewindFiles(checkpointId)` reverts all files. Zero custom code for basics.

**Layer 2 — Git branching (for message editing):**
When user edits a past message:
1. Current state saved as git branch (Branch A)
2. SDK rewinds to checkpoint before that message
3. Edited message sent, generates new responses on Branch B
4. UI shows side-by-side diff of Branch A vs Branch B
5. User picks: [Keep A] [Keep B] [Keep Both]

**Storage:**

| Data | Storage |
|------|---------|
| Checkpoint UUIDs + timestamps | SQLite |
| File state at each checkpoint | SDK-managed (git) |
| Branch state for comparisons | Git branches |
| Thread ↔ checkpoint mapping | SQLite foreign key |

**Better than Cursor:** Non-destructive branching, persistent across sessions, side-by-side comparison, per-sub-agent checkpoints.

## Feature: Thread History & Message Editing

**Schema:**

```sql
threads: id, session_id, title, project_dir, created_at, updated_at, status
messages: id, thread_id, role, content, checkpoint_id, parent_id, branch_label, created_at
checkpoints: id, thread_id, message_id, git_branch, created_at
```

**Resume:** Click thread → sidecar sends `resume` with `sessionId` → conversation continues with all checkpoints intact.

**Message editing flow:**
1. Right-click message → [Edit & Regenerate]
2. Edit modal shows original + editable text
3. On [Regenerate]: save Branch A, rewind, send edited message, generate Branch B
4. Branch comparison view: see both timelines, diff files, pick one or keep both
5. Works across sub-agents — editing a message that triggered a swarm re-runs the entire swarm

## Feature: Sub-Agent System

**Core principle:** Task templates, not roles. Templates constrain by tools + model + prompt, not persona.

### Built-in Task Templates

| Template | Tools | Model | Purpose |
|----------|-------|-------|---------|
| Write Tests | Read, Write, Bash | Sonnet | Generate tests for specified code |
| Security Audit | Read only | Opus | Review code for vulnerabilities |
| Refactor | Read, Write | Sonnet | Restructure without behavior change |
| Documentation | Read, Write | Sonnet | Generate docs, comments, READMEs |
| Reconciliation | Read, Bash | Opus | Post-merge conflict/duplicate check |

Custom templates: name, color, tool list, model, prompt, test suite. Stored as JSON in SQLite.

### Auto-Dispatch

Main agent automatically spawns sub-agents when work is parallelizable.

| Mode | Behavior |
|------|----------|
| **Confirm** (default) | Shows dispatch plan → user approves/edits before agents spawn |
| **Auto** | Shows toast overview as agents spawn, no blocking |
| **Manual** | Only user spawns sub-agents |

Even in Auto mode, a toast always shows which agents are being dispatched.

### Sub-Agent Panel — Four Tabs

**Active tab:**
- Each agent shows: name, color dot, template, progress bar, current task, status
- Click to expand: files touched with [Diff] buttons, activity feed, [Steer] [Pause] [Cancel]
- [⏸ Pause All] in panel header — sends abort signal, worktree state preserved, agents resume from last checkpoint when unpaused (not restarted from scratch)

**Templates tab:**
- List of all templates with color, model, tools
- Click to edit: name, color, tools (checkboxes), model (dropdown), prompt, test suite
- [+ New Template] button

**Lab tab (Promptfoo):**
- Select template → see test cases with pass/fail results
- **Auto mode:** Sonnet analyzes failures and refines prompt automatically. Configurable iteration count (default 5). Stops early on convergence.
- **Manual mode:** Sonnet proposes revision as a diff + reasoning. User reviews, edits, approves before each re-run.
- [Run Tests] [Compare Models] [Red Team]
- Results stored in SQLite for tracking improvement over time

**Skills tab:**
- Same as Lab tab but for main agent skills (workflow prompts, project-specific instructions)
- Same Sonnet auto/manual iteration loop
- Skills shape how Pair itself behaves; templates shape sub-agents

### Steering

Click [Steer] to send a message to a running sub-agent mid-task. Sends a follow-up prompt through the sidecar to that specific agent.

### Teams & Swarms

**Team:** Multiple agents with a shared task list working on related tasks.
- Agents see each other's progress via shared tasks (SDK `TodoWrite` events)
- Dependencies: agents wait for blocked tasks to complete
- Internal reconciliation when team finishes

**Swarm:** Multiple teams working on independent subsystems.
- Each team has its own shared task list
- Top-level swarm task list visible to all teams (cross-team dependencies)
- Per-team reconciliation first, then cross-team reconciliation
- Max concurrent agents configurable (default: 5)

**Shared task lists — two levels:**
- Swarm-level: visible to all teams, for cross-team dependencies
- Team-level: visible to agents within that team
- Main agent and user can both add/reorder tasks
- Agents mark tasks complete in real-time

### Reconciliation Agent

Runs automatically when 2+ sub-agents finish (or manually via button).

- **Read-only + Bash** — reports findings but does NOT write. User approves every merge.
- **Model:** Opus (needs deep reasoning)
- **Detects:** Conflicts (same file modified differently), duplicates (same utility written twice), incompatibilities (type mismatches, broken imports)
- **Reports:** Per-issue with [View Diff] [Keep A] [Keep B] [Merge] options
- **Tests:** Runs test suite on merged result to catch semantic issues
- **Three safeguards stacked:** Git merge (line-level) → Reconciliation agent (semantic) → Test run (runtime)

## Feature: Codebase Understanding

Semantic search via embeddings for context beyond literal string matching.

**Pipeline:**
1. Project opened → indexer scans files (respects .gitignore)
2. Files chunked by AST node via tree-sitter (functions, classes, blocks)
3. Embeddings generated via Claude embedding API
4. Stored in sqlite-vec (vector search in SQLite)
5. Incremental updates: re-index only changed files on save or branch switch

**What gets indexed:** Functions/methods, class/struct definitions, import graphs, comments/docstrings, config files.

**Integration:** Sidecar sends `context_request` → Pair runs local vector search → returns ranked chunks → sidecar injects into Claude's context.

**Future improvement area:** See `projects/pair-codebase-indexing.md` for ideas on graph-aware indexing, multi-modal chunks, intent indexing, cross-project search, hybrid search, and more.

## Feature: Playwright — Visual UI Testing

Pair agents build web apps (React + axum). They can run linters, type-checkers, and test suites, but can't visually verify that their UI renders correctly. Playwright adds headless Chromium inside agent containers so agents can screenshot their own web UIs, click elements, navigate pages, and assert on visible content — no GPU, no sidecar, no vision model.

**Why Playwright (not computer-use-agent):** Computer-use-agent sees a physical Windows screen and controls the mouse via SendInput — it's for desktop automation. Pair agents don't have a physical screen. They build web apps that render in a browser. Playwright runs headless Chromium inside Docker, is the industry standard for browser automation, and knows the DOM directly.

### Architecture

```
┌─────────────────────────────────────────────────┐
│              Pair Agent Container                │
│                                                  │
│  ┌──────────────────┐   ┌────────────────────┐  │
│  │  Claude Agent     │   │  Agent's Web App   │  │
│  │  (Python, SDK)    │   │  (npm run dev)     │  │
│  │                   │   │  localhost:5173     │  │
│  │  calls Playwright │   └────────────────────┘  │
│  │  tool functions   │            ▲               │
│  └────────┬──────────┘            │               │
│           │                       │               │
│           ▼                       │               │
│  ┌──────────────────┐            │               │
│  │  Playwright       │────────────┘               │
│  │  (headless        │  navigates to              │
│  │   Chromium)       │  localhost:5173             │
│  └──────────────────┘                             │
└─────────────────────────────────────────────────┘
```

Everything runs inside one container. The agent's dev server is already on localhost; Playwright opens it in headless Chromium.

### Agent API (5 functions)

```python
async def browser_screenshot(url: str = "http://localhost:5173") -> str:
    """Navigate to URL, return base64 PNG screenshot."""

async def browser_click(selector: str, url: str | None = None) -> str:
    """Click element matching CSS selector. Returns screenshot after click."""

async def browser_type(selector: str, text: str, url: str | None = None) -> str:
    """Type into input matching selector. Returns screenshot after typing."""

async def browser_navigate(url: str) -> str:
    """Navigate and return screenshot."""

async def browser_query(selector: str, url: str | None = None) -> dict:
    """Query DOM: returns {count, texts, visible} for matching elements."""
```

**Design decisions:**
- **Screenshots are the primary output.** The agent is a vision-capable LLM — it looks at a screenshot and judges correctness.
- **Every mutation returns a screenshot.** `browser_click` and `browser_type` auto-return a screenshot, halving tool calls.
- **Single browser instance per agent.** Created lazily on first use, reused across calls, killed on container stop.
- **No assertions — the agent decides.** Hardcoded `expect()` assertions would be fragile. The agent is the decision-maker.
- **Timeouts:** 10s navigation, 5s selector. Generous for localhost dev servers.

### Container Image Changes

```dockerfile
RUN pip install playwright==1.52.0 \
    && playwright install chromium \
    && playwright install-deps chromium
```

**Size impact:** ~400 MB (Chromium ~200 MB + system deps ~200 MB). Current container is ~1.2 GB, so ~33% increase. Acceptable for a local dev tool.

**No GPU.** Headless Chromium uses software rendering. Screenshots of typical UIs take <100ms.

### Example Workflow

```
Agent: I've created the TodoList component. Let me check if it renders.
[calls browser_screenshot("http://localhost:5173")]

Agent: Page loads but list is empty. Let me test the add flow.
[calls browser_type("input[placeholder='Add a todo']", "Buy milk")]
[calls browser_click("button.add-todo")]

Agent: "Buy milk" appeared in the list. Delete button next.
[calls browser_click("button.delete-todo")]
[calls browser_query(".empty-state")]
→ {"count": 1, "texts": ["No todos yet!"], "visible": [true]}

Agent: Empty state renders correctly. Basic CRUD flow verified.
```

### Implementation Notes

- **Lazy init.** Browser launches on first Playwright call, not at container start. Many sessions won't need it.
- **Error handling.** Connection refused → clear message ("is the dev server running?"), not a raw exception.
- **Security.** Browser runs in a network-isolated container. Can only reach localhost services within the same container.

### Future Extensions

- Visual regression testing (baseline screenshots + diffing)
- Accessibility audits via axe-core
- Video recording of multi-step interactions
- Firefox/WebKit for cross-browser testing

## Security

Robust but simple. Three pre-hooks, one post-hook.

**PreToolUse pipeline (runs in order on every tool call):**

| Hook | What it does | Example |
|------|-------------|---------|
| File guard | Denies writes to sensitive files | `.env`, `.pem`, `.key`, `credentials.*` |
| Bash guard | Denies dangerous shell commands | `rm -rf`, `sudo`, `curl \| sh`, `chmod 777` |
| Diff preview | Pauses, shows diff in UI, waits for accept/reject | All Edit/Write calls |

**PostToolUse:**

| Hook | What it does |
|------|-------------|
| Audit logger | Logs tool name, inputs, outputs, agent name, timestamp to SQLite |

**Additional security (zero extra code — SDK-native):**
- **Per-agent tool lockdown** — `allowedTools` per task template. Security Audit gets Read-only. Write Tests gets Read/Write/Bash. Agents can't exceed their template's permissions.
- **Worktree isolation** — each sub-agent in its own git worktree via `isolation: "worktree"`. Can't affect main branch or other agents.
- **Reconciliation gate** — nothing merges without passing through the reconciliation agent + user approval.

**What Cursor doesn't have:** No hook system, no per-agent permissions, no audit logging, no worktree isolation. Cursor auto-applies edits and asks forgiveness. Pair asks permission.

## Build Strategy: Risk-First (Approach C)

1. **Spike** (~1 day) — GPUI window + sidecar bridge + one streaming message. Proves the pipeline works on Windows/WSL. ~~If it fails, pivot to Tauri.~~ **DONE — pipeline verified on WSL2.**
2. **Core loop** — Chat panel + diff preview with accept/reject. The Cursor-parity feature.
3. **Layout** — Resizable panel layout with all panels positioned, wire in real data.
4. **Features** — Checkpoints, thread history, message editing, sub-agents, codebase indexing.
5. **Windows packaging** — Cross-compile to single Windows .exe with embedded sidecar (Node.js SEA). No installer required, no dependencies, no WSL at runtime.
6. **Polish** — Impeccable audit on UI mockup, animations, keyboard shortcuts.

## Project Structure

```
pair/
├── src/
│   ├── main.rs              — GPUI app entry, window setup
│   ├── ui/
│   │   ├── chat.rs          — Conversation view (streaming markdown)
│   │   ├── diff_preview.rs  — Code editor diff with accept/reject
│   │   ├── activity_feed.rs — Real-time tool usage feed
│   │   ├── checkpoint.rs    — Visual timeline
│   │   ├── subagents.rs     — Sub-agent dashboard (4 tabs)
│   │   ├── thread_list.rs   — Thread history
│   │   ├── files_touched.rs — File list with status
│   │   └── layout.rs        — Resizable panel layout
│   ├── engine/
│   │   ├── agent.rs         — Sidecar communication (spawn, JSON parse)
│   │   ├── checkpoint.rs    — Checkpoint/branch management
│   │   ├── db.rs            — SQLite (threads, messages, templates, embeddings)
│   │   ├── indexer.rs       — Codebase embeddings + vector search
│   │   ├── promptfoo.rs     — Promptfoo integration for Lab/Skills tabs
│   │   └── zed.rs           — Zed integration (file open, watch)
│   └── hooks/
│       ├── pre_tool.rs      — Intercept edits for preview
│       └── post_tool.rs     — Log changes, update UI
├── sidecar/
│   ├── index.ts             — Agent SDK bridge (~100 lines)
│   └── package.json
├── Cargo.toml
├── build.rs               — Windows resource embedding (icon, version info, sidecar binary)
├── assets/
│   └── pair.ico           — App icon for Windows taskbar
└── README.md
```

## References

- UI mockup: `/mnt/c/Users/Explo/Documents/Jarvis/projects/pair-mockups/pair-layout-v1.html`
- Codebase indexing improvement ideas: `/mnt/c/Users/Explo/Documents/Jarvis/projects/pair-codebase-indexing.md`
- Architecture decisions + rationale: Claude Code memory `project_cursor_killer.md`
- Obsidian project file: `/mnt/c/Users/Explo/Documents/Jarvis/projects/cursor-killer.md`
