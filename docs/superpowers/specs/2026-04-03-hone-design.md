# Hone — Design Specification

**Date:** 2026-04-03
**Status:** Approved
**Repository:** Private (closed source, SaaS)
**V1 audience:** Friends only (no licensing system)

---

## 1. Overview

Hone is a local-first AI writing assistant that runs a lightweight language model on the user's hardware to provide real-time autocomplete, grammar/style corrections, and style-matched rewriting across all applications. It consists of a single Rust binary (system tray app with embedded inference) and a thin browser extension connected via Native Messaging. V1 targets Windows only; the architecture is cross-platform for future expansion.

All generative output — autocomplete, corrections, rewrites, synonyms, text generation — passes through a Style Engine that matches the user's personal writing voice using a style fingerprint and few-shot retrieval from their writing samples.

---

## 2. Core Features (Equal Priority)

### 2.1 Autocomplete

Continuous ghost text generation as the user types. The model predicts what comes next based on full document context and streams tokens that render as faded text after the cursor.

- **Trigger:** 300ms debounce after last keystroke (configurable via responsiveness slider)
- **Accept:** Tab key inserts the ghost text
- **Dismiss:** Any other keystroke clears it; Escape dismisses explicitly
- **KV cache reuse:** After accepting a suggestion, the cache is warm — only new tokens need processing, making subsequent suggestions near-instant
- **Cache invalidation:** Edits earlier in the document trigger partial reprocessing from the edit point forward
- **Max tokens:** 80 per suggestion (configurable in config.toml)
- **Temperature:** 0.3 (low for predictable completions)

### 2.2 Realtime Corrections

Grammar, spelling, and style errors detected as the user writes. Displayed as colored underlines in the browser extension and as a list in the sidebar panel.

- **Trigger:** 500ms debounce (configurable)
- **Red underline:** Spelling/grammar error
- **Blue underline:** Style suggestion
- **Interaction:** Hover or click underline for popover with suggestion + accept button
- **Sidebar batch mode:** All corrections listed with checkboxes, pre-selected by default. User unticks exceptions, hits "Apply Selected." Toggle between select-all and deselect-all modes.
- **Green highlights:** When sidebar is open, selected corrections are highlighted green in the text. Toggling a checkbox updates the highlight in real-time. Highlights revert to underlines when sidebar closes.
- **Priority:** Corrections queue behind autocomplete — they run during natural typing pauses.

### 2.3 Style-Matched Rewriting & Generation

All forms of generative writing — rewriting selections, continuing text, and open-ended generation — use the same pipeline and always match the user's personal style.

- **Rewrite:** Select text, press hotkey (Ctrl+Shift+R). Result shown as inline replacement preview (browser) or floating overlay (system-wide).
- **Continue writing:** Place cursor, press hotkey (Ctrl+Shift+G). Model continues from cursor using full context above.
- **Temperature:** 0.7 (higher for creative output)
- **Style injection:** Every generation request includes the style fingerprint + 2-3 retrieved writing samples as few-shot examples.

### 2.4 Synonyms

Context-sensitive word alternatives that match the user's writing style.

- **Default trigger:** Hotkey (Ctrl+Shift+S) with cursor on a word — no highlighting required
- **Alternative trigger:** Highlight a word first, then hotkey
- **Word detection (browser):** Reads word at caret position from the text field
- **Word detection (system-wide):** Sends Ctrl+Shift+Left to select word, copies via clipboard, restores original selection
- **Display:** Dropdown at cursor position with ranked alternatives
- **Selection:** Click or arrow keys + Enter to replace the word

---

## 3. System Architecture

```
+--------------------------------------------------+
|                 Hone (Rust Binary)                |
|                                                   |
|  +---------------+  +--------------------------+  |
|  |  System Tray  |  |   Inference Engine       |  |
|  |  + Hotkeys    |  |   (llama.cpp embedded)   |  |
|  |  + Overlay    |  |                          |  |
|  +-------+-------+  |  +--------------------+  |  |
|          |           |  |  Style Engine      |  |  |
|          |           |  |  - Fingerprint     |  |  |
|          |           |  |  - Vector DB       |  |  |
|          |           |  |  - Few-shot retriev|  |  |
|          |           |  +--------------------+  |  |
|          |           +-----------+--------------+  |
|          |                       |                 |
|  +-------+-----------------------+---------------+ |
|  |           Request Router                      | |
|  |  Routes requests from all sources to the      | |
|  |  inference engine with appropriate prompts    | |
|  +-------+-------------------------------+------+ |
|          |                               |        |
|  +-------+------+            +-----------+-----+  |
|  | Clipboard     |            | Native Msg     |  |
|  | Workflow      |            | Bridge         |  |
|  | (system-wide) |            | (stdin/stdout) |  |
|  +---------------+            +----------+-----+  |
+--------------------------------------------------+
                                           |
                            +--------------+----------+
                            |   Browser Extension      |
                            |   - Ghost text overlay   |
                            |   - Sidebar panel        |
                            |   - Correction underlines|
                            +-------------------------+
```

### 3.1 Components

1. **Inference Engine** — llama.cpp with CUDA/CPU/DirectML backends. Manages model loading/unloading, KV cache, token generation, and request cancellation.

2. **Style Engine** — Embedded qdrant vector DB holding chunked writing samples. MiniLM embedding model (via candle) for vector search. Generates and stores the style fingerprint JSON. On every generation request, retrieves 2-3 most semantically similar chunks and injects them with the fingerprint into the prompt.

3. **Request Router** — Priority channel (tokio::mpsc). High priority: autocomplete. Normal priority: corrections, rewrites, synonyms. Low priority: background tasks (style doc re-indexing). New high-priority requests cancel in-flight lower-priority work.

4. **System Tray + Hotkeys** — Tray icon with model switcher, responsiveness slider, settings. Global hotkeys for clipboard workflow actions.

5. **Clipboard Workflow** — System-wide mode. Copies selection via simulated Ctrl+C, reads clipboard, sends to inference, shows result in native overlay window. Accept pastes back via Ctrl+V.

6. **Native Messaging Bridge** — stdin/stdout JSON protocol connecting to the browser extension. Streams tokens for ghost text, sends correction arrays, receives text field contents.

### 3.2 Concurrency Model

```
Main thread:       Event loop — tray, hotkeys, overlay rendering
Tokio runtime:     Async tasks — Native Messaging I/O, file watching
Inference thread:  Dedicated thread for llama.cpp (blocking/CPU-bound)
                   Communicates via tokio::mpsc channels
```

Single inference thread ensures requests are naturally serialized — no two generations compete for GPU resources.

---

## 4. Style Engine

### 4.1 Style Fingerprint

Generated once on setup (and refreshed when writing samples change). The model analyzes all documents in the `styles/` directory and produces a structured JSON profile:

```json
{
  "avg_sentence_length": 14.2,
  "vocabulary_level": "conversational_technical",
  "tone_markers": ["direct", "concise", "occasional_humor"],
  "patterns": [
    "prefers 'use' over 'utilize'",
    "avoids passive voice",
    "short paragraphs, rarely >3 sentences",
    "uses dashes for asides"
  ],
  "avoid": ["flowery language", "filler phrases like 'in order to'"],
  "sample_phrases": ["Here's the thing:", "That said,", "The short answer:"]
}
```

Stored as `~/.hone/fingerprint.json` (~1KB). Injected as a system-level instruction in every prompt.

### 4.2 Few-Shot Retrieval

Writing samples are chunked (~200-300 words per chunk), embedded with all-MiniLM-L6-v2 (~80MB, CPU-only, <5ms per query via candle), and stored in embedded qdrant.

On each generation request:
1. Embed the surrounding context (what the user is writing about)
2. Retrieve 2-3 most semantically similar chunks from the user's writing
3. Inject as few-shot examples in the prompt

Context-sensitive: tech writing pulls tech-style examples, casual writing pulls casual examples.

### 4.3 Adding Writing Samples

Drop `.txt` or `.md` files into `~/.hone/styles/`. (`.docx` and `.pdf` parsing may be added in a future version.) A file watcher (notify crate) detects new/changed files, re-chunks, re-embeds, and updates the fingerprint automatically. No restart needed.

---

## 5. Model Management

### 5.1 Directory Structure

```
~/.hone/
├── models/           # GGUF/ONNX model files
│   ├── qwen3-8b-q5.gguf
│   └── my-custom-model.gguf
├── styles/           # Writing samples (drop files here)
│   ├── essay1.txt
│   └── blog-post.md
├── fingerprint.json  # Generated style profile
├── vectors/          # Qdrant embedded DB
└── config.toml       # Settings
```

### 5.2 Default Model Tiers

| Tier | Target Hardware | Default Model | Format | Rationale |
|------|----------------|---------------|--------|-----------|
| High-end | 12+ GB VRAM GPU | Qwen3-8B-Q5 | GGUF | Dense, hybrid thinking mode, strong instruction following |
| Mid-range | 8GB VRAM GPU | Qwen3-30B-A3B-Q4 | GGUF | MoE — 30B knowledge, only 3B params active per token |
| Low-end | CPU-only / <6GB | Qwen3-4B-Q4 | GGUF | Smallest dense Qwen3 |
| NPU | Ryzen AI / Snapdragon X / Intel | Qwen3-4B-INT4 | ONNX | DirectML acceleration for NPU chips |
| Custom | User's choice | Any GGUF dropped in models/ | GGUF | Auto-discovered from directory |

### 5.3 Hardware Auto-Detection (First Launch)

1. GPU present? Check VRAM → recommend appropriate tier
2. NPU present? Offer ONNX/DirectML option
3. CPU only? Recommend smallest quantized model

User can always override. Sane defaults mean it works out of the box.

### 5.4 Model Switching

Tray menu and browser extension sidebar both show installed models. Clicking a different model: unload current → load new → UI updates. Takes 2-5 seconds. Brief "Switching model..." notification shown.

### 5.5 Model Downloads (V1)

Users download GGUF files themselves and place them in `~/.hone/models/`. No built-in downloader for v1. Future SaaS versions may add a built-in downloader from HuggingFace or a custom CDN.

---

## 6. Configuration

### 6.1 config.toml

```toml
[model]
active = "qwen3-8b-q5"
backend = "cuda"                # cuda | cpu | directml

[autocomplete]
debounce_ms = 300
max_tokens = 80
temperature = 0.3

[corrections]
debounce_ms = 500
enabled = true

[rewrite]
temperature = 0.7

[hotkeys]
synonym = "Ctrl+Shift+S"
rewrite = "Ctrl+Shift+R"
generate = "Ctrl+Shift+G"
clipboard_analyze = "Ctrl+Shift+H"

[style]
styles_dir = "~/.hone/styles"
```

### 6.2 Settings UI

Accessible from tray menu and browser extension sidebar:

- **Model selector** — dropdown of installed models
- **Responsiveness slider** — Fast / Default / Relaxed, maps to debounce values:

| Position | Autocomplete | Corrections |
|----------|-------------|-------------|
| Fast | 150ms | 300ms |
| Default | 300ms | 500ms |
| Relaxed | 500ms | 800ms |

- **Hotkey configuration**
- **Open models folder / Open styles folder** shortcuts
- **Advanced** — link to edit config.toml directly

Settings UI is a small native window (Rust, not web-based). Sidebar in the extension also surfaces model and responsiveness controls, syncing back to the Rust app.

---

## 7. Browser Extension

### 7.1 Structure

```
extension/
├── manifest.json          # Chrome Manifest V3
├── background.js          # Native Messaging connection, message routing
├── content.js             # Injected into pages — text field hooks
├── sidebar/
│   ├── sidebar.html
│   └── sidebar.js
└── styles.css             # Ghost text, underlines, popover, highlight styles
```

Thin UI layer — no inference, no style logic, no model awareness.

### 7.2 Text Field Hooking

On focus of a text field (textarea, contenteditable, input):
1. Attach mutation observer + input listener
2. On input → start debounce timer
3. On debounce fire → send full text + cursor position via Native Messaging
4. Receive streamed tokens → render ghost text

### 7.3 Ghost Text

Absolutely-positioned overlay element aligned with cursor. Reduced opacity for "preview" appearance. Tab to accept, any key to dismiss, Escape to explicitly dismiss.

### 7.4 Correction Underlines

- Red underline: spelling/grammar
- Blue underline: style suggestion
- Click/hover: popover with suggestion and one-click Accept

### 7.5 Sidebar Panel

Opens via toolbar icon or Ctrl+Shift+P.

- Lists all corrections with checkboxes, pre-selected by default
- Green highlight on checked corrections when sidebar is open
- Real-time highlight updates on checkbox toggle
- "Apply Selected (N)" button
- Select All / Deselect All toggle
- Model switcher and responsiveness slider (syncs to Rust app)

### 7.6 Supported Browsers

- Chrome / Chromium (Edge, Brave, Arc) — Manifest V3
- Firefox — same code, different manifest format

### 7.7 Native Messaging Protocol

JSON over stdin/stdout. Each request has a unique ID for response matching.

```json
// Extension → Rust: autocomplete request
{ "type": "autocomplete", "id": "abc123", "context": "text above cursor", "cursor": 204 }

// Rust → Extension: streamed token
{ "id": "abc123", "type": "token", "text": "jumped" }

// Rust → Extension: stream complete
{ "id": "abc123", "type": "done" }

// Rust → Extension: corrections
{
  "id": "def456",
  "type": "corrections",
  "items": [
    { "start": 5, "length": 5, "suggestion": "there", "reason": "homophone", "severity": "error" },
    { "start": 22, "length": 7, "suggestion": "use", "reason": "simpler word", "severity": "style" }
  ]
}
```

---

## 8. System-Wide Mode

### 8.1 Clipboard Workflow

1. User selects text in any app, presses global hotkey (Ctrl+Shift+H)
2. Hone copies selection via simulated Ctrl+C
3. Reads clipboard, shows floating overlay with action menu:
   - Rewrite
   - Corrections
   - Continue writing
   - Synonyms
4. User picks action → inference runs through style engine
5. Result shown in overlay with Accept (pastes via Ctrl+V), Copy, or Dismiss

### 8.2 Direct Hotkeys

| Hotkey | Action |
|--------|--------|
| Ctrl+Shift+H | Open action menu |
| Ctrl+Shift+R | Rewrite selection directly |
| Ctrl+Shift+G | Continue writing from selection |
| Ctrl+Shift+S | Synonyms for word at cursor |

All configurable in config.toml and Settings UI.

### 8.3 Overlay Window

Small, borderless, always-on-top native window rendered with lightweight Rust rendering (wgpu or softbuffer). Appears near mouse cursor, disappears on dismiss or accept.

---

## 9. Reliability

### 9.1 Native Messaging Auto-Launch

The Native Messaging manifest specifies the Hone binary path. If the extension tries to connect and Hone isn't running, the browser automatically launches it. Crash recovery in-browser is instant on next interaction.

### 9.2 Windows Startup

Hone registers as a startup application (registry run key or Startup folder). Launches on boot.

### 9.3 Watchdog

The app writes a heartbeat to a lock file. A Windows scheduled task checks every 60 seconds — if the lock file is stale and Hone isn't running, it restarts the process. Covers crash recovery outside the browser.

### 9.4 Error Handling

- **Model fails to load:** Tray notification, settings window opens to model selector
- **Native Messaging disconnects:** Extension shows "Hone disconnected" badge, auto-reconnects on restart
- **Inference OOM:** Catch error, suggest smaller model via notification
- **No GPU at runtime:** Fall back to CPU automatically, notify user

---

## 10. Rust Dependencies

| Crate | Purpose | License |
|-------|---------|---------|
| llama-cpp-rs | llama.cpp bindings, inference | MIT |
| qdrant-client (embedded) | Vector DB for style retrieval | Apache 2.0 |
| candle-core + candle-transformers | Embedding model (MiniLM) | MIT/Apache 2.0 |
| tao | Window creation (overlay) | MIT/Apache 2.0 |
| tray-icon | System tray | MIT/Apache 2.0 |
| global-hotkey | System-wide hotkeys | MIT/Apache 2.0 |
| arboard | Clipboard access | MIT/Apache 2.0 |
| serde + toml | Config parsing | MIT/Apache 2.0 |
| notify | File watcher (styles/) | MIT |
| tokio | Async runtime | MIT |

All MIT or Apache 2.0 — safe for closed source distribution.

---

## 11. Code Protection

- **Rust binary:** Compiled native code, stripped symbols, LTO enabled — difficult to reverse engineer
- **Browser extension:** Minified + obfuscated via webpack + javascript-obfuscator. Extension is thin (no IP-critical logic) — all intelligence lives in the compiled binary
- **Prompts:** Compiled into the binary as string constants, not in external config files
- **V1:** No licensing. Ships to friends directly.
- **Future SaaS:** License key activation, install count telemetry, terms of service

---

## 12. Future Considerations (Not In V1)

- Built-in model downloader (HuggingFace / custom CDN)
- License key activation system
- Cloud-hosted inference option (for users without capable hardware)
- macOS and Linux support (architecture is cross-platform, but v1 targets Windows)
- More writing sample formats (.docx, .pdf)
- VS Code extension (separate from browser extension)
