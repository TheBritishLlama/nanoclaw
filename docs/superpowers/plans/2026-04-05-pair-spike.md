# Pair Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the GPUI + TypeScript sidecar pipeline works on Windows/WSL2 — open a window, send a prompt to Claude via Agent SDK, and stream the response into the UI. If GPUI fails to render, pivot to Tauri before investing weeks.

**Architecture:** Rust/GPUI app spawns a TypeScript child process (sidecar) that wraps the Claude Agent SDK. Communication is JSON lines over stdin/stdout. The sidecar is stateless — Rust owns all state and UI.

**Tech Stack:** Rust, GPUI 0.2, gpui-component 0.5, TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), serde, serde_json

**Spec:** `docs/superpowers/specs/2026-04-05-pair-design.md`

**Scope note:** This is Plan 1 of ~4. The full spec covers multiple independent subsystems. Subsequent plans (Core Loop, Layout + Persistence, Sub-Agents + Advanced Features) will be written after this spike proves viability.

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `pair/Cargo.toml` | Project manifest with gpui, gpui-component, serde dependencies |
| **Create:** `pair/src/main.rs` | GPUI app entry point, window setup |
| **Create:** `pair/src/app.rs` | Root view — message list + chat input |
| **Create:** `pair/src/protocol.rs` | Serde types for JSON line protocol |
| **Create:** `pair/src/sidecar.rs` | Spawn TypeScript process, read/write JSON lines |
| **Create:** `pair/sidecar/package.json` | Node dependencies (claude-agent-sdk) |
| **Create:** `pair/sidecar/tsconfig.json` | TypeScript config |
| **Create:** `pair/sidecar/index.ts` | Agent SDK bridge (~60 lines) |

---

### Task 1: Project Scaffold

Set up the Rust project, TypeScript sidecar, and install all dependencies. After this task, `cargo check` and `npm install` both pass.

**Files:**
- Create: `pair/Cargo.toml`
- Create: `pair/src/main.rs` (placeholder)
- Create: `pair/sidecar/package.json`
- Create: `pair/sidecar/tsconfig.json`

- [ ] **Step 1: Install system dependencies for GPUI on WSL2**

GPUI needs GPU/windowing libraries. Run:

```bash
sudo apt-get update && sudo apt-get install -y \
  libxcb-shape0-dev libxcb-xfixes0-dev libxcb-xkb-dev \
  libxkbcommon-dev libxkbcommon-x11-dev \
  libwayland-dev libvulkan-dev \
  libfontconfig-dev libfreetype-dev \
  pkg-config cmake
```

Expected: all packages install successfully.

- [ ] **Step 2: Create Cargo.toml**

```toml
[package]
name = "pair"
version = "0.1.0"
edition = "2024"

[dependencies]
gpui = "0.2"
gpui-component = "0.5"
gpui-component-assets = "0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
```

- [ ] **Step 3: Create placeholder main.rs**

```rust
fn main() {
    println!("Pair spike");
}
```

- [ ] **Step 4: Run cargo check**

Run: `cd pair && cargo check`

Expected: downloads dependencies, compiles successfully. This verifies GPUI and gpui-component resolve and build on this system. May take several minutes on first run.

- [ ] **Step 5: Create sidecar/package.json**

```json
{
  "name": "pair-sidecar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4"
  }
}
```

- [ ] **Step 6: Create sidecar/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 7: Install sidecar dependencies**

Run: `cd pair/sidecar && npm install`

Expected: `@anthropic-ai/claude-agent-sdk`, `typescript`, and `tsx` install successfully.

- [ ] **Step 8: Commit**

```bash
cd pair
git init
git add Cargo.toml Cargo.lock src/main.rs sidecar/package.json sidecar/tsconfig.json sidecar/package-lock.json
git commit -m "chore: project scaffold — Rust + TypeScript sidecar"
```

---

### Task 2: Minimal GPUI Window (Go/No-Go Gate)

Open a GPUI window that renders "Hello, Pair" with a button. This is the critical viability test — if the window doesn't appear on WSL2, stop and pivot to Tauri.

**Files:**
- Modify: `pair/src/main.rs`

- [ ] **Step 1: Write the minimal GPUI app**

Replace `pair/src/main.rs` with:

```rust
use gpui::*;
use gpui_component::*;
use gpui_component::button::Button;

struct HelloPair;

impl Render for HelloPair {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .v_flex()
            .gap_2()
            .size_full()
            .items_center()
            .justify_center()
            .child("Hello, Pair!")
            .child(
                Button::new("test")
                    .primary()
                    .label("Pipeline works!")
                    .on_click(|_, _, _| {
                        println!("Button clicked — GPUI is alive on WSL2!");
                    }),
            )
    }
}

fn main() {
    let app = Application::new().with_assets(gpui_component_assets::Assets);

    app.run(move |cx| {
        gpui_component::init(cx);

        cx.spawn(async move |cx| {
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                        None,
                        size(px(800.), px(600.)),
                        cx.deref(),
                    ))),
                    ..Default::default()
                },
                |_window, cx| {
                    let view = cx.new(|_| HelloPair);
                    cx.new(|cx| Root::new(view, _window, cx))
                },
            )?;
            Ok::<_, anyhow::Error>(())
        })
        .detach();
    });
}
```

- [ ] **Step 2: Build and run**

Run: `cd pair && cargo run`

Expected: A window appears titled "Pair" (or default title), showing "Hello, Pair!" text and a "Pipeline works!" button. Clicking the button prints to the terminal.

**If the window does NOT appear:** Check error output. Common WSL2 issues:
- Missing Wayland/X11: ensure WSLg is enabled (`wsl --update`)
- Missing Vulkan: install `mesa-vulkan-drivers`
- If unfixable: STOP. Pivot to Tauri. Do not proceed with further tasks.

- [ ] **Step 3: Commit**

```bash
git add src/main.rs
git commit -m "spike: minimal GPUI window renders on WSL2"
```

---

### Task 3: Protocol Types (TDD)

Define the JSON line protocol types shared between Rust and TypeScript. Test serialization round-trips.

**Files:**
- Create: `pair/src/protocol.rs`
- Modify: `pair/src/main.rs` (add `mod protocol`)

- [ ] **Step 1: Write the failing test**

Create `pair/src/protocol.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Messages sent from Rust to the sidecar (via stdin).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutboundMessage {
    Start {
        prompt: String,
        project_dir: String,
    },
    Abort,
}

/// Messages received from the sidecar (via stdout).
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InboundMessage {
    TextDelta { content: String },
    Done { session_id: String },
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_start_message() {
        let msg = OutboundMessage::Start {
            prompt: "hello".into(),
            project_dir: "/home/user/project".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"start""#));
        assert!(json.contains(r#""prompt":"hello""#));
        assert!(json.contains(r#""project_dir":"/home/user/project""#));
    }

    #[test]
    fn deserialize_text_delta() {
        let json = r#"{"type":"text_delta","content":"Hello world"}"#;
        let msg: InboundMessage = serde_json::from_str(json).unwrap();
        assert_eq!(
            msg,
            InboundMessage::TextDelta {
                content: "Hello world".into()
            }
        );
    }

    #[test]
    fn deserialize_done() {
        let json = r#"{"type":"done","session_id":"abc-123"}"#;
        let msg: InboundMessage = serde_json::from_str(json).unwrap();
        assert_eq!(
            msg,
            InboundMessage::Done {
                session_id: "abc-123".into()
            }
        );
    }

    #[test]
    fn deserialize_error() {
        let json = r#"{"type":"error","message":"something broke"}"#;
        let msg: InboundMessage = serde_json::from_str(json).unwrap();
        assert_eq!(
            msg,
            InboundMessage::Error {
                message: "something broke".into()
            }
        );
    }

    #[test]
    fn serialize_abort() {
        let msg = OutboundMessage::Abort;
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"abort"}"#);
    }
}
```

- [ ] **Step 2: Add module declaration to main.rs**

Add to the top of `pair/src/main.rs`:

```rust
mod protocol;
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd pair && cargo test`

Expected: all 5 tests pass.

```
test protocol::tests::serialize_start_message ... ok
test protocol::tests::deserialize_text_delta ... ok
test protocol::tests::deserialize_done ... ok
test protocol::tests::deserialize_error ... ok
test protocol::tests::serialize_abort ... ok
```

- [ ] **Step 4: Commit**

```bash
git add src/protocol.rs src/main.rs
git commit -m "feat: protocol types with serde — JSON line message format"
```

---

### Task 4: TypeScript Sidecar Bridge

Create the TypeScript process that reads JSON lines from stdin, calls the Claude Agent SDK, and streams responses back as JSON lines on stdout.

**Files:**
- Create: `pair/sidecar/index.ts`

- [ ] **Step 1: Write the sidecar bridge**

Create `pair/sidecar/index.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline";

// JSON line helper — write one JSON object per line to stdout
function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// Read JSON lines from stdin
const rl = createInterface({ input: process.stdin });

rl.on("line", async (line: string) => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    emit({ type: "error", message: `Invalid JSON: ${line}` });
    return;
  }

  if (parsed.type === "start") {
    await handleStart(parsed as { type: string; prompt: string; project_dir: string });
  } else if (parsed.type === "abort") {
    // For the spike, just exit
    process.exit(0);
  }
});

async function handleStart(msg: { prompt: string; project_dir: string }): Promise<void> {
  try {
    let sessionId = "";

    for await (const message of query({
      prompt: msg.prompt,
      options: {
        cwd: msg.project_dir,
        allowedTools: ["Read", "Glob", "Grep"],
        maxTurns: 3,
      },
    })) {
      // Capture session ID from init message
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }

      // Forward result text
      if ("result" in message && typeof message.result === "string") {
        emit({ type: "text_delta", content: message.result });
      }
    }

    emit({ type: "done", session_id: sessionId });
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 2: Test the sidecar manually**

Run: `cd pair/sidecar && echo '{"type":"start","prompt":"Say hello in one sentence","project_dir":"/tmp"}' | npx tsx index.ts`

Expected: one or more `{"type":"text_delta","content":"..."}` lines followed by `{"type":"done","session_id":"..."}`. This verifies the Agent SDK is reachable and the sidecar protocol works.

If it errors with an auth issue, ensure `ANTHROPIC_API_KEY` is set in the environment.

- [ ] **Step 3: Commit**

```bash
git add sidecar/index.ts
git commit -m "feat: TypeScript sidecar — Agent SDK bridge via JSON lines"
```

---

### Task 5: Rust Sidecar IPC

Spawn the TypeScript sidecar as a child process from Rust. Send JSON lines to its stdin, read JSON lines from its stdout, and deliver parsed `InboundMessage`s to the caller via a channel.

**Files:**
- Create: `pair/src/sidecar.rs`
- Modify: `pair/src/main.rs` (add `mod sidecar`)

- [ ] **Step 1: Write the failing test**

Create `pair/src/sidecar.rs`:

```rust
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

use crate::protocol::{InboundMessage, OutboundMessage};

pub struct Sidecar {
    child: Child,
    pub receiver: mpsc::Receiver<InboundMessage>,
}

impl Sidecar {
    /// Spawn the TypeScript sidecar process.
    pub fn spawn(sidecar_dir: &str) -> anyhow::Result<Self> {
        let mut child = Command::new("npx")
            .args(["tsx", "index.ts"])
            .current_dir(sidecar_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdout = child.stdout.take().expect("stdout must be piped");
        let (tx, rx) = mpsc::channel();

        // Background thread reads stdout line by line
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<InboundMessage>(&line) {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            break; // receiver dropped
                        }
                    }
                    Err(e) => {
                        eprintln!("sidecar: failed to parse line: {e}\n  line: {line}");
                    }
                }
            }
        });

        Ok(Sidecar {
            child,
            receiver: rx,
        })
    }

    /// Send a message to the sidecar via stdin.
    pub fn send(&mut self, msg: &OutboundMessage) -> anyhow::Result<()> {
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("stdin closed"))?;
        let json = serde_json::to_string(msg)?;
        writeln!(stdin, "{json}")?;
        stdin.flush()?;
        Ok(())
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    #[test]
    fn parse_json_lines_from_stdout() {
        // Use a simple echo script instead of the real sidecar
        let mut child = Command::new("bash")
            .args([
                "-c",
                r#"echo '{"type":"text_delta","content":"hi"}'; echo '{"type":"done","session_id":"s1"}';"#,
            ])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        let messages: Vec<InboundMessage> = reader
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(&l).ok())
            .collect();

        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0],
            InboundMessage::TextDelta {
                content: "hi".into()
            }
        );
        assert_eq!(
            messages[1],
            InboundMessage::Done {
                session_id: "s1".into()
            }
        );
    }
}
```

- [ ] **Step 2: Add module declaration to main.rs**

Add to `pair/src/main.rs` (below `mod protocol;`):

```rust
mod sidecar;
```

- [ ] **Step 3: Run the test**

Run: `cd pair && cargo test sidecar`

Expected: `test sidecar::tests::parse_json_lines_from_stdout ... ok`

- [ ] **Step 4: Commit**

```bash
git add src/sidecar.rs src/main.rs
git commit -m "feat: sidecar IPC — spawn child process, read/write JSON lines"
```

---

### Task 6: Root View with Streaming Text Display

Replace the "Hello, Pair" view with a real chat view that displays streaming text from the sidecar. Messages accumulate in a scrollable list. The currently streaming response appears at the bottom.

**Files:**
- Create: `pair/src/app.rs`
- Modify: `pair/src/main.rs`

- [ ] **Step 1: Create the app view**

Create `pair/src/app.rs`:

```rust
use gpui::*;
use gpui_component::*;
use gpui_component::scrollable::Scrollbar;

pub struct PairApp {
    /// Completed messages: (role, content) pairs.
    messages: Vec<(String, String)>,
    /// Text currently being streamed from the sidecar.
    streaming_text: String,
    /// Whether the sidecar is currently generating a response.
    is_streaming: bool,
    /// Scroll handle for the message list.
    scroll_handle: ScrollHandle,
}

impl PairApp {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            messages: Vec::new(),
            streaming_text: String::new(),
            is_streaming: false,
            scroll_handle: ScrollHandle::new(),
        }
    }

    /// Call this when a TextDelta arrives from the sidecar.
    pub fn append_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.streaming_text.push_str(text);
        self.is_streaming = true;
        cx.notify();
    }

    /// Call this when a Done message arrives.
    pub fn finish_response(&mut self, cx: &mut Context<Self>) {
        if !self.streaming_text.is_empty() {
            self.messages
                .push(("assistant".into(), std::mem::take(&mut self.streaming_text)));
        }
        self.is_streaming = false;
        cx.notify();
    }

    /// Add a user message to the list.
    pub fn add_user_message(&mut self, content: String, cx: &mut Context<Self>) {
        self.messages.push(("user".into(), content));
        self.streaming_text.clear();
        self.is_streaming = true;
        cx.notify();
    }
}

impl Render for PairApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let messages = self.messages.clone();
        let streaming = self.streaming_text.clone();
        let is_streaming = self.is_streaming;

        div()
            .v_flex()
            .size_full()
            .bg(cx.theme().background)
            .child(
                // Header
                div()
                    .h_flex()
                    .p_3()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::BOLD)
                            .child("Pair"),
                    ),
            )
            .child(
                // Message list — scrollable, takes remaining space
                div()
                    .flex_1()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll_handle)
                    .p_4()
                    .v_flex()
                    .gap_3()
                    .children(messages.iter().enumerate().map(|(i, (role, content))| {
                        let is_user = role == "user";
                        div()
                            .id(ElementId::Name(format!("msg-{i}").into()))
                            .p_3()
                            .rounded_lg()
                            .when(is_user, |el| {
                                el.bg(cx.theme().accent)
                                    .text_color(cx.theme().accent_foreground)
                            })
                            .when(!is_user, |el| {
                                el.bg(cx.theme().muted).text_color(cx.theme().foreground)
                            })
                            .child(content.clone())
                    }))
                    .when(!streaming.is_empty(), |el| {
                        el.child(
                            div()
                                .id("streaming")
                                .p_3()
                                .rounded_lg()
                                .bg(cx.theme().muted)
                                .text_color(cx.theme().foreground)
                                .child(streaming),
                        )
                    })
                    .when(is_streaming && streaming.is_empty(), |el| {
                        el.child(
                            div()
                                .id("thinking")
                                .p_3()
                                .text_color(cx.theme().muted_foreground)
                                .child("Thinking..."),
                        )
                    }),
            )
    }
}
```

- [ ] **Step 2: Update main.rs to use the app view**

Replace `pair/src/main.rs` entirely:

```rust
mod app;
mod protocol;
mod sidecar;

use gpui::*;
use gpui_component::*;

use crate::app::PairApp;

fn main() {
    let app = Application::new().with_assets(gpui_component_assets::Assets);

    app.run(move |cx| {
        gpui_component::init(cx);

        cx.spawn(async move |cx| {
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                        None,
                        size(px(900.), px(700.)),
                        cx.deref(),
                    ))),
                    ..Default::default()
                },
                |window, cx| {
                    let view = cx.new(|cx| PairApp::new(window, cx));
                    cx.new(|cx| Root::new(view.clone(), window, cx))
                },
            )?;
            Ok::<_, anyhow::Error>(())
        })
        .detach();
    });
}
```

- [ ] **Step 3: Build and run to verify the view renders**

Run: `cd pair && cargo run`

Expected: window opens with "Pair" header and an empty message area. No input yet — that's the next task.

- [ ] **Step 4: Commit**

```bash
git add src/app.rs src/main.rs
git commit -m "feat: root view — scrollable message list with streaming text"
```

---

### Task 7: Chat Input + Send Button

Add a text input and send button at the bottom of the view. On send, spawn the sidecar, send the prompt, and wire streaming responses to the view.

**Files:**
- Modify: `pair/src/app.rs`
- Modify: `pair/src/main.rs`

- [ ] **Step 1: Add input state and send logic to PairApp**

Add these fields to the `PairApp` struct in `pair/src/app.rs`:

```rust
use gpui_component::input::{Input, InputState};
use gpui_component::button::Button;
use crate::protocol::{InboundMessage, OutboundMessage};
use crate::sidecar::Sidecar;
use std::sync::mpsc;
use std::path::PathBuf;
```

Add new fields to the `PairApp` struct:

```rust
pub struct PairApp {
    messages: Vec<(String, String)>,
    streaming_text: String,
    is_streaming: bool,
    scroll_handle: ScrollHandle,
    // New fields:
    input_state: Entity<InputState>,
    sidecar_rx: Option<mpsc::Receiver<InboundMessage>>,
    project_dir: PathBuf,
}
```

Update `PairApp::new`:

```rust
pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
    let input_state = cx.new(|cx| {
        InputState::new(window, cx).placeholder("Ask Pair anything...")
    });

    Self {
        messages: Vec::new(),
        streaming_text: String::new(),
        is_streaming: false,
        scroll_handle: ScrollHandle::new(),
        input_state,
        sidecar_rx: None,
        project_dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    }
}
```

Add the send method:

```rust
fn send_message(&mut self, _: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
    let content = self.input_state.read(cx).value().to_string();
    if content.trim().is_empty() {
        return;
    }

    // Clear input
    self.input_state.update(cx, |state, cx| {
        state.set_value("", window, cx);
    });

    // Add user message
    self.add_user_message(content.clone(), cx);

    // Spawn sidecar
    let sidecar_dir = self
        .project_dir
        .join("sidecar")
        .to_string_lossy()
        .to_string();

    let mut sidecar = match Sidecar::spawn(&sidecar_dir) {
        Ok(s) => s,
        Err(e) => {
            self.messages
                .push(("error".into(), format!("Failed to start sidecar: {e}")));
            self.is_streaming = false;
            cx.notify();
            return;
        }
    };

    let project_dir = self.project_dir.to_string_lossy().to_string();
    if let Err(e) = sidecar.send(&OutboundMessage::Start {
        prompt: content,
        project_dir,
    }) {
        self.messages
            .push(("error".into(), format!("Failed to send prompt: {e}")));
        self.is_streaming = false;
        cx.notify();
        return;
    }

    // Store receiver and poll for messages
    let rx = std::mem::replace(&mut sidecar.receiver, mpsc::channel().1);
    // Keep sidecar alive by leaking it (spike simplification — proper cleanup in later plan)
    std::mem::forget(sidecar);

    self.poll_sidecar(rx, cx);
}

fn poll_sidecar(&mut self, rx: mpsc::Receiver<InboundMessage>, cx: &mut Context<Self>) {
    cx.spawn(async move |this, cx| {
        loop {
            // Check for messages every 50ms
            cx.background_executor()
                .timer(std::time::Duration::from_millis(50))
                .await;

            let mut got_done = false;
            // Drain all available messages
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    InboundMessage::TextDelta { content } => {
                        this.update(cx, |this, cx| {
                            this.append_text(&content, cx);
                        })?;
                    }
                    InboundMessage::Done { .. } => {
                        this.update(cx, |this, cx| {
                            this.finish_response(cx);
                        })?;
                        got_done = true;
                    }
                    InboundMessage::Error { message } => {
                        this.update(cx, |this, cx| {
                            this.messages.push(("error".into(), message));
                            this.is_streaming = false;
                            cx.notify();
                        })?;
                        got_done = true;
                    }
                }
            }

            if got_done {
                break;
            }
        }
        Ok::<_, anyhow::Error>(())
    })
    .detach();
}
```

- [ ] **Step 2: Add input and button to the render method**

Add this to the end of the `render` method in `PairApp`, after the message list div and before the final closing parens:

```rust
.child(
    // Input area
    div()
        .h_flex()
        .gap_2()
        .p_3()
        .border_t_1()
        .border_color(cx.theme().border)
        .child(
            div()
                .flex_1()
                .child(Input::new(&self.input_state))
        )
        .child(
            Button::new("send")
                .primary()
                .label("Send")
                .disabled(self.is_streaming)
                .on_click(cx.listener(Self::send_message)),
        ),
)
```

- [ ] **Step 3: Build and verify the input renders**

Run: `cd pair && cargo run`

Expected: window shows the "Pair" header, empty message area, and a text input with "Ask Pair anything..." placeholder plus a "Send" button at the bottom.

- [ ] **Step 4: Commit**

```bash
git add src/app.rs src/main.rs
git commit -m "feat: chat input + send — spawns sidecar, streams response"
```

---

### Task 8: End-to-End Smoke Test

Run the full pipeline: type a prompt, see Claude's streaming response appear in the window.

**Files:** (no changes — testing only)

- [ ] **Step 1: Ensure ANTHROPIC_API_KEY is set**

Run: `echo $ANTHROPIC_API_KEY | head -c 10`

Expected: should show `sk-ant-api` (first 10 chars of a valid key). If not set, export it.

- [ ] **Step 2: Run the app and send a prompt**

Run: `cd pair && cargo run`

1. Type "What is 2 + 2? Answer in one sentence." in the input field
2. Click "Send"
3. Observe: user message appears with accent background, "Thinking..." appears, then Claude's response streams in

Expected: response appears within a few seconds, showing something like "2 + 2 equals 4."

- [ ] **Step 3: Test a second message**

Without closing the app:
1. Type "Now multiply that by 3" in the input
2. Click "Send"

Expected: second user message and response appear below the first. The conversation accumulates.

Note: in the spike, each message spawns a new sidecar — there's no session continuity yet. That's fine; the spike proves the pipeline works. Session resumption comes in Plan 2.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "spike: end-to-end pipeline verified — GPUI + sidecar + Claude streaming"
```

**Spike complete.** The pipeline works on WSL2. Proceed to Plan 2 (Core Loop: diff preview with accept/reject).
