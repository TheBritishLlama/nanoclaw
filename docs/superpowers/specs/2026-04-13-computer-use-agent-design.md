# Computer Use Agent — Local Vision-Based Desktop Automation

## Overview

Windows-native, local-first, pure-vision general computer-use agent exposed as an MCP server. Takes a plain-English goal ("open Notepad and type hello"), watches the screen, figures out where to click/type, and does it — all running on your own GPU with no cloud dependency.

**Core idea:** a three-stage pipeline that loops until the goal is done:
1. **Grounder** — a vision model that looks at a screenshot and finds exactly where to click
2. **Reasoner** — a language model that plans what to do next (break the goal into steps, pick the next action)
3. **Input Backend** — actually moves the mouse and presses keys on Windows

**User:** Solo developer on Windows with a 16 GB GPU (RTX 5080). Priorities: works locally, no cloud API costs, extensible via MCP.

**Codename:** `computer-use-agent`

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Grounder | UI-TARS-1.5-7B AWQ via vLLM (WSL2) | Best open-source GUI grounding model; AWQ quantization fits in VRAM alongside the reasoner |
| Reasoner | Qwen3-8B Q5_K_M via Ollama (Windows) | Strong tool-calling (96.5% on FC benchmarks), toggleable thinking mode, fits 16 GB VRAM budget |
| Input Backend | Windows SendInput API (default) + Interception driver (opt-in) | SendInput covers 95% of apps; Interception for anti-cheat/DirectInput games |
| MCP Framework | FastMCP (Python) | Idiomatic MCP server with `@mcp.tool()` decorators, stdio transport, Pydantic validation |
| Screen Capture | MSS (Python, via ctypes to Windows GDI) | Fast, no extra dependencies, works on Windows |

### Why These Models

**Grounder — UI-TARS-1.5-7B AWQ:**
- Purpose-built for GUI interaction by ByteDance. Two modes: single-step grounding (just coordinates) and multi-step GUI agent (Thought/Action loop)
- Action space covers everything needed: `click`, `left_double`, `right_single`, `drag`, `hotkey`, `type`, `scroll`, `wait`, `finished`, `call_user`
- Coordinate format: `<|box_start|>(x,y)<|box_end|>` — structured, parseable
- AWQ 4-bit quantization: ~5.0 GB weights + ~0.3 GB KV cache + ~0.8 GB vLLM runtime = ~6.1 GB VRAM
- Served via vLLM's OpenAI-compatible API with `frequency_penalty=1, max_tokens=128` for grounding mode
- UI-TARS-2 exists (Sept 2025, +13 pts on OSWorld vs Agent-S2) but deployment maturity lags 1.5 — documented as first swap target

**Reasoner — Qwen3-8B (TIGHT tier default):**
- Qwen3 family has "expertise in agent capabilities, enabling precise integration with external tools in both thinking and unthinking modes" (official description)
- Tool calling: `chat(model='qwen3', messages=messages, tools=[...], think=True)` — native Ollama support
- Thinking mode toggleable: `enable_thinking: True/False` — use thinking for complex planning, disable for fast action dispatch
- Qwen beat DeepSeek 96.5% vs 81.5% on the same function-calling test suite
- 8B Q5_K_M: ~5.5 GB weights + ~1.0 GB KV cache + ~0.3 GB Ollama runtime = ~6.8 GB VRAM
- Served via Ollama on Windows with OpenAI-compatible API at `http://localhost:11434/v1/`
- Parallel tool calling supported

**Why not DeepSeek?** Exhaustive evaluation of all local-viable DeepSeek variants:
- DeepSeek-V3.x/V4-Lite: 200B–671B params, cloud-only, won't fit 16 GB
- DeepSeek-R1-Distill-Qwen-14B: always-on chain-of-thought reasoning tokens break tight agent loop latency
- DeepSeek-Coder-V2-Lite: instruction-following gap flagged by Artificial Analysis (score 8, low tier)
- DeepSeek LLM 7B: Nov 2023 release, pre-tool-calling era, no agent tuning
- No local DeepSeek variant (7B–14B range) has documented tool-calling support comparable to Qwen3

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    MCP SERVER (FastMCP)                       │
│                                                              │
│  ┌────────────┐    ┌────────────┐    ┌───────────────────┐  │
│  │  run_task   │    │ run_action │    │  get_status       │  │
│  │  (tier 2)   │    │  (tier 1)  │    │  (tier 1)         │  │
│  └──────┬──────┘    └──────┬─────┘    └───────────────────┘  │
│         │                  │                                  │
│         ▼                  ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                     SESSION                              │ │
│  │  (singleton, lives in FastMCP lifespan context)          │ │
│  │                                                          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │ │
│  │  │ Grounder │  │ Reasoner │  │   Input Backend       │ │ │
│  │  │ (vLLM)   │  │ (Ollama) │  │ (SendInput/Intercept) │ │ │
│  │  └──────────┘  └──────────┘  └───────────────────────┘ │ │
│  │                                                          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │ │
│  │  │ Capturer │  │ Verifier │  │   Event Log           │ │ │
│  │  │ (MSS)    │  │(Grounder)│  │ (JSONL + frames)      │ │ │
│  │  └──────────┘  └──────────┘  └───────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  asyncio.Lock ─── prevents tier-1 calls during run_task      │
└──────────────────────────────────────────────────────────────┘
         │                              │
         ▼ (WSL2, port-forwarded)       ▼ (Windows native)
   ┌───────────┐                 ┌──────────────┐
   │   vLLM    │                 │    Ollama     │
   │ UI-TARS   │                 │    Qwen3     │
   └───────────┘                 └──────────────┘
```

### The Action Loop

When `run_task` is called with a goal like "open Notepad and type hello world":

```
1. CAPTURE    → take a screenshot of the current screen
2. REASON     → send screenshot + goal + history to the Reasoner
                Reasoner returns: { subgoal: "click the Start menu", done: false }
3. GROUND     → send screenshot + subgoal to the Grounder
                Grounder returns: ActionRegion { bbox: (x,y), action: "click", confidence: 0.92 }
4. EXECUTE    → InputBackend performs the click at (x, y)
5. VERIFY     → capture new screenshot, ask Grounder "is the Start menu now open?"
                If yes → loop back to step 1 with updated history
                If no  → retry (up to 3x), then escalate to Reasoner for replanning
6. REPEAT     → until Reasoner says { done: true } or max_steps exceeded
```

Each loop iteration takes ~2–5 seconds on an RTX 5080 (grounder inference ~0.5s, reasoner ~1–3s, capture + input <0.1s).

### Component Details

**Grounder** uses UI-TARS-1.5 in single-step grounding mode. The prompt includes the action space definition, output format (`Thought: ... / Action: ...`), and the subgoal from the Reasoner. Returns structured `ActionRegion`:

```python
class ActionRegion(BaseModel):
    bbox: tuple[int, int]           # (x, y) screen coordinates
    confidence: float               # 0.0–1.0
    status: Literal["ok", "ambiguous", "not_found"]
    action: str                     # click, type, hotkey, scroll, etc.
    action_args: dict               # text for type, key combo for hotkey, etc.
    candidates: list[tuple[int,int]] | None  # if ambiguous, alternative locations
    suggested_reword: str | None    # if not_found, suggest rephrased subgoal
```

When `status` is `"ambiguous"`, the Reasoner can pick from `candidates` or rephrase the subgoal. When `"not_found"`, the `suggested_reword` gives the Reasoner a hint for replanning.

**Reasoner** receives the current screenshot, the overall goal, a history of previous actions and their outcomes, and produces the next subgoal or declares the task done. Uses Qwen3's tool-calling interface:

```python
class Subgoal(BaseModel):
    description: str      # "click the Start menu"
    action_hint: str      # "click" — guides the Grounder
    done: bool            # true when the overall goal is complete
    reasoning: str | None # only populated when thinking mode is on
```

Thinking mode is toggled based on complexity: enabled for initial planning and replanning after failures, disabled for routine action dispatch (saves ~1–2s per step).

**Verifier** reuses the Grounder model (no extra VRAM). After each action, it takes a new screenshot and asks "did the action succeed?" using a grounding query. Known limitation: false positives where the action didn't work but the screen looks similar enough. Mitigated by grounder re-locate (check if the target element changed state) + optional OCR/semantic check for text-entry verification.

**Input Backend** wraps Windows APIs:
- **SendInput** (default): covers standard desktop apps, browsers, Office, etc. Simulates mouse moves, clicks, key presses, and text input at the Win32 level.
- **Interception** (opt-in): kernel-level input injection for apps that ignore SendInput (DirectInput games, anti-cheat). Requires a signed driver — documented as a manual install step.

## MCP Interface

The agent exposes two tiers of tools via MCP over stdio (JSON-RPC):

### Tier 2 — Autonomous (the main tool)

```python
@mcp.tool()
async def run_task(
    goal: str,
    max_steps: int = 50,
    allow_cloud: bool = False,
    ctx: Context = None,
) -> TaskReport:
    """
    Execute a multi-step desktop task autonomously.
    
    The agent captures the screen, plans actions, executes them,
    and verifies results in a loop until the goal is achieved
    or max_steps is reached.
    
    Progress is streamed via ctx.report_progress() and ctx.info().
    """
```

- `goal`: plain English description of what to accomplish
- `max_steps`: safety limit — stops the loop even if the goal isn't done
- `allow_cloud`: if True, can fall back to cloud models when local inference fails (future)
- `ctx`: FastMCP Context object — provides `ctx.report_progress(step, max_steps, "clicking Start menu")` and `ctx.info("Grounder confidence: 0.92")` for real-time stdio notifications

### Tier 1 — Manual (building blocks)

```python
@mcp.tool()
async def run_action(
    action: str,         # "click", "type", "hotkey", "scroll", etc.
    target: str,         # "the search box" or coordinates "(500, 300)"
    args: dict = {},     # action-specific: text, key combo, direction, etc.
) -> ActionResult:
    """Execute a single action. Capture → Ground → Execute → Verify."""

@mcp.tool()
async def get_status() -> SessionStatus:
    """Return current session state: loaded models, VRAM usage, active task, last frame."""

@mcp.tool()
async def capture_screen() -> ScreenCapture:
    """Take a screenshot and return it as base64 PNG + metadata."""
```

**Tier exclusion rule:** Tier 1 tools (`run_action`, `capture_screen`) cannot be called while a `run_task` is active. An `asyncio.Lock` in the Session enforces this — calling a tier-1 tool during an active tier-2 task returns an error immediately. This prevents racing mouse clicks between the autonomous loop and manual calls.

### MCP Types (Pydantic BaseModel)

All types that cross the MCP boundary use Pydantic BaseModel for automatic JSON schema generation and validation:

```python
class TaskReport(BaseModel):
    status: TaskStatus                # see Error Taxonomy below
    goal: str                         # original goal
    steps_taken: int
    steps_limit: int
    duration_ms: int
    last_frame: str | None            # base64 PNG of final screenshot
    last_subgoal: str | None          # last subgoal the Reasoner produced
    attempted_action: str | None      # last action attempted
    retry_count: int                  # total retries across all steps
    event_log_path: str | None        # path to JSONL event log

class SessionStatus(BaseModel):
    grounder_loaded: bool
    reasoner_loaded: bool
    grounder_model: str
    reasoner_model: str
    vram_used_mb: int                 # from ollama ps size_vram
    active_task: str | None
    tier: str                         # "tight", "comfort", or "big"
```

Internal types like `Frame` (wrapping numpy arrays for screen captures) stay as dataclasses — they never cross the MCP boundary.

### Session Lifecycle

The `Session` singleton lives in FastMCP's `lifespan` context:

```python
@lifespan
async def app_lifespan(server):
    session = Session(config=load_config())
    await session.initialize()  # connect to vLLM + Ollama, verify models loaded
    yield {"session": session}
    await session.shutdown()    # clean up connections

# In tools:
@mcp.tool()
async def run_task(goal: str, ..., ctx: Context):
    session = ctx.lifespan_context["session"]
    # ... use session.grounder, session.reasoner, session.input_backend
```

This means model connections are established once at server startup, not per-call. `ctx.set_state()` / `ctx.get_state()` are available for per-session caching (e.g., caching the last screenshot to avoid redundant captures) but are optional — the Session handles persistent state.

## VRAM Budget & Tiers

The 16 GB VRAM budget is tighter than it looks. Windows reserves ~1.0 GB for the WDDM desktop compositor, and vLLM running in WSL2 has its own runtime overhead. The math:

| Component | TIGHT (16 GB) | COMFORT (16 GB) | BIG (24 GB) |
|-----------|:---:|:---:|:---:|
| UI-TARS-1.5-7B AWQ weights | 5.0 GB | 5.0 GB | 5.0 GB |
| UI-TARS KV cache | 0.3 GB | 0.3 GB | 0.3 GB |
| vLLM runtime (WSL2) | 0.8 GB | 0.8 GB | 0.8 GB |
| Reasoner weights | 5.5 GB (Qwen3-8B Q5) | 8.2 GB (Qwen3-14B Q4) | 8.2 GB (Qwen3-14B Q4) |
| Reasoner KV cache | 0.6 GB | 1.0 GB | 1.0 GB |
| Ollama runtime | 0.3 GB | 0.3 GB | 0.3 GB |
| WDDM desktop reservation | 1.0 GB | 1.0 GB | 1.0 GB |
| **Total** | **~13.5 GB** | **~16.6 GB** | **~16.6 GB** |
| GPU offload | Full | Partial (40/48 layers) | Full |
| Reasoner quality | Good | Better | Better |
| Fits? | Yes, ~2.5 GB headroom | Marginal — needs partial offload | Yes, ~7.4 GB headroom |

**TIGHT is the shipped default.** It uses Qwen3-8B instead of 14B, giving ~2.5 GB of headroom on a 16 GB card. The reasoner is slightly less capable but the system reliably fits in memory. Users with headroom can opt into COMFORT (partial GPU offload of the 14B model — slower but smarter) or BIG (for 24 GB cards — full 14B on GPU).

Configuration:

```yaml
# computer-use-agent config
tier: tight          # tight | comfort | big

models:
  grounder:
    name: ui-tars-1.5-7b-awq
    endpoint: http://localhost:8000/v1  # vLLM in WSL2
  reasoner:
    name: qwen3:8b         # tight default; comfort/big use qwen3:14b
    endpoint: http://localhost:11434/v1  # Ollama on Windows
```

VRAM monitoring uses `ollama ps` (returns `size_vram` in bytes per loaded model) to verify the system is within budget at startup. If over-budget, the agent logs a warning with the actual vs. expected VRAM usage.

## Error Taxonomy

Every `TaskReport` carries one of 11 status codes. Each maps to a distinct recovery strategy:

| Status | Meaning | Recovery |
|--------|---------|----------|
| `success` | Goal achieved, verified | None needed |
| `max_steps_exceeded` | Hit the step limit without completing | Caller can retry with higher limit or break goal into smaller pieces |
| `grounding_failed` | Grounder couldn't find the target element after retries | Reasoner replans with different subgoal; if persistent, report to caller |
| `verification_failed` | Action executed but verification says it didn't work | Retry action, then replan |
| `reasoner_malformed` | Reasoner returned unparseable output | Retry with thinking mode on; if persistent, model issue |
| `reasoner_refused` | Reasoner refused the task (safety filter) | Report to caller — task may need rephrasing |
| `reasoner_stuck` | Reasoner produced the same subgoal 3+ times | Force replan with explicit "try a different approach" prompt |
| `input_silent_failure` | SendInput call succeeded but nothing happened on screen | Switch to Interception backend or report app doesn't accept synthetic input |
| `input_invalid_coords` | Grounder produced coordinates outside screen bounds | Clamp to screen edges and retry |
| `backend_unavailable` | vLLM or Ollama not responding | Check service health, report to caller |
| `user_abort` | User cancelled via MCP | Clean shutdown, return partial progress |

Every status includes forensic payload: `last_frame` (screenshot), `last_subgoal`, `attempted_action`, `retry_count`, `duration_ms`. This makes debugging failures straightforward — you can see exactly what the agent was looking at and trying to do when it failed.

## Testing Strategy

Two tiers, serving different purposes:

### Tier A — Replay Tests (CI-friendly, no GPU)

Deterministic tests that replay recorded action trajectories through the Input Backend without calling any models. These verify:
- Action dispatch logic (correct SendInput calls for each action type)
- Event logging (correct JSONL output)
- Error handling (correct status codes for each failure mode)
- MCP interface (correct request/response shapes)

Run in CI on every commit. Fast, reliable, no hardware requirements.

### Tier B — Golden Integration Tests (GPU required, local only)

End-to-end tests that run real tasks against a live Windows desktop. Ten golden tests:

| ID | Test | What It Verifies |
|----|------|-----------------|
| G1 | Open Notepad from Start menu | Basic click navigation |
| G2 | Type a sentence in Notepad | Text input |
| G3 | Save As to a specific path | Multi-step dialog interaction |
| G4 | Open an existing file | File picker navigation |
| G5 | Find and replace text | Keyboard shortcuts + dialog |
| G6 | Click "Settings" when multiple matches exist | Disambiguation handling |
| G7 | Open Calculator, compute 2+2, verify result | Cross-app task |
| G8 | Ctrl+Shift+Esc to open Task Manager | Hotkey combinations |
| G9 | Switch to a background window by name | Window focus management |
| G10 | Abort after step limit (max_steps=3) | Graceful termination |

Run via `pytest tests/integration/golden/` on Kai's machine. NOT in CI (requires GPU + Windows desktop). Each test runs 3 times — passes if 2/3 succeed (accounts for model stochasticity). Settings: temperature 0, sampling seed fixed for reproducibility within a run.

### Forensics

Every `run_task` execution writes to `tests/artifacts/{run_id}/`:
- `events.jsonl` — one JSON line per loop iteration with timestamp, subgoal, action, result, confidence
- `frames/` — periodic screenshot dumps (every N steps + on every failure)

This makes debugging test failures (or production issues) a matter of reading the event log and looking at the screenshots.

## Model Swap Pool

The default models (UI-TARS-1.5-7B AWQ + Qwen3-8B) are the proven, tested choices. But the architecture is model-agnostic — any model that speaks the right API can be swapped in:

### Grounder Swaps

| Model | Status | Notes |
|-------|--------|-------|
| **UI-TARS-2** | First swap target | +13 pts on OSWorld vs Agent-S2. Deployment maturity still lagging — swap when stable vLLM support ships |
| GUI-Actor | Research candidate | Different approach (element-level grounding). May complement UI-TARS for specific UI types |

### Reasoner Swaps

| Model | Status | Notes |
|-------|--------|-------|
| **Qwen3-14B Q4_K_M** | COMFORT/BIG tier default | Stronger than 8B but needs partial offload on 16 GB |
| **Qwen3.5** | Future upgrade | Released early 2026. Improved tool-calling, better GGUF quantization, 256K context. Natural upgrade path when Ollama support is stable |
| DeepSeek-R1-Distill-14B | Latency-tolerant alternate | Good reasoning but always-on CoT adds ~1–2s per call. Use for tasks where quality matters more than speed |
| DeepSeek-Coder-V2-Lite | Speed-first alternate | Fast but has documented instruction-following gap. Use for simple, well-defined tasks |

### Swapping Process

Change the `models.grounder.name` or `models.reasoner.name` in config. The Session reconnects to the new model endpoint on next startup. No code changes needed — the interface is the same (OpenAI-compatible API for both vLLM and Ollama).

## Security

- **Local-first:** no data leaves the machine by default. All inference runs on local GPU.
- `allow_cloud: false` (default) blocks any cloud API fallback. Must be explicitly opted in.
- Input Backend runs with normal user privileges (SendInput). Interception requires admin install but runs at kernel level — documented risk.
- MCP server runs as a local process, listening only on stdio (no network socket). Access is limited to whatever MCP client connects to it.
- Screenshots are processed in-memory and written to disk only for forensic logs. Forensic log directory is configurable and can be disabled.

## Future Extensions (not in MVP)

These are documented directions, not commitments:

- **Approach B — Skill Curation:** pre-recorded workflows for common tasks (e.g., "open Chrome and go to X"). Skips the Reasoner for known paths, faster and more reliable for repetitive tasks.
- **Approach C — Dual-Loop:** fast reactive loop for simple actions + slow deliberative loop for complex planning. Reduces latency for easy steps.
- **Cloud fallback:** when `allow_cloud: true`, fall back to Claude's computer use API or other cloud vision models if local inference fails or is too slow.
- **Multi-monitor support:** extend the Capturer to handle multiple displays.
- **OCR-assisted verification:** use an OCR model alongside the Grounder for more reliable text-entry verification.
- **Qwen3.5 upgrade:** when Ollama support is stable, upgrade the default reasoner. Better tool-calling, longer context, improved quantization.

## Glossary

| Term | Meaning |
|------|---------|
| **Grounder** | Vision model that finds UI elements on screen and returns coordinates |
| **Reasoner** | Language model that plans the next action and tracks progress toward the goal |
| **Input Backend** | System-level interface that actually moves the mouse and presses keys |
| **Tier 1 tools** | Single-action MCP tools (run_action, capture_screen, get_status) |
| **Tier 2 tools** | Autonomous MCP tools (run_task) that loop internally |
| **AWQ** | Activation-aware Weight Quantization — compresses model weights to 4-bit with minimal quality loss |
| **VRAM tier** | Configuration preset that picks model sizes to fit available GPU memory |
| **WDDM** | Windows Display Driver Model — reserves ~1 GB VRAM for the desktop compositor |
| **Golden test** | End-to-end integration test that runs a real task on a real desktop |
| **Replay test** | Deterministic test that replays recorded actions without model inference |
