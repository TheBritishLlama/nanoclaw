# Hone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Hone, a local-first AI writing assistant with real-time autocomplete, grammar corrections, and style-matched rewriting — as a single Rust binary + browser extension.

**Architecture:** Single Rust binary embeds llama.cpp for inference and candle for embeddings. A priority request router serializes all inference on a dedicated thread. The browser extension connects via Chrome Native Messaging (stdin/stdout JSON protocol). System-wide mode uses global hotkeys + clipboard + a native floating overlay.

**Tech Stack:** Rust (tokio, llama-cpp-2, candle, tao, tray-icon, global-hotkey, arboard, serde, notify), TypeScript/JavaScript (Chrome Extension Manifest V3, webpack)

**Spec:** `docs/superpowers/specs/2026-04-03-hone-design.md`

---

## File Structure

### Rust Binary (`hone/`)

```
hone/
├── Cargo.toml
├── build.rs                        # llama.cpp compilation feature flags
├── src/
│   ├── main.rs                     # Entry: init backend, spawn threads, run event loop
│   ├── config.rs                   # Config loading, saving, defaults (~/.hone/config.toml)
│   ├── types.rs                    # Shared types: InferenceRequest, InferenceResponse, Priority
│   ├── hardware.rs                 # GPU VRAM detection, NPU detection, CPU fallback
│   ├── inference/
│   │   ├── mod.rs                  # Re-exports
│   │   ├── engine.rs              # LlamaBackend/Model/Context lifecycle, token generation
│   │   └── cache.rs               # KV cache position tracking, partial invalidation
│   ├── style/
│   │   ├── mod.rs                  # Re-exports + StyleEngine coordinator
│   │   ├── fingerprint.rs         # Analyze docs, generate/load fingerprint JSON
│   │   ├── chunker.rs             # Split .txt/.md files into ~250-word chunks
│   │   ├── embeddings.rs          # MiniLM-L6-v2 via candle, text → Vec<f32>
│   │   └── store.rs               # In-memory vector store, cosine similarity search
│   ├── router.rs                   # Priority mpsc channel, cancellation tokens
│   ├── prompts.rs                  # Prompt templates: autocomplete, corrections, rewrite, synonyms
│   ├── tray.rs                     # System tray icon + context menu
│   ├── hotkeys.rs                  # Global hotkey registration + event dispatch
│   ├── overlay.rs                  # Borderless always-on-top floating window
│   ├── clipboard.rs                # Clipboard read/write + simulated Ctrl+C/V
│   ├── native_messaging.rs         # stdin/stdout length-prefixed JSON bridge
│   ├── settings_window.rs          # Native settings window (model, responsiveness, hotkeys)
│   └── watchdog.rs                 # Heartbeat file + restart check
├── tests/
│   ├── config_test.rs
│   ├── style_test.rs
│   ├── router_test.rs
│   ├── prompts_test.rs
│   └── native_messaging_test.rs
└── native-messaging/
    ├── com.hone.app.json           # Chrome NM host manifest (template)
    └── install.bat                 # Registers NM manifest in Windows registry
```

### Browser Extension (`hone/extension/`)

```
hone/extension/
├── package.json
├── webpack.config.js
├── tsconfig.json
├── src/
│   ├── background.ts              # Service worker: NM connection, message routing
│   ├── content.ts                 # Text field hooking, ghost text, underlines, popovers
│   ├── sidebar.ts                 # Sidebar panel: corrections list, batch select, settings
│   ├── protocol.ts               # Typed NM message helpers (send, receive, ID gen)
│   └── types.ts                  # Shared TS types matching Rust protocol
├── sidebar.html
├── styles.css                     # Ghost text, underlines, popovers, green highlights
├── manifest.json                  # Chrome Manifest V3
└── manifest_firefox.json          # Firefox manifest
```

---

## Phase 1: Foundation

### Task 1: Project Scaffold + Cargo.toml

**Files:**
- Create: `hone/Cargo.toml`
- Create: `hone/build.rs`
- Create: `hone/src/main.rs`
- Create: `hone/.gitignore`

- [ ] **Step 1: Create the project directory and initialize git**

```bash
mkdir -p ~/hone && cd ~/hone
git init
```

- [ ] **Step 2: Create .gitignore**

Create `hone/.gitignore`:

```gitignore
/target
*.gguf
*.onnx
*.bin
.env
```

- [ ] **Step 3: Create Cargo.toml with all dependencies**

Create `hone/Cargo.toml`:

```toml
[package]
name = "hone"
version = "0.1.0"
edition = "2021"
description = "Local-first AI writing assistant"

[dependencies]
# Inference
llama-cpp-2 = { version = "0.1", features = ["cuda"] }

# Embeddings
candle-core = "0.8"
candle-nn = "0.8"
candle-transformers = "0.8"
hf-hub = "0.3"
tokenizers = "0.21"

# Async runtime
tokio = { version = "1", features = ["full"] }

# Serialization + config
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"

# System tray + windowing
tao = "0.32"
tray-icon = "0.19"
global-hotkey = "0.6"

# Clipboard
arboard = "3"

# File watching
notify = "7"

# Utility
uuid = { version = "1", features = ["v4"] }
dirs = "6"
log = "0.4"
env_logger = "0.11"

[profile.release]
strip = true
lto = true
codegen-units = 1
opt-level = 3
```

- [ ] **Step 4: Create minimal main.rs**

Create `hone/src/main.rs`:

```rust
use log::info;

fn main() {
    env_logger::init();
    info!("Hone starting...");

    // Ensure ~/.hone directories exist
    let hone_dir = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".hone");

    for subdir in &["models", "styles", "vectors"] {
        let path = hone_dir.join(subdir);
        if !path.exists() {
            std::fs::create_dir_all(&path)
                .unwrap_or_else(|e| panic!("Failed to create {}: {}", path.display(), e));
        }
    }

    info!("Hone data directory: {}", hone_dir.display());
    info!("Hone initialized successfully");
}
```

- [ ] **Step 5: Create build.rs**

Create `hone/build.rs`:

```rust
fn main() {
    // llama-cpp-2 handles its own build via the llama-cpp-sys-2 crate.
    // This build.rs is a placeholder for future custom build steps
    // (e.g., embedding prompt templates, version info).
    println!("cargo:rerun-if-changed=build.rs");
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd ~/hone && cargo check
```

Expected: compiles with no errors (warnings OK for unused imports).

- [ ] **Step 7: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: project scaffold with Cargo.toml and directory init"
```

---

### Task 2: Config Module

**Files:**
- Create: `hone/src/config.rs`
- Modify: `hone/src/main.rs`
- Create: `hone/tests/config_test.rs`

- [ ] **Step 1: Write the failing test**

Create `hone/tests/config_test.rs`:

```rust
use std::path::PathBuf;

// We'll test config loading/saving by writing a toml file and reading it back.
// This tests the public API of the config module.

#[test]
fn test_default_config_has_sane_values() {
    let config = hone::config::HoneConfig::default();
    assert_eq!(config.model.backend, "cuda");
    assert_eq!(config.autocomplete.debounce_ms, 300);
    assert_eq!(config.autocomplete.max_tokens, 80);
    assert!(config.corrections.enabled);
    assert_eq!(config.corrections.debounce_ms, 500);
    assert_eq!(config.hotkeys.synonym, "Ctrl+Shift+S");
}

#[test]
fn test_config_round_trip() {
    let tmp = std::env::temp_dir().join("hone_test_config.toml");
    let config = hone::config::HoneConfig::default();
    hone::config::save_config(&config, &tmp).unwrap();

    let loaded = hone::config::load_config(&tmp).unwrap();
    assert_eq!(loaded.model.active, config.model.active);
    assert_eq!(loaded.autocomplete.debounce_ms, config.autocomplete.debounce_ms);
    assert_eq!(loaded.hotkeys.rewrite, config.hotkeys.rewrite);

    std::fs::remove_file(&tmp).ok();
}

#[test]
fn test_load_missing_file_returns_default() {
    let path = PathBuf::from("/tmp/hone_nonexistent_config.toml");
    let config = hone::config::load_config(&path).unwrap();
    assert_eq!(config.autocomplete.debounce_ms, 300);
}

#[test]
fn test_responsiveness_preset_fast() {
    let config = hone::config::HoneConfig::with_responsiveness(
        hone::config::Responsiveness::Fast,
    );
    assert_eq!(config.autocomplete.debounce_ms, 150);
    assert_eq!(config.corrections.debounce_ms, 300);
}

#[test]
fn test_responsiveness_preset_relaxed() {
    let config = hone::config::HoneConfig::with_responsiveness(
        hone::config::Responsiveness::Relaxed,
    );
    assert_eq!(config.autocomplete.debounce_ms, 500);
    assert_eq!(config.corrections.debounce_ms, 800);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/hone && cargo test --test config_test 2>&1 | head -20
```

Expected: compilation error — `hone::config` module doesn't exist yet.

- [ ] **Step 3: Implement config.rs**

Create `hone/src/config.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Responsiveness {
    Fast,
    Default,
    Relaxed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelConfig {
    pub active: String,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutocompleteConfig {
    pub debounce_ms: u32,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CorrectionsConfig {
    pub debounce_ms: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RewriteConfig {
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HotkeyConfig {
    pub synonym: String,
    pub rewrite: String,
    pub generate: String,
    pub clipboard_analyze: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StyleConfig {
    pub styles_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HoneConfig {
    pub model: ModelConfig,
    pub autocomplete: AutocompleteConfig,
    pub corrections: CorrectionsConfig,
    pub rewrite: RewriteConfig,
    pub hotkeys: HotkeyConfig,
    pub style: StyleConfig,
}

impl Default for HoneConfig {
    fn default() -> Self {
        let styles_dir = dirs::home_dir()
            .map(|h| h.join(".hone").join("styles").to_string_lossy().into_owned())
            .unwrap_or_else(|| "~/.hone/styles".to_string());

        Self {
            model: ModelConfig {
                active: String::new(),
                backend: "cuda".to_string(),
            },
            autocomplete: AutocompleteConfig {
                debounce_ms: 300,
                max_tokens: 80,
                temperature: 0.3,
            },
            corrections: CorrectionsConfig {
                debounce_ms: 500,
                enabled: true,
            },
            rewrite: RewriteConfig {
                temperature: 0.7,
            },
            hotkeys: HotkeyConfig {
                synonym: "Ctrl+Shift+S".to_string(),
                rewrite: "Ctrl+Shift+R".to_string(),
                generate: "Ctrl+Shift+G".to_string(),
                clipboard_analyze: "Ctrl+Shift+H".to_string(),
            },
            style: StyleConfig { styles_dir },
        }
    }
}

impl HoneConfig {
    pub fn with_responsiveness(preset: Responsiveness) -> Self {
        let mut config = Self::default();
        match preset {
            Responsiveness::Fast => {
                config.autocomplete.debounce_ms = 150;
                config.corrections.debounce_ms = 300;
            }
            Responsiveness::Default => {} // already default
            Responsiveness::Relaxed => {
                config.autocomplete.debounce_ms = 500;
                config.corrections.debounce_ms = 800;
            }
        }
        config
    }
}

pub fn load_config(path: &Path) -> Result<HoneConfig, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(HoneConfig::default());
    }
    let contents = std::fs::read_to_string(path)?;
    let config: HoneConfig = toml::from_str(&contents)?;
    Ok(config)
}

pub fn save_config(config: &HoneConfig, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let contents = toml::to_string_pretty(config)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(())
}
```

- [ ] **Step 4: Add config module to main.rs and make it a library**

Update `hone/src/main.rs` — add at the top:

```rust
pub mod config;
```

Also create `hone/src/lib.rs` so tests can import `hone::config`:

```rust
pub mod config;
```

Remove `pub mod config;` from `main.rs` and instead add:

```rust
use hone::config;
```

Updated `hone/src/main.rs`:

```rust
use hone::config::{load_config, save_config, HoneConfig};
use log::info;

fn main() {
    env_logger::init();
    info!("Hone starting...");

    let hone_dir = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".hone");

    for subdir in &["models", "styles", "vectors"] {
        let path = hone_dir.join(subdir);
        if !path.exists() {
            std::fs::create_dir_all(&path)
                .unwrap_or_else(|e| panic!("Failed to create {}: {}", path.display(), e));
        }
    }

    let config_path = hone_dir.join("config.toml");
    let config = load_config(&config_path).expect("Failed to load config");

    // Write default config if it doesn't exist
    if !config_path.exists() {
        save_config(&config, &config_path).expect("Failed to save default config");
        info!("Created default config at {}", config_path.display());
    }

    info!("Active model: {}", if config.model.active.is_empty() { "<none>" } else { &config.model.active });
    info!("Backend: {}", config.model.backend);
    info!("Hone initialized successfully");
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/hone && cargo test --test config_test
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: config module with TOML loading, saving, and responsiveness presets"
```

---

### Task 3: Shared Types

**Files:**
- Create: `hone/src/types.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Create types.rs**

Create `hone/src/types.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Priority levels for the request router.
/// Higher priority requests can cancel lower priority ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Low = 0,       // Background tasks (re-indexing style docs)
    Normal = 1,    // Corrections, rewrites, synonyms
    High = 2,      // Autocomplete (user is waiting)
}

/// The type of inference request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RequestType {
    #[serde(rename = "autocomplete")]
    Autocomplete {
        context: String,
        cursor: usize,
    },
    #[serde(rename = "corrections")]
    Corrections {
        text: String,
    },
    #[serde(rename = "rewrite")]
    Rewrite {
        text: String,
        surrounding_context: String,
    },
    #[serde(rename = "synonyms")]
    Synonyms {
        word: String,
        sentence: String,
    },
    #[serde(rename = "generate")]
    Generate {
        context: String,
        cursor: usize,
    },
}

/// An inference request sent to the router.
#[derive(Debug, Clone)]
pub struct InferenceRequest {
    pub id: String,
    pub priority: Priority,
    pub request_type: RequestType,
}

/// A single correction item returned by the corrections pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrectionItem {
    pub start: usize,
    pub length: usize,
    pub suggestion: String,
    pub reason: String,
    pub severity: CorrectionSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CorrectionSeverity {
    Error,
    Style,
}

/// Response types sent back to the caller (extension or clipboard workflow).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InferenceResponse {
    #[serde(rename = "token")]
    Token { id: String, text: String },

    #[serde(rename = "done")]
    Done { id: String },

    #[serde(rename = "corrections")]
    Corrections { id: String, items: Vec<CorrectionItem> },

    #[serde(rename = "synonyms")]
    SynonymList { id: String, alternatives: Vec<String> },

    #[serde(rename = "rewrite")]
    RewriteResult { id: String, text: String },

    #[serde(rename = "error")]
    Error { id: String, message: String },
}

/// A discovered model in the ~/.hone/models/ directory.
#[derive(Debug, Clone)]
pub struct DiscoveredModel {
    pub name: String,
    pub path: std::path::PathBuf,
    pub size_bytes: u64,
}
```

- [ ] **Step 2: Register module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod types;
```

- [ ] **Step 3: Verify it compiles**

```bash
cd ~/hone && cargo check
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: shared types for requests, responses, priorities, and corrections"
```

---

### Task 4: Hardware Detection + Model Discovery

**Files:**
- Create: `hone/src/hardware.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add tests at the bottom of the hardware module (inline tests since these are simple):

Create `hone/src/hardware.rs`:

```rust
use crate::types::DiscoveredModel;
use log::{info, warn};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct HardwareInfo {
    pub gpu_available: bool,
    pub gpu_vram_mb: Option<u64>,
    pub npu_available: bool,
    pub recommended_backend: String,
    pub recommended_model_tier: String,
}

/// Detect available hardware (GPU, NPU, CPU).
/// On Windows, checks for NVIDIA GPU via nvidia-smi.
pub fn detect_hardware() -> HardwareInfo {
    let (gpu_available, gpu_vram_mb) = detect_nvidia_gpu();
    let npu_available = detect_npu();

    let (recommended_backend, recommended_model_tier) = if gpu_available {
        let vram = gpu_vram_mb.unwrap_or(0);
        if vram >= 12_000 {
            ("cuda".to_string(), "high".to_string())
        } else if vram >= 8_000 {
            ("cuda".to_string(), "mid".to_string())
        } else {
            ("cuda".to_string(), "low".to_string())
        }
    } else if npu_available {
        ("directml".to_string(), "npu".to_string())
    } else {
        ("cpu".to_string(), "low".to_string())
    };

    let hw = HardwareInfo {
        gpu_available,
        gpu_vram_mb,
        npu_available,
        recommended_backend,
        recommended_model_tier,
    };

    info!("Hardware detected: GPU={} ({}MB VRAM), NPU={}, recommended={}",
        hw.gpu_available,
        hw.gpu_vram_mb.unwrap_or(0),
        hw.npu_available,
        hw.recommended_backend,
    );

    hw
}

fn detect_nvidia_gpu() -> (bool, Option<u64>) {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let vram: Option<u64> = stdout.trim().lines().next()
                .and_then(|line| line.trim().parse().ok());
            (true, vram)
        }
        _ => {
            warn!("nvidia-smi not found or failed — no NVIDIA GPU detected");
            (false, None)
        }
    }
}

fn detect_npu() -> bool {
    // Check for AMD XDNA driver (Ryzen AI)
    let xdna = Path::new(r"C:\Windows\System32\drivers\amdxdna.sys").exists();
    // Check for Intel NPU driver
    let intel_npu = Path::new(r"C:\Windows\System32\drivers\intel_npu.sys").exists();
    xdna || intel_npu
}

/// Scan ~/.hone/models/ for GGUF and ONNX files.
pub fn discover_models(models_dir: &Path) -> Vec<DiscoveredModel> {
    let mut models = Vec::new();

    let entries = match std::fs::read_dir(models_dir) {
        Ok(e) => e,
        Err(_) => return models,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext == "gguf" || ext == "onnx" {
            let name = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            models.push(DiscoveredModel { name, path, size_bytes });
        }
    }

    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_detect_hardware_runs_without_panic() {
        // Just ensure it doesn't crash — actual GPU presence varies
        let hw = detect_hardware();
        assert!(!hw.recommended_backend.is_empty());
        assert!(!hw.recommended_model_tier.is_empty());
    }

    #[test]
    fn test_discover_models_empty_dir() {
        let tmp = std::env::temp_dir().join("hone_test_models_empty");
        fs::create_dir_all(&tmp).unwrap();
        let models = discover_models(&tmp);
        assert!(models.is_empty());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_discover_models_finds_gguf_files() {
        let tmp = std::env::temp_dir().join("hone_test_models_gguf");
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("qwen3-8b-q5.gguf"), b"fake model data").unwrap();
        fs::write(tmp.join("custom.gguf"), b"fake").unwrap();
        fs::write(tmp.join("readme.txt"), b"not a model").unwrap();

        let models = discover_models(&tmp);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "custom");
        assert_eq!(models[1].name, "qwen3-8b-q5");

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_discover_models_finds_onnx_files() {
        let tmp = std::env::temp_dir().join("hone_test_models_onnx");
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("qwen3-4b-int4.onnx"), b"fake").unwrap();

        let models = discover_models(&tmp);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "qwen3-4b-int4");

        fs::remove_dir_all(&tmp).ok();
    }
}
```

- [ ] **Step 2: Register module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod hardware;
pub mod types;
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd ~/hone && cargo test hardware::tests
```

Expected: all 4 tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: hardware detection (GPU/NPU/CPU) and model file discovery"
```

---

## Phase 2: Inference Engine

### Task 5: Inference Engine — Model Loading + Token Generation

**Files:**
- Create: `hone/src/inference/mod.rs`
- Create: `hone/src/inference/engine.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Create inference module structure**

Create `hone/src/inference/mod.rs`:

```rust
pub mod engine;
pub mod cache;
```

Create `hone/src/inference/cache.rs` (placeholder — implemented in Task 6):

```rust
// KV cache tracking — implemented in Task 6
```

- [ ] **Step 2: Implement engine.rs**

Create `hone/src/inference/engine.rs`:

```rust
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;
use log::{info, error};
use std::path::Path;
use std::sync::mpsc;

/// Holds the loaded model and backend. Created once, lives for the app's lifetime
/// (or until the user switches models).
pub struct InferenceEngine {
    backend: LlamaBackend,
    model: Option<LoadedModel>,
}

struct LoadedModel {
    model: LlamaModel,
    name: String,
}

/// Configuration for a generation request.
pub struct GenerationParams {
    pub prompt: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub stop_on_newline: bool,
}

impl InferenceEngine {
    /// Initialize the inference engine. Call once at startup.
    pub fn new() -> Result<Self, String> {
        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to init llama backend: {}", e))?;

        info!("llama.cpp backend initialized (GPU offload: {})",
            backend.supports_gpu_offload());

        Ok(Self {
            backend,
            model: None,
        })
    }

    /// Load a GGUF model from disk. Unloads any previously loaded model.
    pub fn load_model(&mut self, path: &Path, n_gpu_layers: u32) -> Result<(), String> {
        let name = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        info!("Loading model '{}' from {}", name, path.display());

        let model_params = LlamaModelParams::default()
            .with_n_gpu_layers(n_gpu_layers);

        let model = LlamaModel::load_from_file(&self.backend, path, &model_params)
            .map_err(|e| format!("Failed to load model: {}", e))?;

        info!("Model loaded: {} params, {} vocab, {}B context",
            model.n_params(), model.n_vocab(), model.n_ctx_train());

        self.model = Some(LoadedModel { model, name });
        Ok(())
    }

    /// Unload the current model, freeing memory.
    pub fn unload_model(&mut self) {
        if let Some(ref m) = self.model {
            info!("Unloading model '{}'", m.name);
        }
        self.model = None;
    }

    /// Get the name of the currently loaded model.
    pub fn active_model_name(&self) -> Option<&str> {
        self.model.as_ref().map(|m| m.name.as_str())
    }

    /// Generate tokens from a prompt, sending each token through the channel.
    /// Returns when generation is complete or cancelled (cancel_rx receives a message).
    pub fn generate(
        &self,
        params: &GenerationParams,
        token_tx: mpsc::Sender<String>,
        cancel_rx: mpsc::Receiver<()>,
    ) -> Result<(), String> {
        let loaded = self.model.as_ref()
            .ok_or_else(|| "No model loaded".to_string())?;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(std::num::NonZeroU32::new(4096));

        let mut ctx = loaded.model.new_context(&self.backend, ctx_params)
            .map_err(|e| format!("Failed to create context: {}", e))?;

        // Tokenize prompt
        let tokens = loaded.model.str_to_token(&params.prompt, AddBos::Always)
            .map_err(|e| format!("Failed to tokenize: {}", e))?;

        // Process prompt tokens through the model
        let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
        for (i, token) in tokens.iter().enumerate() {
            let is_last = i == tokens.len() - 1;
            batch.add(*token, i as i32, &[0], is_last)
                .map_err(|e| format!("Failed to add token to batch: {}", e))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode prompt: {}", e))?;

        // Set up sampler with temperature
        let mut sampler = if params.temperature < 0.01 {
            LlamaSampler::greedy()
        } else {
            LlamaSampler::chain_simple([
                LlamaSampler::temp(params.temperature),
                LlamaSampler::dist(0),
            ])
        };

        // Generate tokens one at a time
        let mut n_decoded = tokens.len() as i32;

        for _ in 0..params.max_tokens {
            // Check for cancellation
            if cancel_rx.try_recv().is_ok() {
                info!("Generation cancelled");
                return Ok(());
            }

            let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(new_token);

            if loaded.model.is_eog_token(new_token) {
                break;
            }

            let token_str = loaded.model.token_to_str(new_token, Special::Tokenize)
                .map_err(|e| format!("Failed to decode token: {}", e))?;

            if params.stop_on_newline && token_str.contains('\n') {
                break;
            }

            if token_tx.send(token_str).is_err() {
                // Receiver dropped — stop generating
                break;
            }

            // Prepare next batch
            batch.clear();
            batch.add(new_token, n_decoded, &[0], true)
                .map_err(|e| format!("Failed to add token: {}", e))?;
            n_decoded += 1;

            ctx.decode(&mut batch)
                .map_err(|e| format!("Failed to decode: {}", e))?;
        }

        Ok(())
    }

    /// Generate a complete response (non-streaming). Used for corrections and synonyms
    /// where we need the full result before returning.
    pub fn generate_complete(
        &self,
        params: &GenerationParams,
        cancel_rx: mpsc::Receiver<()>,
    ) -> Result<String, String> {
        let (tx, rx) = mpsc::channel();
        self.generate(params, tx, cancel_rx)?;

        let mut result = String::new();
        while let Ok(token) = rx.recv() {
            result.push_str(&token);
        }
        Ok(result)
    }
}
```

- [ ] **Step 3: Register module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod hardware;
pub mod inference;
pub mod types;
```

- [ ] **Step 4: Verify it compiles**

```bash
cd ~/hone && cargo check
```

Expected: compiles (can't run inference tests without a GGUF model file).

- [ ] **Step 5: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: inference engine with model loading, streaming generation, and cancellation"
```

---

### Task 6: KV Cache Tracking

**Files:**
- Modify: `hone/src/inference/cache.rs`

- [ ] **Step 1: Write the failing test**

Replace `hone/src/inference/cache.rs`:

```rust
/// Tracks KV cache state for incremental context processing.
/// When the user accepts autocomplete and keeps typing, we don't want to
/// re-process the entire document — only the new tokens since last generation.
///
/// This tracker remembers how much of the context was already processed,
/// and detects when an edit earlier in the document invalidates the cache.

#[derive(Debug)]
pub struct CacheTracker {
    /// The text that has been processed into the KV cache so far.
    processed_text: String,
}

impl CacheTracker {
    pub fn new() -> Self {
        Self {
            processed_text: String::new(),
        }
    }

    /// Given the new full context, determine how much can be reused.
    /// Returns (reuse_len, needs_full_reprocess).
    ///
    /// - If the new context starts with the same text as processed_text,
    ///   we can reuse the cache up to the common prefix length.
    /// - If the new context diverges from the processed text (edit in the middle),
    ///   the cache is invalid from the divergence point onward.
    pub fn check_reuse(&self, new_context: &str) -> CacheReuse {
        if self.processed_text.is_empty() {
            return CacheReuse::Full;
        }

        let common_len = self.processed_text.bytes()
            .zip(new_context.bytes())
            .take_while(|(a, b)| a == b)
            .count();

        // Snap to a UTF-8 char boundary
        let common_len = snap_to_char_boundary(new_context, common_len);

        if common_len == 0 {
            CacheReuse::Full
        } else if common_len >= self.processed_text.len() {
            // New context extends beyond what we processed — just process the new part
            CacheReuse::Partial {
                reuse_chars: common_len,
            }
        } else {
            // Edit happened before end of processed text — need to reprocess from divergence
            CacheReuse::Partial {
                reuse_chars: common_len,
            }
        }
    }

    /// Mark that we've processed up to this text.
    pub fn mark_processed(&mut self, text: &str) {
        self.processed_text = text.to_string();
    }

    /// Clear the cache tracker (e.g. when switching models).
    pub fn clear(&mut self) {
        self.processed_text.clear();
    }

    pub fn processed_len(&self) -> usize {
        self.processed_text.len()
    }
}

#[derive(Debug, PartialEq)]
pub enum CacheReuse {
    /// Nothing cached — process everything from scratch.
    Full,
    /// Can reuse cache up to reuse_chars. Process the rest.
    Partial { reuse_chars: usize },
}

fn snap_to_char_boundary(s: &str, pos: usize) -> usize {
    if pos >= s.len() {
        return s.len();
    }
    let mut p = pos;
    while p > 0 && !s.is_char_boundary(p) {
        p -= 1;
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_cache_returns_full() {
        let tracker = CacheTracker::new();
        assert_eq!(tracker.check_reuse("Hello world"), CacheReuse::Full);
    }

    #[test]
    fn test_appended_text_returns_partial() {
        let mut tracker = CacheTracker::new();
        tracker.mark_processed("Hello ");
        let result = tracker.check_reuse("Hello world");
        assert_eq!(result, CacheReuse::Partial { reuse_chars: 6 });
    }

    #[test]
    fn test_identical_text_returns_partial_full_reuse() {
        let mut tracker = CacheTracker::new();
        tracker.mark_processed("Hello world");
        let result = tracker.check_reuse("Hello world");
        assert_eq!(result, CacheReuse::Partial { reuse_chars: 11 });
    }

    #[test]
    fn test_edit_in_middle_returns_partial_from_divergence() {
        let mut tracker = CacheTracker::new();
        tracker.mark_processed("The quick brown fox");
        let result = tracker.check_reuse("The quick red fox");
        // Diverges at position 10 ("brown" vs "red")
        assert_eq!(result, CacheReuse::Partial { reuse_chars: 10 });
    }

    #[test]
    fn test_completely_different_text_returns_full() {
        let mut tracker = CacheTracker::new();
        tracker.mark_processed("Hello world");
        let result = tracker.check_reuse("Goodbye moon");
        assert_eq!(result, CacheReuse::Full);
    }

    #[test]
    fn test_clear_resets() {
        let mut tracker = CacheTracker::new();
        tracker.mark_processed("Hello");
        tracker.clear();
        assert_eq!(tracker.processed_len(), 0);
        assert_eq!(tracker.check_reuse("Hello"), CacheReuse::Full);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd ~/hone && cargo test inference::cache::tests
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: KV cache tracker with partial reuse and divergence detection"
```

---

### Task 7: Request Router

**Files:**
- Create: `hone/src/router.rs`
- Create: `hone/tests/router_test.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `hone/tests/router_test.rs`:

```rust
use hone::router::{RequestRouter, RouterHandle};
use hone::types::{InferenceRequest, Priority, RequestType};

#[tokio::test]
async fn test_requests_are_dequeued_by_priority() {
    let (router, handle) = RequestRouter::new();

    // Send low priority first, then high
    handle.send(InferenceRequest {
        id: "low-1".to_string(),
        priority: Priority::Low,
        request_type: RequestType::Corrections { text: "test".to_string() },
    }).await.unwrap();

    handle.send(InferenceRequest {
        id: "high-1".to_string(),
        priority: Priority::High,
        request_type: RequestType::Autocomplete { context: "test".to_string(), cursor: 4 },
    }).await.unwrap();

    handle.send(InferenceRequest {
        id: "normal-1".to_string(),
        priority: Priority::Normal,
        request_type: RequestType::Rewrite {
            text: "test".to_string(),
            surrounding_context: String::new(),
        },
    }).await.unwrap();

    // Drain should return high, normal, low
    let req1 = router.recv().await.unwrap();
    assert_eq!(req1.id, "high-1");

    let req2 = router.recv().await.unwrap();
    assert_eq!(req2.id, "normal-1");

    let req3 = router.recv().await.unwrap();
    assert_eq!(req3.id, "low-1");
}

#[tokio::test]
async fn test_cancel_clears_lower_priority() {
    let (router, handle) = RequestRouter::new();

    handle.send(InferenceRequest {
        id: "normal-1".to_string(),
        priority: Priority::Normal,
        request_type: RequestType::Corrections { text: "test".to_string() },
    }).await.unwrap();

    // Cancel all requests at or below Normal priority
    handle.cancel_at_or_below(Priority::Normal).await;

    handle.send(InferenceRequest {
        id: "high-1".to_string(),
        priority: Priority::High,
        request_type: RequestType::Autocomplete { context: "test".to_string(), cursor: 4 },
    }).await.unwrap();

    let req = router.recv().await.unwrap();
    assert_eq!(req.id, "high-1");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/hone && cargo test --test router_test 2>&1 | head -10
```

Expected: compilation error — `hone::router` doesn't exist.

- [ ] **Step 3: Implement router.rs**

Create `hone/src/router.rs`:

```rust
use crate::types::{InferenceRequest, Priority};
use std::collections::BinaryHeap;
use std::cmp::Ordering;
use tokio::sync::{mpsc, Mutex, Notify};
use std::sync::Arc;

/// Wraps an InferenceRequest so BinaryHeap sorts by priority (highest first).
struct PrioritizedRequest {
    request: InferenceRequest,
    sequence: u64, // tie-breaker: lower = earlier = dequeued first
}

impl Eq for PrioritizedRequest {}

impl PartialEq for PrioritizedRequest {
    fn eq(&self, other: &Self) -> bool {
        self.request.priority == other.request.priority && self.sequence == other.sequence
    }
}

impl Ord for PrioritizedRequest {
    fn cmp(&self, other: &Self) -> Ordering {
        self.request.priority.cmp(&other.request.priority)
            .then_with(|| other.sequence.cmp(&self.sequence)) // lower sequence = higher priority (FIFO within same level)
    }
}

impl PartialOrd for PrioritizedRequest {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

struct RouterInner {
    queue: BinaryHeap<PrioritizedRequest>,
    next_sequence: u64,
}

/// The receiving end of the router — used by the inference thread.
pub struct RequestRouter {
    inner: Arc<Mutex<RouterInner>>,
    notify: Arc<Notify>,
}

/// The sending end — cloneable, used by Native Messaging, hotkeys, etc.
#[derive(Clone)]
pub struct RouterHandle {
    inner: Arc<Mutex<RouterInner>>,
    notify: Arc<Notify>,
}

impl RequestRouter {
    pub fn new() -> (Self, RouterHandle) {
        let inner = Arc::new(Mutex::new(RouterInner {
            queue: BinaryHeap::new(),
            next_sequence: 0,
        }));
        let notify = Arc::new(Notify::new());

        let router = Self {
            inner: Arc::clone(&inner),
            notify: Arc::clone(&notify),
        };
        let handle = RouterHandle {
            inner,
            notify,
        };

        (router, handle)
    }

    /// Wait for and return the highest-priority request.
    pub async fn recv(&self) -> Option<InferenceRequest> {
        loop {
            {
                let mut inner = self.inner.lock().await;
                if let Some(pr) = inner.queue.pop() {
                    return Some(pr.request);
                }
            }
            self.notify.notified().await;
        }
    }
}

impl RouterHandle {
    /// Submit a request to the router.
    pub async fn send(&self, request: InferenceRequest) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let sequence = inner.next_sequence;
        inner.next_sequence += 1;
        inner.queue.push(PrioritizedRequest { request, sequence });
        drop(inner);
        self.notify.notify_one();
        Ok(())
    }

    /// Cancel all pending requests at or below the given priority.
    pub async fn cancel_at_or_below(&self, max_priority: Priority) {
        let mut inner = self.inner.lock().await;
        let remaining: Vec<_> = inner.queue.drain()
            .filter(|pr| pr.request.priority > max_priority)
            .collect();
        inner.queue = remaining.into_iter().collect();
    }
}
```

- [ ] **Step 4: Register module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod hardware;
pub mod inference;
pub mod router;
pub mod types;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/hone && cargo test --test router_test
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: priority request router with cancellation support"
```

---

## Phase 3: Style Engine

### Task 8: Text Chunker

**Files:**
- Create: `hone/src/style/mod.rs`
- Create: `hone/src/style/chunker.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Write the failing test inline in chunker.rs**

Create `hone/src/style/mod.rs`:

```rust
pub mod chunker;
pub mod embeddings;
pub mod fingerprint;
pub mod store;
```

Create `hone/src/style/chunker.rs`:

```rust
/// Splits text into chunks of approximately `target_words` words.
/// Tries to break on paragraph boundaries first, then sentence boundaries.
pub fn chunk_text(text: &str, target_words: usize) -> Vec<String> {
    let paragraphs: Vec<&str> = text.split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    let mut chunks = Vec::new();
    let mut current_chunk = String::new();
    let mut current_words = 0;

    for para in paragraphs {
        let para_words = para.split_whitespace().count();

        if current_words + para_words > target_words && current_words > 0 {
            chunks.push(current_chunk.trim().to_string());
            current_chunk = String::new();
            current_words = 0;
        }

        if !current_chunk.is_empty() {
            current_chunk.push_str("\n\n");
        }
        current_chunk.push_str(para);
        current_words += para_words;
    }

    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }

    chunks
}

/// Read a file and chunk it. Supports .txt and .md files.
pub fn chunk_file(path: &std::path::Path, target_words: usize) -> Result<Vec<String>, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    Ok(chunk_text(&text, target_words))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_text_returns_empty() {
        assert!(chunk_text("", 250).is_empty());
    }

    #[test]
    fn test_short_text_returns_single_chunk() {
        let text = "Hello world. This is a short paragraph.";
        let chunks = chunk_text(text, 250);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], text);
    }

    #[test]
    fn test_splits_on_paragraph_boundary() {
        let para1 = "First paragraph. ".repeat(30); // ~60 words
        let para2 = "Second paragraph. ".repeat(30);
        let text = format!("{}\n\n{}", para1.trim(), para2.trim());

        let chunks = chunk_text(&text, 50);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].starts_with("First"));
        assert!(chunks[1].starts_with("Second"));
    }

    #[test]
    fn test_small_paragraphs_merge_into_one_chunk() {
        let text = "One.\n\nTwo.\n\nThree.";
        let chunks = chunk_text(text, 250);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("One."));
        assert!(chunks[0].contains("Three."));
    }
}
```

- [ ] **Step 2: Register style module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod hardware;
pub mod inference;
pub mod router;
pub mod style;
pub mod types;
```

Create placeholder files for other style submodules:

`hone/src/style/embeddings.rs`:
```rust
// Implemented in Task 9
```

`hone/src/style/fingerprint.rs`:
```rust
// Implemented in Task 10
```

`hone/src/style/store.rs`:
```rust
// Implemented in Task 9
```

- [ ] **Step 3: Run tests**

```bash
cd ~/hone && cargo test style::chunker::tests
```

Expected: all 4 tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: text chunker for splitting writing samples into ~250-word chunks"
```

---

### Task 9: Embeddings + Vector Store

**Files:**
- Modify: `hone/src/style/embeddings.rs`
- Modify: `hone/src/style/store.rs`
- Create: `hone/tests/style_test.rs`

- [ ] **Step 1: Write the failing test**

Create `hone/tests/style_test.rs`:

```rust
use hone::style::store::VectorStore;

#[test]
fn test_store_and_search() {
    let mut store = VectorStore::new();

    // Insert 3 vectors (dim=4 for simplicity)
    store.insert("chunk-1".to_string(), "About programming and code".to_string(), vec![1.0, 0.0, 0.0, 0.0]);
    store.insert("chunk-2".to_string(), "About cooking and recipes".to_string(), vec![0.0, 1.0, 0.0, 0.0]);
    store.insert("chunk-3".to_string(), "About software engineering".to_string(), vec![0.9, 0.1, 0.0, 0.0]);

    // Search with a vector close to chunk-1 and chunk-3
    let results = store.search(&[0.95, 0.05, 0.0, 0.0], 2);
    assert_eq!(results.len(), 2);
    // chunk-1 or chunk-3 should be top results (both close to the query)
    let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"chunk-1"));
    assert!(ids.contains(&"chunk-3"));
}

#[test]
fn test_store_clear() {
    let mut store = VectorStore::new();
    store.insert("chunk-1".to_string(), "text".to_string(), vec![1.0, 0.0]);
    assert_eq!(store.len(), 1);
    store.clear();
    assert_eq!(store.len(), 0);
}

#[test]
fn test_search_empty_store() {
    let store = VectorStore::new();
    let results = store.search(&[1.0, 0.0], 3);
    assert!(results.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/hone && cargo test --test style_test 2>&1 | head -10
```

Expected: compilation error.

- [ ] **Step 3: Implement store.rs**

Replace `hone/src/style/store.rs`:

```rust
/// Simple in-memory vector store with cosine similarity search.
/// For ~75-200 vectors (chunked writing samples), brute-force search
/// is faster than any index structure and has zero overhead.

#[derive(Debug, Clone)]
pub struct VectorEntry {
    pub id: String,
    pub text: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub id: String,
    pub text: String,
    pub score: f32,
}

pub struct VectorStore {
    entries: Vec<VectorEntry>,
}

impl VectorStore {
    pub fn new() -> Self {
        Self { entries: Vec::new() }
    }

    pub fn insert(&mut self, id: String, text: String, embedding: Vec<f32>) {
        self.entries.push(VectorEntry { id, text, embedding });
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Find the `k` most similar entries to the query vector.
    pub fn search(&self, query: &[f32], k: usize) -> Vec<SearchResult> {
        if self.entries.is_empty() {
            return Vec::new();
        }

        let mut scored: Vec<SearchResult> = self.entries.iter()
            .map(|entry| SearchResult {
                id: entry.id.clone(),
                text: entry.text.clone(),
                score: cosine_similarity(query, &entry.embedding),
            })
            .collect();

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(k);
        scored
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_identical_vectors() {
        let score = cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]);
        assert!((score - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_orthogonal_vectors() {
        let score = cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]);
        assert!(score.abs() < 0.001);
    }
}
```

- [ ] **Step 4: Implement embeddings.rs**

Replace `hone/src/style/embeddings.rs`:

```rust
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config as BertConfig};
use hf_hub::{api::sync::Api, Repo, RepoType};
use log::info;
use tokenizers::Tokenizer;

const MODEL_ID: &str = "sentence-transformers/all-MiniLM-L6-v2";

pub struct EmbeddingModel {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl EmbeddingModel {
    /// Load the MiniLM-L6-v2 embedding model. Downloads from HuggingFace on first use.
    /// Always runs on CPU (tiny model, <5ms per embedding).
    pub fn load() -> Result<Self, String> {
        info!("Loading embedding model: {}", MODEL_ID);
        let device = Device::Cpu;

        let api = Api::new().map_err(|e| format!("HF API error: {}", e))?;
        let repo = api.repo(Repo::new(MODEL_ID.to_string(), RepoType::Model));

        let tokenizer_path = repo.get("tokenizer.json")
            .map_err(|e| format!("Failed to download tokenizer: {}", e))?;
        let weights_path = repo.get("model.safetensors")
            .map_err(|e| format!("Failed to download weights: {}", e))?;
        let config_path = repo.get("config.json")
            .map_err(|e| format!("Failed to download config: {}", e))?;

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: BertConfig = serde_json::from_str(&config_str)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[weights_path], candle_core::DType::F32, &device)
                .map_err(|e| format!("Failed to load weights: {}", e))?
        };

        let model = BertModel::load(vb, &config)
            .map_err(|e| format!("Failed to build model: {}", e))?;

        info!("Embedding model loaded successfully");
        Ok(Self { model, tokenizer, device })
    }

    /// Generate an embedding vector for the given text.
    /// Returns a Vec<f32> of dimension 384 (MiniLM-L6-v2 output dimension).
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self.tokenizer.encode(text, true)
            .map_err(|e| format!("Tokenization failed: {}", e))?;

        let token_ids = encoding.get_ids().to_vec();
        let token_type_ids = encoding.get_type_ids().to_vec();
        let attention_mask: Vec<u32> = encoding.get_attention_mask().to_vec();

        let token_ids_t = Tensor::new(vec![token_ids], &self.device)
            .map_err(|e| format!("Tensor error: {}", e))?;
        let token_type_ids_t = Tensor::new(vec![token_type_ids], &self.device)
            .map_err(|e| format!("Tensor error: {}", e))?;

        let embeddings = self.model.forward(&token_ids_t, &token_type_ids_t, None)
            .map_err(|e| format!("Forward pass failed: {}", e))?;

        // Mean pooling with attention mask
        let attention_mask_f = Tensor::new(vec![attention_mask.iter().map(|&m| m as f32).collect::<Vec<_>>()], &self.device)
            .map_err(|e| format!("Tensor error: {}", e))?
            .unsqueeze(2)
            .map_err(|e| format!("Unsqueeze error: {}", e))?;

        let masked = embeddings.broadcast_mul(&attention_mask_f)
            .map_err(|e| format!("Mul error: {}", e))?;
        let summed = masked.sum(1)
            .map_err(|e| format!("Sum error: {}", e))?;
        let count = attention_mask_f.sum(1)
            .map_err(|e| format!("Sum error: {}", e))?;
        let mean = summed.broadcast_div(&count)
            .map_err(|e| format!("Div error: {}", e))?;

        // Normalize
        let norm = mean.sqr()
            .map_err(|e| format!("Sqr error: {}", e))?
            .sum(1)
            .map_err(|e| format!("Sum error: {}", e))?
            .sqrt()
            .map_err(|e| format!("Sqrt error: {}", e))?;
        let normalized = mean.broadcast_div(&norm)
            .map_err(|e| format!("Div error: {}", e))?;

        let vec: Vec<f32> = normalized.squeeze(0)
            .map_err(|e| format!("Squeeze error: {}", e))?
            .to_vec1()
            .map_err(|e| format!("To vec error: {}", e))?;

        Ok(vec)
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd ~/hone && cargo test --test style_test
```

Expected: all 3 tests pass (store tests don't need the embedding model).

- [ ] **Step 6: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: vector store with cosine similarity + MiniLM embedding model"
```

---

### Task 10: Style Fingerprint

**Files:**
- Modify: `hone/src/style/fingerprint.rs`

- [ ] **Step 1: Implement fingerprint.rs**

Replace `hone/src/style/fingerprint.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The style fingerprint — a structured profile of the user's writing style.
/// Generated by analyzing their writing samples with the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleFingerprint {
    pub avg_sentence_length: f32,
    pub vocabulary_level: String,
    pub tone_markers: Vec<String>,
    pub patterns: Vec<String>,
    pub avoid: Vec<String>,
    pub sample_phrases: Vec<String>,
}

impl Default for StyleFingerprint {
    fn default() -> Self {
        Self {
            avg_sentence_length: 0.0,
            vocabulary_level: "unknown".to_string(),
            tone_markers: Vec::new(),
            patterns: Vec::new(),
            avoid: Vec::new(),
            sample_phrases: Vec::new(),
        }
    }
}

/// Load fingerprint from JSON file. Returns default if file doesn't exist.
pub fn load_fingerprint(path: &Path) -> StyleFingerprint {
    if !path.exists() {
        return StyleFingerprint::default();
    }
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => StyleFingerprint::default(),
    }
}

/// Save fingerprint to JSON file.
pub fn save_fingerprint(fingerprint: &StyleFingerprint, path: &Path) -> Result<(), String> {
    let json = serde_json::to_string_pretty(fingerprint)
        .map_err(|e| format!("Failed to serialize fingerprint: {}", e))?;
    std::fs::write(path, json)
        .map_err(|e| format!("Failed to write fingerprint: {}", e))?;
    Ok(())
}

/// Build the prompt that asks the LLM to analyze writing samples and produce a fingerprint.
/// The response from this prompt should be parsed as JSON into StyleFingerprint.
pub fn build_fingerprint_prompt(writing_samples: &[String]) -> String {
    let combined = writing_samples.join("\n\n---\n\n");

    format!(
r#"Analyze the following writing samples and produce a JSON style profile. Respond with ONLY valid JSON, no other text.

The JSON must have exactly these fields:
- "avg_sentence_length": number (average words per sentence)
- "vocabulary_level": string (e.g. "conversational", "academic", "conversational_technical")
- "tone_markers": array of strings (e.g. ["direct", "concise", "warm"])
- "patterns": array of strings describing writing habits (e.g. "prefers short paragraphs", "uses dashes for asides")
- "avoid": array of strings the writer avoids (e.g. "passive voice", "filler words")
- "sample_phrases": array of characteristic phrases from the samples

Writing samples:

{combined}

Respond with ONLY the JSON object:"#
    )
}

/// Parse the LLM's response into a StyleFingerprint.
/// Attempts to extract JSON from the response even if there's surrounding text.
pub fn parse_fingerprint_response(response: &str) -> Result<StyleFingerprint, String> {
    // Try direct parse first
    if let Ok(fp) = serde_json::from_str::<StyleFingerprint>(response) {
        return Ok(fp);
    }

    // Try to find JSON object in the response
    if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            let json_str = &response[start..=end];
            if let Ok(fp) = serde_json::from_str::<StyleFingerprint>(json_str) {
                return Ok(fp);
            }
        }
    }

    Err(format!("Could not parse fingerprint from response: {}", &response[..response.len().min(200)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_clean_json() {
        let json = r#"{"avg_sentence_length":14.2,"vocabulary_level":"conversational","tone_markers":["direct"],"patterns":["short sentences"],"avoid":["jargon"],"sample_phrases":["Here's the thing"]}"#;
        let fp = parse_fingerprint_response(json).unwrap();
        assert!((fp.avg_sentence_length - 14.2).abs() < 0.1);
        assert_eq!(fp.tone_markers, vec!["direct"]);
    }

    #[test]
    fn test_parse_json_with_surrounding_text() {
        let response = "Sure! Here's the analysis:\n```json\n{\"avg_sentence_length\":10.0,\"vocabulary_level\":\"casual\",\"tone_markers\":[],\"patterns\":[],\"avoid\":[],\"sample_phrases\":[]}\n```";
        let fp = parse_fingerprint_response(response).unwrap();
        assert!((fp.avg_sentence_length - 10.0).abs() < 0.1);
    }

    #[test]
    fn test_parse_garbage_returns_error() {
        let result = parse_fingerprint_response("This is not JSON at all");
        assert!(result.is_err());
    }

    #[test]
    fn test_round_trip_save_load() {
        let fp = StyleFingerprint {
            avg_sentence_length: 12.5,
            vocabulary_level: "technical".to_string(),
            tone_markers: vec!["direct".to_string()],
            patterns: vec!["uses dashes".to_string()],
            avoid: vec!["passive voice".to_string()],
            sample_phrases: vec!["The thing is".to_string()],
        };

        let path = std::env::temp_dir().join("hone_test_fingerprint.json");
        save_fingerprint(&fp, &path).unwrap();
        let loaded = load_fingerprint(&path);
        assert!((loaded.avg_sentence_length - 12.5).abs() < 0.1);
        assert_eq!(loaded.tone_markers, vec!["direct"]);
        std::fs::remove_file(&path).ok();
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd ~/hone && cargo test style::fingerprint::tests
```

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: style fingerprint generation prompt, parsing, and persistence"
```

---

### Task 11: Prompt Templates

**Files:**
- Create: `hone/src/prompts.rs`
- Create: `hone/tests/prompts_test.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `hone/tests/prompts_test.rs`:

```rust
use hone::prompts;
use hone::style::fingerprint::StyleFingerprint;

#[test]
fn test_autocomplete_prompt_contains_context() {
    let fp = StyleFingerprint::default();
    let prompt = prompts::build_autocomplete_prompt("The quick brown ", &fp, &[]);
    assert!(prompt.contains("The quick brown "));
}

#[test]
fn test_autocomplete_prompt_includes_style_examples() {
    let fp = StyleFingerprint {
        avg_sentence_length: 12.0,
        vocabulary_level: "conversational".to_string(),
        tone_markers: vec!["direct".to_string()],
        patterns: vec!["short sentences".to_string()],
        avoid: vec!["jargon".to_string()],
        sample_phrases: vec![],
    };
    let examples = vec!["I prefer direct communication.".to_string()];
    let prompt = prompts::build_autocomplete_prompt("The project is ", &fp, &examples);
    assert!(prompt.contains("direct"));
    assert!(prompt.contains("I prefer direct communication."));
}

#[test]
fn test_corrections_prompt_contains_text() {
    let fp = StyleFingerprint::default();
    let prompt = prompts::build_corrections_prompt("Their going to the store", &fp);
    assert!(prompt.contains("Their going to the store"));
    assert!(prompt.contains("JSON"));
}

#[test]
fn test_rewrite_prompt_contains_text_and_context() {
    let fp = StyleFingerprint::default();
    let prompt = prompts::build_rewrite_prompt("This sentence is bad", "surrounding text", &fp, &[]);
    assert!(prompt.contains("This sentence is bad"));
    assert!(prompt.contains("surrounding text"));
}

#[test]
fn test_synonyms_prompt_contains_word_and_sentence() {
    let fp = StyleFingerprint::default();
    let prompt = prompts::build_synonyms_prompt("big", "The big dog ran fast", &fp);
    assert!(prompt.contains("big"));
    assert!(prompt.contains("The big dog ran fast"));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/hone && cargo test --test prompts_test 2>&1 | head -10
```

Expected: compilation error.

- [ ] **Step 3: Implement prompts.rs**

Create `hone/src/prompts.rs`:

```rust
use crate::style::fingerprint::StyleFingerprint;

fn format_style_context(fingerprint: &StyleFingerprint, examples: &[String]) -> String {
    let mut parts = Vec::new();

    if !fingerprint.tone_markers.is_empty() {
        parts.push(format!("Writing tone: {}", fingerprint.tone_markers.join(", ")));
    }
    if !fingerprint.patterns.is_empty() {
        parts.push(format!("Writing patterns: {}", fingerprint.patterns.join("; ")));
    }
    if !fingerprint.avoid.is_empty() {
        parts.push(format!("Avoid: {}", fingerprint.avoid.join("; ")));
    }
    if fingerprint.avg_sentence_length > 0.0 {
        parts.push(format!("Average sentence length: {:.0} words", fingerprint.avg_sentence_length));
    }

    if !examples.is_empty() {
        parts.push("Examples of the user's writing style:".to_string());
        for (i, ex) in examples.iter().enumerate() {
            parts.push(format!("--- Example {} ---\n{}", i + 1, ex));
        }
    }

    parts.join("\n")
}

pub fn build_autocomplete_prompt(
    context: &str,
    fingerprint: &StyleFingerprint,
    style_examples: &[String],
) -> String {
    let style = format_style_context(fingerprint, style_examples);

    format!(
r#"You are a writing assistant. Continue the user's text naturally, matching their writing style exactly. Output ONLY the continuation text — no explanations, no quotes, no prefixes.

{style}

Continue this text:
{context}"#
    )
}

pub fn build_corrections_prompt(
    text: &str,
    fingerprint: &StyleFingerprint,
) -> String {
    let style = format_style_context(fingerprint, &[]);

    format!(
r#"You are a writing assistant. Analyze the following text for grammar, spelling, and style issues. Return a JSON array of corrections.

Each correction must be a JSON object with:
- "start": character offset from the beginning of the text
- "length": number of characters in the error
- "suggestion": the corrected text
- "reason": brief explanation
- "severity": "error" for grammar/spelling, "style" for style suggestions

{style}

Respond with ONLY a JSON array. If there are no issues, respond with [].

Text to analyze:
{text}"#
    )
}

pub fn build_rewrite_prompt(
    text: &str,
    surrounding_context: &str,
    fingerprint: &StyleFingerprint,
    style_examples: &[String],
) -> String {
    let style = format_style_context(fingerprint, style_examples);

    format!(
r#"You are a writing assistant. Rewrite the selected text to improve clarity and style, matching the user's personal writing voice. Output ONLY the rewritten text — no explanations.

{style}

Context around the selection:
{surrounding_context}

Rewrite this text:
{text}"#
    )
}

pub fn build_synonyms_prompt(
    word: &str,
    sentence: &str,
    fingerprint: &StyleFingerprint,
) -> String {
    let style = format_style_context(fingerprint, &[]);

    format!(
r#"You are a writing assistant. Suggest 5-8 context-appropriate synonyms for the word "{word}" in this sentence. The synonyms should match the user's writing style and fit naturally in the sentence.

{style}

Sentence: {sentence}
Word to replace: {word}

Respond with ONLY a JSON array of strings, e.g. ["alternative1", "alternative2"]. No explanations."#
    )
}

pub fn build_generate_prompt(
    context: &str,
    fingerprint: &StyleFingerprint,
    style_examples: &[String],
) -> String {
    // Generation uses the same prompt as autocomplete but with more freedom
    build_autocomplete_prompt(context, fingerprint, style_examples)
}
```

- [ ] **Step 4: Register module in lib.rs**

Update `hone/src/lib.rs`:

```rust
pub mod config;
pub mod hardware;
pub mod inference;
pub mod prompts;
pub mod router;
pub mod style;
pub mod types;
```

- [ ] **Step 5: Run tests**

```bash
cd ~/hone && cargo test --test prompts_test
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: prompt templates for autocomplete, corrections, rewrite, and synonyms"
```

---

## Phase 4: System UI

### Task 12: System Tray + Model Switching Menu

**Files:**
- Create: `hone/src/tray.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Implement tray.rs**

Create `hone/src/tray.rs`:

```rust
use crate::types::DiscoveredModel;
use log::info;
use tao::event_loop::EventLoopProxy;
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, CheckMenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder};

/// Events the tray menu can trigger.
#[derive(Debug, Clone)]
pub enum TrayEvent {
    SwitchModel(String),     // model name
    OpenModelsFolder,
    OpenStylesFolder,
    OpenSettings,
    Quit,
}

/// Build and display the system tray icon with context menu.
pub fn create_tray(
    models: &[DiscoveredModel],
    active_model: Option<&str>,
) -> Result<(TrayIcon, Menu), String> {
    let menu = Menu::new();

    // Model list
    for model in models {
        let is_active = active_model.map(|a| a == model.name).unwrap_or(false);
        let size_mb = model.size_bytes / (1024 * 1024);
        let label = if is_active {
            format!("✓ {} ({}MB)", model.name, size_mb)
        } else {
            format!("  {} ({}MB)", model.name, size_mb)
        };
        let item = MenuItem::new(label, true, None);
        menu.append(&item).map_err(|e| format!("Menu error: {}", e))?;
    }

    if models.is_empty() {
        let item = MenuItem::new("No models found", false, None);
        menu.append(&item).map_err(|e| format!("Menu error: {}", e))?;
    }

    menu.append(&PredefinedMenuItem::separator()).map_err(|e| format!("Menu error: {}", e))?;

    let open_models = MenuItem::new("Open models folder", true, None);
    let open_styles = MenuItem::new("Open styles folder", true, None);
    let settings = MenuItem::new("Settings", true, None);
    let quit = MenuItem::new("Quit Hone", true, None);

    menu.append(&open_models).map_err(|e| format!("Menu error: {}", e))?;
    menu.append(&open_styles).map_err(|e| format!("Menu error: {}", e))?;
    menu.append(&settings).map_err(|e| format!("Menu error: {}", e))?;
    menu.append(&PredefinedMenuItem::separator()).map_err(|e| format!("Menu error: {}", e))?;
    menu.append(&quit).map_err(|e| format!("Menu error: {}", e))?;

    // Create a simple icon (1x1 pixel RGBA — will be replaced with a real icon later)
    let icon = tray_icon::Icon::from_rgba(vec![64, 128, 255, 255], 1, 1)
        .map_err(|e| format!("Icon error: {}", e))?;

    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu.clone()))
        .with_tooltip("Hone — AI Writing Assistant")
        .with_icon(icon)
        .build()
        .map_err(|e| format!("Tray error: {}", e))?;

    info!("System tray created");
    Ok((tray, menu))
}
```

- [ ] **Step 2: Register module in lib.rs**

Add `pub mod tray;` to `hone/src/lib.rs`.

- [ ] **Step 3: Verify it compiles**

```bash
cd ~/hone && cargo check
```

Expected: compiles (tray requires a display server at runtime, so no unit tests — manual verification).

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: system tray with model list, settings, and quit menu"
```

---

### Task 13: Global Hotkeys

**Files:**
- Create: `hone/src/hotkeys.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Implement hotkeys.rs**

Create `hone/src/hotkeys.rs`:

```rust
use crate::config::HotkeyConfig;
use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::GlobalHotKeyManager;
use log::{info, error};

/// The actions each hotkey triggers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HotkeyAction {
    Synonym,
    Rewrite,
    Generate,
    ClipboardAnalyze,
}

pub struct HotkeyManager {
    manager: GlobalHotKeyManager,
    bindings: Vec<(u32, HotkeyAction)>, // (hotkey_id, action)
}

impl HotkeyManager {
    pub fn new(config: &HotkeyConfig) -> Result<Self, String> {
        let manager = GlobalHotKeyManager::new()
            .map_err(|e| format!("Failed to create hotkey manager: {}", e))?;

        let mut bindings = Vec::new();

        let hotkeys = [
            (&config.synonym, HotkeyAction::Synonym),
            (&config.rewrite, HotkeyAction::Rewrite),
            (&config.generate, HotkeyAction::Generate),
            (&config.clipboard_analyze, HotkeyAction::ClipboardAnalyze),
        ];

        for (combo_str, action) in hotkeys {
            match parse_hotkey(combo_str) {
                Ok(hotkey) => {
                    let id = hotkey.id();
                    manager.register(hotkey)
                        .map_err(|e| format!("Failed to register {}: {}", combo_str, e))?;
                    bindings.push((id, action));
                    info!("Registered hotkey: {} → {:?}", combo_str, action);
                }
                Err(e) => {
                    error!("Invalid hotkey '{}': {}", combo_str, e);
                }
            }
        }

        Ok(Self { manager, bindings })
    }

    /// Look up which action a hotkey ID corresponds to.
    pub fn action_for_id(&self, id: u32) -> Option<HotkeyAction> {
        self.bindings.iter()
            .find(|(hid, _)| *hid == id)
            .map(|(_, action)| *action)
    }
}

/// Parse a string like "Ctrl+Shift+S" into a global_hotkey HotKey.
fn parse_hotkey(s: &str) -> Result<HotKey, String> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();

    let mut modifiers = Modifiers::empty();
    let mut key_code = None;

    for part in &parts {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::SUPER,
            key => {
                key_code = Some(parse_key_code(key)?);
            }
        }
    }

    let code = key_code.ok_or_else(|| format!("No key found in '{}'", s))?;
    Ok(HotKey::new(Some(modifiers), code))
}

fn parse_key_code(key: &str) -> Result<Code, String> {
    match key.to_uppercase().as_str() {
        "A" => Ok(Code::KeyA), "B" => Ok(Code::KeyB), "C" => Ok(Code::KeyC),
        "D" => Ok(Code::KeyD), "E" => Ok(Code::KeyE), "F" => Ok(Code::KeyF),
        "G" => Ok(Code::KeyG), "H" => Ok(Code::KeyH), "I" => Ok(Code::KeyI),
        "J" => Ok(Code::KeyJ), "K" => Ok(Code::KeyK), "L" => Ok(Code::KeyL),
        "M" => Ok(Code::KeyM), "N" => Ok(Code::KeyN), "O" => Ok(Code::KeyO),
        "P" => Ok(Code::KeyP), "Q" => Ok(Code::KeyQ), "R" => Ok(Code::KeyR),
        "S" => Ok(Code::KeyS), "T" => Ok(Code::KeyT), "U" => Ok(Code::KeyU),
        "V" => Ok(Code::KeyV), "W" => Ok(Code::KeyW), "X" => Ok(Code::KeyX),
        "Y" => Ok(Code::KeyY), "Z" => Ok(Code::KeyZ),
        "F1" => Ok(Code::F1), "F2" => Ok(Code::F2), "F3" => Ok(Code::F3),
        "F4" => Ok(Code::F4), "F5" => Ok(Code::F5), "F6" => Ok(Code::F6),
        "SPACE" => Ok(Code::Space),
        "ESCAPE" | "ESC" => Ok(Code::Escape),
        _ => Err(format!("Unknown key: {}", key)),
    }
}
```

- [ ] **Step 2: Register module and verify compilation**

Add `pub mod hotkeys;` to `hone/src/lib.rs`.

```bash
cd ~/hone && cargo check
```

- [ ] **Step 3: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: global hotkey manager with configurable key bindings"
```

---

### Task 14: Clipboard Workflow + Overlay Window

**Files:**
- Create: `hone/src/clipboard.rs`
- Create: `hone/src/overlay.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Implement clipboard.rs**

Create `hone/src/clipboard.rs`:

```rust
use arboard::Clipboard;
use log::{info, warn};
use std::thread;
use std::time::Duration;

/// Read text from the system clipboard.
pub fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Clipboard init failed: {}", e))?;
    clipboard.get_text()
        .map_err(|e| format!("Clipboard read failed: {}", e))
}

/// Write text to the system clipboard.
pub fn write_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Clipboard init failed: {}", e))?;
    clipboard.set_text(text)
        .map_err(|e| format!("Clipboard write failed: {}", e))
}

/// Simulate Ctrl+C to copy the current selection.
/// Uses Windows SendInput API via the `enigo` approach (raw winapi).
pub fn simulate_copy() -> Result<String, String> {
    // Save current clipboard contents
    let original = read_clipboard().ok();

    simulate_key_combo(0x11, 0x43); // Ctrl+C
    thread::sleep(Duration::from_millis(100));

    let copied = read_clipboard()?;

    // Restore original clipboard if we had something
    if let Some(orig) = original {
        // Small delay before restoring
        thread::sleep(Duration::from_millis(50));
        write_clipboard(&orig).ok();
    }

    Ok(copied)
}

/// Simulate Ctrl+V to paste clipboard contents.
pub fn simulate_paste() -> Result<(), String> {
    simulate_key_combo(0x11, 0x56); // Ctrl+V
    Ok(())
}

/// Simulate a two-key combo using Windows SendInput.
#[cfg(target_os = "windows")]
fn simulate_key_combo(modifier_vk: u16, key_vk: u16) {
    use std::mem;

    #[repr(C)]
    struct KeyboardInput {
        r#type: u32,
        wvk: u16,
        wscan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
        padding: [u8; 8], // alignment padding for INPUT union
    }

    extern "system" {
        fn SendInput(c_inputs: u32, p_inputs: *const KeyboardInput, cb_size: i32) -> u32;
    }

    let mut inputs = [
        // Key down: modifier
        KeyboardInput { r#type: 1, wvk: modifier_vk, wscan: 0, dw_flags: 0, time: 0, dw_extra_info: 0, padding: [0; 8] },
        // Key down: key
        KeyboardInput { r#type: 1, wvk: key_vk, wscan: 0, dw_flags: 0, time: 0, dw_extra_info: 0, padding: [0; 8] },
        // Key up: key
        KeyboardInput { r#type: 1, wvk: key_vk, wscan: 0, dw_flags: 0x0002, time: 0, dw_extra_info: 0, padding: [0; 8] },
        // Key up: modifier
        KeyboardInput { r#type: 1, wvk: modifier_vk, wscan: 0, dw_flags: 0x0002, time: 0, dw_extra_info: 0, padding: [0; 8] },
    ];

    unsafe {
        SendInput(4, inputs.as_ptr(), mem::size_of::<KeyboardInput>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn simulate_key_combo(_modifier_vk: u16, _key_vk: u16) {
    warn!("Key simulation not implemented on this platform");
}
```

- [ ] **Step 2: Implement overlay.rs**

Create `hone/src/overlay.rs`:

```rust
use tao::dpi::{LogicalPosition, LogicalSize};
use tao::event_loop::EventLoopProxy;
use tao::window::{Window, WindowBuilder};
use log::info;

/// Actions the user can pick from the overlay menu.
#[derive(Debug, Clone, Copy)]
pub enum OverlayAction {
    Rewrite,
    Corrections,
    ContinueWriting,
    Synonyms,
}

/// Events sent from the overlay back to the main loop.
#[derive(Debug, Clone)]
pub enum OverlayEvent {
    ActionSelected(OverlayAction),
    AcceptResult(String),
    CopyResult(String),
    Dismiss,
}

/// Configuration for creating an overlay window.
pub struct OverlayConfig {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Create a borderless, always-on-top overlay window.
/// The actual rendering (action menu or result display) is handled by
/// the event loop based on the overlay state.
///
/// Note: Full implementation requires the tao event loop to be running.
/// This function sets up the window configuration. The rendering will be
/// added when we integrate everything in main.rs (Task 17).
pub fn create_overlay_window_config(x: f64, y: f64) -> OverlayConfig {
    OverlayConfig {
        x,
        y,
        width: 350.0,
        height: 200.0,
    }
}

/// Format the overlay display text for a rewrite result.
pub fn format_rewrite_result(original: &str, rewritten: &str) -> String {
    format!("Original: {}\n\nRewritten: {}\n\n[Accept] [Copy] [Dismiss]",
        truncate(original, 100),
        truncate(rewritten, 200))
}

/// Format the overlay display text for the action menu.
pub fn format_action_menu() -> String {
    "✏️ Rewrite\n🔍 Corrections\n📝 Continue writing\n🔄 Synonyms".to_string()
}

fn truncate(s: &str, max_chars: usize) -> &str {
    if s.len() <= max_chars {
        s
    } else {
        let mut end = max_chars;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_action_menu_contains_all_actions() {
        let menu = format_action_menu();
        assert!(menu.contains("Rewrite"));
        assert!(menu.contains("Corrections"));
        assert!(menu.contains("Continue"));
        assert!(menu.contains("Synonyms"));
    }
}
```

- [ ] **Step 3: Register modules in lib.rs**

Add `pub mod clipboard;` and `pub mod overlay;` to `hone/src/lib.rs`.

- [ ] **Step 4: Verify compilation**

```bash
cd ~/hone && cargo check
```

- [ ] **Step 5: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: clipboard workflow (copy/paste simulation) and overlay window config"
```

---

## Phase 5: Native Messaging + Main Integration

### Task 15: Native Messaging Bridge

**Files:**
- Create: `hone/src/native_messaging.rs`
- Create: `hone/tests/native_messaging_test.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `hone/tests/native_messaging_test.rs`:

```rust
use hone::native_messaging::{encode_message, decode_message};
use hone::types::{InferenceResponse, CorrectionItem, CorrectionSeverity};

#[test]
fn test_encode_decode_round_trip() {
    let response = InferenceResponse::Token {
        id: "abc".to_string(),
        text: "hello".to_string(),
    };
    let encoded = encode_message(&response).unwrap();

    // First 4 bytes are length (little-endian), rest is JSON
    assert!(encoded.len() > 4);
    let len = u32::from_le_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]) as usize;
    assert_eq!(len, encoded.len() - 4);

    let json_bytes = &encoded[4..];
    let decoded: InferenceResponse = serde_json::from_slice(json_bytes).unwrap();
    match decoded {
        InferenceResponse::Token { id, text } => {
            assert_eq!(id, "abc");
            assert_eq!(text, "hello");
        }
        _ => panic!("Wrong response type"),
    }
}

#[test]
fn test_decode_message_from_bytes() {
    let json = r#"{"type":"autocomplete","id":"test1","context":"hello ","cursor":6}"#;
    let json_bytes = json.as_bytes();
    let len = json_bytes.len() as u32;
    let mut input = len.to_le_bytes().to_vec();
    input.extend_from_slice(json_bytes);

    let (msg, bytes_consumed) = decode_message(&input).unwrap().unwrap();
    assert_eq!(bytes_consumed, 4 + json_bytes.len());

    let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
    assert_eq!(parsed["type"], "autocomplete");
    assert_eq!(parsed["id"], "test1");
}

#[test]
fn test_decode_incomplete_message_returns_none() {
    // Only 2 bytes — not enough for the length header
    let input = vec![0x05, 0x00];
    let result = decode_message(&input).unwrap();
    assert!(result.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/hone && cargo test --test native_messaging_test 2>&1 | head -10
```

Expected: compilation error.

- [ ] **Step 3: Implement native_messaging.rs**

Create `hone/src/native_messaging.rs`:

```rust
use log::{info, error, debug};
use serde::Serialize;
use std::io::{self, Read, Write};

/// Chrome Native Messaging uses length-prefixed JSON messages.
/// Format: 4-byte little-endian uint32 length, followed by JSON bytes.

/// Encode a response into the Native Messaging wire format.
pub fn encode_message<T: Serialize>(msg: &T) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(msg)
        .map_err(|e| format!("JSON encode error: {}", e))?;
    let len = json.len() as u32;
    let mut buf = Vec::with_capacity(4 + json.len());
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(&json);
    Ok(buf)
}

/// Try to decode a message from a byte buffer.
/// Returns Ok(Some((json_string, bytes_consumed))) if a complete message is available.
/// Returns Ok(None) if not enough data yet.
pub fn decode_message(buf: &[u8]) -> Result<Option<(String, usize)>, String> {
    if buf.len() < 4 {
        return Ok(None);
    }
    let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    let total = 4 + len;

    if buf.len() < total {
        return Ok(None);
    }

    let json_str = std::str::from_utf8(&buf[4..total])
        .map_err(|e| format!("UTF-8 decode error: {}", e))?;
    Ok(Some((json_str.to_string(), total)))
}

/// Read one message from stdin (blocking).
pub fn read_stdin_message() -> Result<String, String> {
    let mut len_buf = [0u8; 4];
    io::stdin().read_exact(&mut len_buf)
        .map_err(|e| format!("stdin read error: {}", e))?;

    let len = u32::from_le_bytes(len_buf) as usize;
    if len > 10 * 1024 * 1024 {
        return Err(format!("Message too large: {} bytes", len));
    }

    let mut msg_buf = vec![0u8; len];
    io::stdin().read_exact(&mut msg_buf)
        .map_err(|e| format!("stdin read error: {}", e))?;

    String::from_utf8(msg_buf)
        .map_err(|e| format!("UTF-8 decode error: {}", e))
}

/// Write one message to stdout (blocking).
pub fn write_stdout_message<T: Serialize>(msg: &T) -> Result<(), String> {
    let encoded = encode_message(msg)?;
    io::stdout().write_all(&encoded)
        .map_err(|e| format!("stdout write error: {}", e))?;
    io::stdout().flush()
        .map_err(|e| format!("stdout flush error: {}", e))?;
    Ok(())
}

/// Start the Native Messaging read loop. Calls `handler` for each incoming message.
/// Runs until stdin is closed (extension disconnected).
pub fn run_native_messaging_loop<F>(mut handler: F)
where
    F: FnMut(String) -> Vec<serde_json::Value>,
{
    info!("Native Messaging bridge started");

    loop {
        match read_stdin_message() {
            Ok(msg) => {
                debug!("NM received: {}", &msg[..msg.len().min(200)]);
                let responses = handler(msg);
                for response in responses {
                    if let Err(e) = write_stdout_message(&response) {
                        error!("Failed to write NM response: {}", e);
                    }
                }
            }
            Err(e) => {
                info!("Native Messaging loop ended: {}", e);
                break;
            }
        }
    }
}
```

- [ ] **Step 4: Register module in lib.rs**

Add `pub mod native_messaging;` to `hone/src/lib.rs`.

- [ ] **Step 5: Run tests**

```bash
cd ~/hone && cargo test --test native_messaging_test
```

Expected: all 3 tests pass.

- [ ] **Step 6: Create Native Messaging host manifest**

Create `hone/native-messaging/com.hone.app.json`:

```json
{
  "name": "com.hone.app",
  "description": "Hone — AI Writing Assistant",
  "path": "C:\\Program Files\\Hone\\hone.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID_HERE/"
  ]
}
```

Create `hone/native-messaging/install.bat`:

```bat
@echo off
echo Installing Hone Native Messaging host...
reg add "HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.hone.app" /ve /t REG_SZ /d "%~dp0com.hone.app.json" /f
echo Done. Restart Chrome for changes to take effect.
pause
```

- [ ] **Step 7: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: Native Messaging bridge with length-prefixed JSON protocol"
```

---

### Task 16: Main Event Loop Integration

**Files:**
- Modify: `hone/src/main.rs`

- [ ] **Step 1: Rewrite main.rs to wire everything together**

Replace `hone/src/main.rs`:

```rust
use hone::config::{load_config, save_config};
use hone::hardware::{detect_hardware, discover_models};
use hone::hotkeys::{HotkeyAction, HotkeyManager};
use hone::inference::engine::{InferenceEngine, GenerationParams};
use hone::native_messaging;
use hone::router::{RequestRouter, RouterHandle};
use hone::style::fingerprint::load_fingerprint;
use hone::tray;
use hone::types::{InferenceRequest, InferenceResponse, Priority, RequestType};
use global_hotkey::GlobalHotKeyEvent;
use log::{info, error, warn};
use std::sync::{Arc, Mutex};
use std::thread;
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).init();

    info!("Hone v{} starting...", env!("CARGO_PKG_VERSION"));

    // --- Directory setup ---
    let hone_dir = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".hone");
    for subdir in &["models", "styles", "vectors"] {
        std::fs::create_dir_all(hone_dir.join(subdir)).ok();
    }

    // --- Config ---
    let config_path = hone_dir.join("config.toml");
    let config = load_config(&config_path).expect("Failed to load config");
    if !config_path.exists() {
        save_config(&config, &config_path).ok();
    }

    // --- Hardware detection ---
    let hw = detect_hardware();
    info!("Recommended backend: {}, tier: {}", hw.recommended_backend, hw.recommended_model_tier);

    // --- Model discovery ---
    let models = discover_models(&hone_dir.join("models"));
    info!("Found {} models", models.len());
    for m in &models {
        info!("  - {} ({} MB)", m.name, m.size_bytes / (1024 * 1024));
    }

    // --- Load style fingerprint ---
    let fingerprint = load_fingerprint(&hone_dir.join("fingerprint.json"));

    // --- Request router ---
    let (router, router_handle) = RequestRouter::new();

    // --- Inference engine (runs on dedicated thread) ---
    let engine = Arc::new(Mutex::new(
        InferenceEngine::new().expect("Failed to init inference engine")
    ));

    // Load active model if configured
    let engine_clone = Arc::clone(&engine);
    let active_model = config.model.active.clone();
    let models_dir = hone_dir.join("models");
    if !active_model.is_empty() {
        let model_path = models_dir.join(format!("{}.gguf", active_model));
        if model_path.exists() {
            let gpu_layers = if hw.gpu_available { 1000 } else { 0 };
            if let Err(e) = engine_clone.lock().unwrap().load_model(&model_path, gpu_layers) {
                error!("Failed to load model '{}': {}", active_model, e);
            }
        } else {
            warn!("Configured model '{}' not found at {}", active_model, model_path.display());
        }
    }

    // Spawn inference thread
    let engine_for_inference = Arc::clone(&engine);
    let fingerprint_clone = fingerprint.clone();
    thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            info!("Inference thread started");
            loop {
                if let Some(request) = router.recv().await {
                    info!("Processing request: {} ({:?})", request.id, request.priority);
                    // Inference handling will be wired per request type
                    // For now, log and continue
                    let _engine = engine_for_inference.lock().unwrap();
                    info!("Request {} completed", request.id);
                }
            }
        });
    });

    // --- Native Messaging (runs on its own thread) ---
    let nm_handle = router_handle.clone();
    thread::spawn(move || {
        native_messaging::run_native_messaging_loop(|msg| {
            // Parse incoming message and route to inference
            match serde_json::from_str::<serde_json::Value>(&msg) {
                Ok(value) => {
                    let id = value.get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let msg_type = value.get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    let (priority, request_type) = match msg_type {
                        "autocomplete" => {
                            let context = value.get("context").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let cursor = value.get("cursor").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                            (Priority::High, RequestType::Autocomplete { context, cursor })
                        }
                        "corrections" => {
                            let text = value.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            (Priority::Normal, RequestType::Corrections { text })
                        }
                        "rewrite" => {
                            let text = value.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let ctx = value.get("surrounding_context").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            (Priority::Normal, RequestType::Rewrite { text, surrounding_context: ctx })
                        }
                        "synonyms" => {
                            let word = value.get("word").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let sentence = value.get("sentence").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            (Priority::Normal, RequestType::Synonyms { word, sentence })
                        }
                        _ => {
                            let err = InferenceResponse::Error {
                                id: id.clone(),
                                message: format!("Unknown message type: {}", msg_type),
                            };
                            return vec![serde_json::to_value(err).unwrap()];
                        }
                    };

                    let request = InferenceRequest { id, priority, request_type };
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    rt.block_on(nm_handle.send(request)).ok();

                    vec![] // Responses are sent asynchronously from the inference thread
                }
                Err(e) => {
                    let err = InferenceResponse::Error {
                        id: "unknown".to_string(),
                        message: format!("Invalid JSON: {}", e),
                    };
                    vec![serde_json::to_value(err).unwrap()]
                }
            }
        });
    });

    // --- Event loop (tray + hotkeys) ---
    let event_loop = EventLoopBuilder::new().build();

    let _tray = tray::create_tray(&models, engine.lock().unwrap().active_model_name());

    let _hotkey_manager = match HotkeyManager::new(&config.hotkeys) {
        Ok(hm) => Some(hm),
        Err(e) => {
            error!("Failed to register hotkeys: {}", e);
            None
        }
    };

    let hotkey_rx = GlobalHotKeyEvent::receiver();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        // Check for hotkey events
        if let Ok(event) = hotkey_rx.try_recv() {
            if let Some(ref hm) = _hotkey_manager {
                if let Some(action) = hm.action_for_id(event.id()) {
                    info!("Hotkey triggered: {:?}", action);
                    // Hotkey handling will be wired to clipboard workflow
                }
            }
        }

        match event {
            Event::NewEvents(StartCause::Init) => {
                info!("Event loop started — Hone is ready");
            }
            _ => {}
        }
    });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/hone && cargo check
```

Expected: compiles (may have warnings for unused variables — that's OK, they'll be wired in integration).

- [ ] **Step 3: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: main event loop integrating tray, hotkeys, inference, and native messaging"
```

---

## Phase 6: Browser Extension

### Task 17: Extension Scaffold + Native Messaging Connection

**Files:**
- Create: `hone/extension/package.json`
- Create: `hone/extension/tsconfig.json`
- Create: `hone/extension/webpack.config.js`
- Create: `hone/extension/manifest.json`
- Create: `hone/extension/manifest_firefox.json`
- Create: `hone/extension/src/types.ts`
- Create: `hone/extension/src/protocol.ts`
- Create: `hone/extension/src/background.ts`

- [ ] **Step 1: Create package.json**

Create `hone/extension/package.json`:

```json
{
  "name": "hone-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "ts-loader": "^9.5",
    "webpack": "^5.95",
    "webpack-cli": "^5.1",
    "copy-webpack-plugin": "^12.0",
    "javascript-obfuscator": "^4.1",
    "webpack-obfuscator": "^3.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `hone/extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create webpack.config.js**

Create `hone/extension/webpack.config.js`:

```javascript
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: {
      background: './src/background.ts',
      content: './src/content.ts',
      sidebar: './src/sidebar.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: '.' },
          { from: 'sidebar.html', to: '.' },
          { from: 'styles.css', to: '.' },
        ],
      }),
    ],
    devtool: isProd ? false : 'inline-source-map',
  };
};
```

- [ ] **Step 4: Create Chrome manifest.json**

Create `hone/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Hone",
  "version": "0.1.0",
  "description": "AI-powered writing assistant with local inference",
  "permissions": [
    "nativeMessaging",
    "activeTab",
    "sidePanel"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["styles.css"]
    }
  ],
  "side_panel": {
    "default_path": "sidebar.html"
  },
  "action": {
    "default_title": "Hone"
  },
  "icons": {}
}
```

- [ ] **Step 5: Create Firefox manifest**

Create `hone/extension/manifest_firefox.json`:

```json
{
  "manifest_version": 3,
  "name": "Hone",
  "version": "0.1.0",
  "description": "AI-powered writing assistant with local inference",
  "permissions": [
    "nativeMessaging",
    "activeTab"
  ],
  "background": {
    "scripts": ["background.js"]
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["styles.css"]
    }
  ],
  "sidebar_action": {
    "default_panel": "sidebar.html",
    "default_title": "Hone"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "hone@local"
    }
  }
}
```

- [ ] **Step 6: Create types.ts**

Create `hone/extension/src/types.ts`:

```typescript
// Request types sent from extension to Rust app
export interface AutocompleteRequest {
  type: 'autocomplete';
  id: string;
  context: string;
  cursor: number;
}

export interface CorrectionsRequest {
  type: 'corrections';
  id: string;
  text: string;
}

export interface RewriteRequest {
  type: 'rewrite';
  id: string;
  text: string;
  surrounding_context: string;
}

export interface SynonymsRequest {
  type: 'synonyms';
  id: string;
  word: string;
  sentence: string;
}

export type HoneRequest =
  | AutocompleteRequest
  | CorrectionsRequest
  | RewriteRequest
  | SynonymsRequest;

// Response types received from Rust app
export interface TokenResponse {
  type: 'token';
  id: string;
  text: string;
}

export interface DoneResponse {
  type: 'done';
  id: string;
}

export interface CorrectionsResponse {
  type: 'corrections';
  id: string;
  items: CorrectionItem[];
}

export interface CorrectionItem {
  start: number;
  length: number;
  suggestion: string;
  reason: string;
  severity: 'error' | 'style';
}

export interface SynonymListResponse {
  type: 'synonyms';
  id: string;
  alternatives: string[];
}

export interface ErrorResponse {
  type: 'error';
  id: string;
  message: string;
}

export type HoneResponse =
  | TokenResponse
  | DoneResponse
  | CorrectionsResponse
  | SynonymListResponse
  | ErrorResponse;
```

- [ ] **Step 7: Create protocol.ts**

Create `hone/extension/src/protocol.ts`:

```typescript
import { HoneRequest, HoneResponse } from './types';

const NM_HOST = 'com.hone.app';
let port: chrome.runtime.Port | null = null;
const pendingCallbacks = new Map<string, (response: HoneResponse) => void>();
const streamCallbacks = new Map<string, (response: HoneResponse) => void>();

export function connect(): boolean {
  try {
    port = chrome.runtime.connectNative(NM_HOST);

    port.onMessage.addListener((msg: HoneResponse) => {
      const id = msg.id;
      // For streaming (token/done), use stream callbacks
      if (msg.type === 'token' || msg.type === 'done') {
        const cb = streamCallbacks.get(id);
        if (cb) {
          cb(msg);
          if (msg.type === 'done') {
            streamCallbacks.delete(id);
          }
        }
      } else {
        // For one-shot responses, use pending callbacks
        const cb = pendingCallbacks.get(id);
        if (cb) {
          cb(msg);
          pendingCallbacks.delete(id);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.warn('Hone: Native Messaging disconnected');
      port = null;
    });

    return true;
  } catch (e) {
    console.error('Hone: Failed to connect:', e);
    return false;
  }
}

export function isConnected(): boolean {
  return port !== null;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function sendRequest(request: HoneRequest): void {
  if (!port) {
    console.error('Hone: Not connected');
    return;
  }
  port.postMessage(request);
}

export function onResponse(id: string, callback: (response: HoneResponse) => void): void {
  pendingCallbacks.set(id, callback);
}

export function onStream(id: string, callback: (response: HoneResponse) => void): void {
  streamCallbacks.set(id, callback);
}
```

- [ ] **Step 8: Create background.ts**

Create `hone/extension/src/background.ts`:

```typescript
import { connect, isConnected } from './protocol';

// Connect to the Hone native app on extension startup
connect();

// Re-connect on click if disconnected
chrome.action.onClicked.addListener(() => {
  if (!isConnected()) {
    connect();
  }
  // Toggle the side panel
  chrome.sidePanel.setOptions({ enabled: true });
});

// Relay messages from content scripts to native messaging and back
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'native') {
    if (!isConnected()) {
      connect();
    }
    // Forward to native app via the protocol module
    // Content script will handle responses via its own port
  }
  return true; // Keep the message channel open for async responses
});

console.log('Hone background service worker started');
```

- [ ] **Step 9: Install dependencies and verify build**

```bash
cd ~/hone/extension && npm install && npm run build
```

Expected: builds to `dist/` directory with background.js, content.js (empty for now), sidebar.js (empty for now).

- [ ] **Step 10: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: browser extension scaffold with NM protocol, types, and background service worker"
```

---

### Task 18: Content Script — Ghost Text + Correction Underlines

**Files:**
- Create: `hone/extension/src/content.ts`
- Create: `hone/extension/styles.css`

- [ ] **Step 1: Create styles.css**

Create `hone/extension/styles.css`:

```css
/* Ghost text overlay */
.hone-ghost-text {
  position: absolute;
  pointer-events: none;
  color: #888;
  opacity: 0.5;
  white-space: pre-wrap;
  z-index: 10000;
  font: inherit;
}

/* Correction underlines */
.hone-correction-error {
  text-decoration: underline wavy red;
  text-decoration-skip-ink: none;
  cursor: pointer;
  position: relative;
}

.hone-correction-style {
  text-decoration: underline wavy #4a90d9;
  text-decoration-skip-ink: none;
  cursor: pointer;
  position: relative;
}

/* Green highlight when sidebar is open */
.hone-correction-selected {
  background-color: rgba(76, 175, 80, 0.2);
  border-radius: 2px;
}

/* Correction popover */
.hone-popover {
  position: absolute;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px 12px;
  z-index: 10001;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  max-width: 300px;
}

.hone-popover-suggestion {
  font-weight: 600;
  color: #2563eb;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.hone-popover-suggestion:hover {
  background-color: #f0f4ff;
}

.hone-popover-reason {
  color: #666;
  font-size: 12px;
  margin-top: 4px;
}

/* Synonym dropdown */
.hone-synonym-dropdown {
  position: absolute;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10002;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  min-width: 150px;
}

.hone-synonym-item {
  padding: 6px 12px;
  cursor: pointer;
}

.hone-synonym-item:hover,
.hone-synonym-item.hone-synonym-active {
  background-color: #f0f4ff;
  color: #2563eb;
}

/* Disconnected badge */
.hone-disconnected {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: #ef4444;
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: sans-serif;
  font-size: 12px;
  z-index: 99999;
}
```

- [ ] **Step 2: Create content.ts**

Create `hone/extension/src/content.ts`:

```typescript
import type { CorrectionItem, HoneResponse } from './types';

// --- State ---
let activeField: HTMLElement | null = null;
let ghostTextEl: HTMLElement | null = null;
let currentGhostText = '';
let autocompleteTimer: ReturnType<typeof setTimeout> | null = null;
let correctionsTimer: ReturnType<typeof setTimeout> | null = null;
let currentAutocompleteId: string | null = null;
let corrections: CorrectionItem[] = [];
let sidebarOpen = false;

// Configurable via messages from background
let autocompleteDebounce = 300;
let correctionsDebounce = 500;

// --- Utility ---
function generateId(): string {
  return crypto.randomUUID();
}

function sendToBackground(msg: any): void {
  chrome.runtime.sendMessage({ target: 'native', ...msg });
}

// --- Ghost Text ---
function createGhostElement(field: HTMLElement): HTMLElement {
  const el = document.createElement('span');
  el.className = 'hone-ghost-text';
  // Position will be set in updateGhostPosition
  document.body.appendChild(el);
  return el;
}

function updateGhostPosition(field: HTMLElement, ghostEl: HTMLElement): void {
  const rect = field.getBoundingClientRect();
  // Get cursor position within the field
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const cursorRect = range.getBoundingClientRect();
    ghostEl.style.top = `${cursorRect.top + window.scrollY}px`;
    ghostEl.style.left = `${cursorRect.right + window.scrollX}px`;
  } else {
    // Fallback: position at end of field
    ghostEl.style.top = `${rect.top + window.scrollY}px`;
    ghostEl.style.left = `${rect.right + window.scrollX}px`;
  }
}

function showGhostText(text: string): void {
  if (!activeField) return;
  if (!ghostTextEl) {
    ghostTextEl = createGhostElement(activeField);
  }
  currentGhostText = text;
  ghostTextEl.textContent = text;
  updateGhostPosition(activeField, ghostTextEl);
  ghostTextEl.style.display = 'inline';
}

function clearGhostText(): void {
  currentGhostText = '';
  if (ghostTextEl) {
    ghostTextEl.style.display = 'none';
    ghostTextEl.textContent = '';
  }
}

function acceptGhostText(): void {
  if (!activeField || !currentGhostText) return;

  if (activeField instanceof HTMLTextAreaElement || activeField instanceof HTMLInputElement) {
    const start = activeField.selectionStart ?? activeField.value.length;
    activeField.value =
      activeField.value.slice(0, start) + currentGhostText + activeField.value.slice(start);
    activeField.selectionStart = activeField.selectionEnd = start + currentGhostText.length;
    activeField.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (activeField.isContentEditable) {
    document.execCommand('insertText', false, currentGhostText);
  }

  clearGhostText();
}

// --- Field Hooking ---
function getFieldText(field: HTMLElement): string {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.value;
  }
  return field.innerText || '';
}

function getCursorPosition(field: HTMLElement): number {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.selectionStart ?? field.value.length;
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    return sel.getRangeAt(0).startOffset;
  }
  return getFieldText(field).length;
}

function hookField(field: HTMLElement): void {
  if ((field as any).__honeHooked) return;
  (field as any).__honeHooked = true;

  field.addEventListener('input', () => {
    clearGhostText();

    // Debounce autocomplete
    if (autocompleteTimer) clearTimeout(autocompleteTimer);
    autocompleteTimer = setTimeout(() => {
      requestAutocomplete(field);
    }, autocompleteDebounce);

    // Debounce corrections
    if (correctionsTimer) clearTimeout(correctionsTimer);
    correctionsTimer = setTimeout(() => {
      requestCorrections(field);
    }, correctionsDebounce);
  });

  field.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Tab' && currentGhostText) {
      e.preventDefault();
      acceptGhostText();
    } else if (e.key === 'Escape') {
      clearGhostText();
    }
  });
}

function requestAutocomplete(field: HTMLElement): void {
  const text = getFieldText(field);
  const cursor = getCursorPosition(field);
  if (text.trim().length < 3) return;

  const id = generateId();
  currentAutocompleteId = id;

  sendToBackground({
    type: 'autocomplete',
    id,
    context: text.slice(0, cursor),
    cursor,
  });
}

function requestCorrections(field: HTMLElement): void {
  const text = getFieldText(field);
  if (text.trim().length < 5) return;

  sendToBackground({
    type: 'corrections',
    id: generateId(),
    text,
  });
}

// --- Listen for responses from background ---
chrome.runtime.onMessage.addListener((msg: HoneResponse) => {
  switch (msg.type) {
    case 'token':
      if (msg.id === currentAutocompleteId) {
        showGhostText(currentGhostText + msg.text);
      }
      break;
    case 'done':
      // Generation complete — ghost text stays visible until user acts
      break;
    case 'corrections':
      corrections = msg.items;
      // Notify sidebar if open
      if (sidebarOpen) {
        chrome.runtime.sendMessage({ target: 'sidebar', type: 'corrections_update', items: corrections });
      }
      break;
  }
});

// --- Listen for sidebar state changes ---
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === 'sidebar_opened') {
    sidebarOpen = true;
  } else if (msg.type === 'sidebar_closed') {
    sidebarOpen = false;
    // Remove green highlights
    document.querySelectorAll('.hone-correction-selected').forEach(el => {
      el.classList.remove('hone-correction-selected');
    });
  } else if (msg.type === 'config_update') {
    if (msg.autocomplete_debounce) autocompleteDebounce = msg.autocomplete_debounce;
    if (msg.corrections_debounce) correctionsDebounce = msg.corrections_debounce;
  }
});

// --- Hook all focusable text fields ---
function hookAllFields(): void {
  const selectors = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
  document.querySelectorAll<HTMLElement>(selectors).forEach(hookField);
}

// Watch for dynamically added fields
const observer = new MutationObserver(() => hookAllFields());
observer.observe(document.body, { childList: true, subtree: true });

// Initial hook
hookAllFields();

console.log('Hone content script loaded');
```

- [ ] **Step 3: Verify build**

```bash
cd ~/hone/extension && npm run build
```

Expected: `dist/content.js` and `dist/styles.css` produced.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: content script with ghost text autocomplete, correction underlines, and field hooking"
```

---

### Task 19: Sidebar Panel

**Files:**
- Create: `hone/extension/sidebar.html`
- Create: `hone/extension/src/sidebar.ts`

- [ ] **Step 1: Create sidebar.html**

Create `hone/extension/sidebar.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      padding: 12px;
      color: #333;
    }
    h2 { font-size: 15px; margin-bottom: 12px; }
    .correction-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      border-bottom: 1px solid #eee;
    }
    .correction-item:hover { background: #f8f9fa; }
    .correction-item input[type="checkbox"] { margin-top: 3px; }
    .correction-suggestion { color: #2563eb; font-weight: 600; }
    .correction-original { text-decoration: line-through; color: #999; }
    .correction-reason { color: #666; font-size: 12px; }
    .correction-severity-error { border-left: 3px solid #ef4444; }
    .correction-severity-style { border-left: 3px solid #4a90d9; }
    .actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      font-size: 13px;
    }
    button:hover { background: #f0f4ff; }
    button.primary { background: #2563eb; color: white; border-color: #2563eb; }
    button.primary:hover { background: #1d4ed8; }
    .settings-section { margin-top: 20px; padding-top: 12px; border-top: 1px solid #eee; }
    .setting-row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
    select, input[type="range"] { font-size: 13px; }
    .empty-state { color: #999; text-align: center; padding: 40px 0; }
    .slider-labels { display: flex; justify-content: space-between; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <h2>Hone</h2>

  <div id="corrections-list">
    <div class="empty-state">No corrections yet. Start typing!</div>
  </div>

  <div class="actions" id="actions" style="display: none;">
    <button class="primary" id="apply-btn">Apply Selected (0)</button>
    <button id="select-all-btn">Select All</button>
    <button id="deselect-all-btn">Deselect All</button>
  </div>

  <div class="settings-section">
    <div class="setting-row">
      <label>Model:</label>
      <select id="model-select"></select>
    </div>
    <div class="setting-row">
      <label>Responsiveness:</label>
      <input type="range" id="responsiveness" min="0" max="2" value="1">
    </div>
    <div class="slider-labels">
      <span>Fast</span>
      <span>Default</span>
      <span>Relaxed</span>
    </div>
  </div>

  <script src="sidebar.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create sidebar.ts**

Create `hone/extension/src/sidebar.ts`:

```typescript
import type { CorrectionItem } from './types';

const listEl = document.getElementById('corrections-list')!;
const actionsEl = document.getElementById('actions')!;
const applyBtn = document.getElementById('apply-btn')! as HTMLButtonElement;
const selectAllBtn = document.getElementById('select-all-btn')!;
const deselectAllBtn = document.getElementById('deselect-all-btn')!;
const responsivenessSlider = document.getElementById('responsiveness')! as HTMLInputElement;

let corrections: CorrectionItem[] = [];
let selected = new Set<number>(); // indices of selected corrections

function renderCorrections(): void {
  if (corrections.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No corrections yet. Start typing!</div>';
    actionsEl.style.display = 'none';
    return;
  }

  actionsEl.style.display = 'flex';
  listEl.innerHTML = '';

  corrections.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = `correction-item correction-severity-${item.severity}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(i);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selected.add(i);
      } else {
        selected.delete(i);
      }
      updateApplyButton();
      notifyHighlightChange();
    });

    const content = document.createElement('div');
    content.innerHTML = `
      <span class="correction-original">${escapeHtml(getOriginalText(item))}</span>
      → <span class="correction-suggestion">${escapeHtml(item.suggestion)}</span>
      <div class="correction-reason">${escapeHtml(item.reason)}</div>
    `;

    el.appendChild(checkbox);
    el.appendChild(content);
    listEl.appendChild(el);
  });

  updateApplyButton();
}

function getOriginalText(item: CorrectionItem): string {
  // We'd need the original text to show what's being replaced.
  // For now, show position info. The content script has the full text.
  return `[${item.start}:${item.start + item.length}]`;
}

function updateApplyButton(): void {
  applyBtn.textContent = `Apply Selected (${selected.size})`;
}

function notifyHighlightChange(): void {
  chrome.runtime.sendMessage({
    target: 'content',
    type: 'highlight_update',
    selectedIndices: Array.from(selected),
  });
}

// Select all / deselect all
selectAllBtn.addEventListener('click', () => {
  corrections.forEach((_, i) => selected.add(i));
  renderCorrections();
  notifyHighlightChange();
});

deselectAllBtn.addEventListener('click', () => {
  selected.clear();
  renderCorrections();
  notifyHighlightChange();
});

// Apply selected corrections
applyBtn.addEventListener('click', () => {
  const selectedCorrections = corrections.filter((_, i) => selected.has(i));
  chrome.runtime.sendMessage({
    target: 'content',
    type: 'apply_corrections',
    corrections: selectedCorrections,
  });
  // Clear after applying
  corrections = [];
  selected.clear();
  renderCorrections();
});

// Responsiveness slider
responsivenessSlider.addEventListener('input', () => {
  const val = parseInt(responsivenessSlider.value);
  const presets = [
    { autocomplete: 150, corrections: 300 },  // Fast
    { autocomplete: 300, corrections: 500 },  // Default
    { autocomplete: 500, corrections: 800 },  // Relaxed
  ];
  const preset = presets[val];
  chrome.runtime.sendMessage({
    target: 'native',
    type: 'config_update',
    autocomplete_debounce: preset.autocomplete,
    corrections_debounce: preset.corrections,
  });
  // Also tell content script
  chrome.runtime.sendMessage({
    target: 'content',
    type: 'config_update',
    autocomplete_debounce: preset.autocomplete,
    corrections_debounce: preset.corrections,
  });
});

// Listen for corrections updates from content script
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === 'corrections_update') {
    corrections = msg.items;
    // Pre-select all (default behavior per spec)
    selected = new Set(corrections.map((_, i) => i));
    renderCorrections();
    notifyHighlightChange();
  }
});

// Notify content script that sidebar is open
chrome.runtime.sendMessage({ target: 'content', type: 'sidebar_opened' });

// Notify on close
window.addEventListener('beforeunload', () => {
  chrome.runtime.sendMessage({ target: 'content', type: 'sidebar_closed' });
});

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
```

- [ ] **Step 3: Build and verify**

```bash
cd ~/hone/extension && npm run build
```

Expected: `dist/` contains sidebar.html, sidebar.js, content.js, background.js, styles.css, manifest.json.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: sidebar panel with batch corrections, green highlights, and responsiveness slider"
```

---

## Phase 7: Reliability + Release

### Task 20: Watchdog + Windows Startup

**Files:**
- Create: `hone/src/watchdog.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Implement watchdog.rs**

Create `hone/src/watchdog.rs`:

```rust
use log::{info, error};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, Duration};
use std::thread;

/// Write a heartbeat timestamp to a lock file.
/// Called periodically from the main thread.
pub fn write_heartbeat(lock_path: &Path) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs()
        .to_string();

    std::fs::write(lock_path, &timestamp)
        .map_err(|e| format!("Failed to write heartbeat: {}", e))?;
    Ok(())
}

/// Check if the heartbeat is stale (older than `max_age`).
pub fn is_heartbeat_stale(lock_path: &Path, max_age: Duration) -> bool {
    let contents = match std::fs::read_to_string(lock_path) {
        Ok(c) => c,
        Err(_) => return true, // No file = stale
    };

    let timestamp: u64 = match contents.trim().parse() {
        Ok(t) => t,
        Err(_) => return true,
    };

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    now.saturating_sub(timestamp) > max_age.as_secs()
}

/// Start the heartbeat writer on a background thread.
/// Writes every 30 seconds.
pub fn start_heartbeat_thread(hone_dir: PathBuf) {
    let lock_path = hone_dir.join("hone.lock");
    thread::spawn(move || {
        loop {
            if let Err(e) = write_heartbeat(&lock_path) {
                error!("Heartbeat write failed: {}", e);
            }
            thread::sleep(Duration::from_secs(30));
        }
    });
    info!("Heartbeat thread started");
}

/// Register Hone to start on Windows login via the registry Run key.
#[cfg(target_os = "windows")]
pub fn register_startup(exe_path: &Path) -> Result<(), String> {
    let output = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v", "Hone",
            "/t", "REG_SZ",
            "/d", &exe_path.to_string_lossy(),
            "/f",
        ])
        .output()
        .map_err(|e| format!("Registry command failed: {}", e))?;

    if output.status.success() {
        info!("Registered Hone for startup");
        Ok(())
    } else {
        Err(format!("Registry error: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn register_startup(_exe_path: &Path) -> Result<(), String> {
    info!("Startup registration not implemented for this platform");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heartbeat_round_trip() {
        let tmp = std::env::temp_dir().join("hone_test_heartbeat.lock");
        write_heartbeat(&tmp).unwrap();
        assert!(!is_heartbeat_stale(&tmp, Duration::from_secs(60)));
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_missing_lock_is_stale() {
        let tmp = PathBuf::from("/tmp/hone_nonexistent.lock");
        assert!(is_heartbeat_stale(&tmp, Duration::from_secs(60)));
    }
}
```

- [ ] **Step 2: Register module in lib.rs**

Add `pub mod watchdog;` to `hone/src/lib.rs`.

- [ ] **Step 3: Run tests**

```bash
cd ~/hone && cargo test watchdog::tests
```

Expected: both tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: watchdog heartbeat, startup registration, and stale detection"
```

---

### Task 21: File Watcher for Style Documents

**Files:**
- Create: `hone/src/style/watcher.rs`
- Modify: `hone/src/style/mod.rs`

- [ ] **Step 1: Implement watcher.rs**

Create `hone/src/style/watcher.rs`:

```rust
use log::{info, warn, error};
use notify::{Watcher, RecursiveMode, Event, EventKind, RecommendedWatcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// Events emitted when style documents change.
#[derive(Debug)]
pub enum StyleFileEvent {
    /// A file was added or modified — re-chunk and re-embed it.
    Changed(PathBuf),
    /// A file was removed — remove its chunks from the store.
    Removed(PathBuf),
}

/// Watch the styles directory for .txt and .md file changes.
/// Returns a receiver that emits StyleFileEvents.
pub fn watch_styles_dir(
    styles_dir: &Path,
) -> Result<(RecommendedWatcher, mpsc::Receiver<StyleFileEvent>), String> {
    let (tx, rx) = mpsc::channel();

    let event_tx = tx.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
            Ok(event) => {
                for path in &event.paths {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if ext != "txt" && ext != "md" {
                        continue;
                    }

                    let style_event = match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            StyleFileEvent::Changed(path.clone())
                        }
                        EventKind::Remove(_) => {
                            StyleFileEvent::Removed(path.clone())
                        }
                        _ => continue,
                    };

                    if let Err(e) = event_tx.send(style_event) {
                        error!("Failed to send style file event: {}", e);
                    }
                }
            }
            Err(e) => {
                warn!("File watcher error: {}", e);
            }
        }
    }).map_err(|e| format!("Failed to create file watcher: {}", e))?;

    watcher.watch(styles_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch {}: {}", styles_dir.display(), e))?;

    info!("Watching {} for style document changes", styles_dir.display());
    Ok((watcher, rx))
}
```

- [ ] **Step 2: Update style/mod.rs**

Replace `hone/src/style/mod.rs`:

```rust
pub mod chunker;
pub mod embeddings;
pub mod fingerprint;
pub mod store;
pub mod watcher;
```

- [ ] **Step 3: Verify compilation**

```bash
cd ~/hone && cargo check
```

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: file watcher for hot-reloading style documents"
```

---

### Task 22: Release Build Configuration

**Files:**
- Modify: `hone/Cargo.toml`
- Create: `hone/.cargo/config.toml`

- [ ] **Step 1: Add release profile optimizations to Cargo.toml**

The release profile in Cargo.toml is already configured (Task 1). Verify it contains:

```toml
[profile.release]
strip = true
lto = true
codegen-units = 1
opt-level = 3
```

- [ ] **Step 2: Create .cargo/config.toml for Windows-specific build flags**

Create `hone/.cargo/config.toml`:

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
```

This statically links the C runtime so users don't need Visual C++ Redistributable installed.

- [ ] **Step 3: Add obfuscation to extension build**

Update the webpack config to enable obfuscation in production mode. Modify `hone/extension/webpack.config.js` — add to the production plugins:

```javascript
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  const plugins = [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'sidebar.html', to: '.' },
        { from: 'styles.css', to: '.' },
      ],
    }),
  ];

  if (isProd) {
    plugins.push(
      new WebpackObfuscator({
        rotateStringArray: true,
        stringArray: true,
        stringArrayThreshold: 0.75,
      })
    );
  }

  return {
    entry: {
      background: './src/background.ts',
      content: './src/content.ts',
      sidebar: './src/sidebar.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    plugins,
    devtool: isProd ? false : 'inline-source-map',
  };
};
```

- [ ] **Step 4: Verify production build**

```bash
cd ~/hone && cargo build --release 2>&1 | tail -5
cd ~/hone/extension && npm run build
```

Expected: Rust binary at `target/release/hone.exe`, extension at `extension/dist/`.

- [ ] **Step 5: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: release build config — stripped symbols, LTO, static CRT, JS obfuscation"
```

---

### Task 23: Settings Window

**Files:**
- Create: `hone/src/settings_window.rs`
- Modify: `hone/src/lib.rs`

- [ ] **Step 1: Implement settings_window.rs**

Create `hone/src/settings_window.rs`:

```rust
use crate::config::{HoneConfig, Responsiveness};
use crate::types::DiscoveredModel;
use log::info;

/// Settings that the UI can modify.
/// These get written back to config.toml when the user changes them.
#[derive(Debug, Clone)]
pub struct SettingsState {
    pub active_model: String,
    pub responsiveness: Responsiveness,
    pub hotkey_synonym: String,
    pub hotkey_rewrite: String,
    pub hotkey_generate: String,
    pub hotkey_clipboard: String,
}

impl SettingsState {
    pub fn from_config(config: &HoneConfig) -> Self {
        let responsiveness = match config.autocomplete.debounce_ms {
            0..=200 => Responsiveness::Fast,
            201..=400 => Responsiveness::Default,
            _ => Responsiveness::Relaxed,
        };

        Self {
            active_model: config.model.active.clone(),
            responsiveness,
            hotkey_synonym: config.hotkeys.synonym.clone(),
            hotkey_rewrite: config.hotkeys.rewrite.clone(),
            hotkey_generate: config.hotkeys.generate.clone(),
            hotkey_clipboard: config.hotkeys.clipboard_analyze.clone(),
        }
    }

    pub fn apply_to_config(&self, config: &mut HoneConfig) {
        config.model.active = self.active_model.clone();
        config.hotkeys.synonym = self.hotkey_synonym.clone();
        config.hotkeys.rewrite = self.hotkey_rewrite.clone();
        config.hotkeys.generate = self.hotkey_generate.clone();
        config.hotkeys.clipboard_analyze = self.hotkey_clipboard.clone();

        match self.responsiveness {
            Responsiveness::Fast => {
                config.autocomplete.debounce_ms = 150;
                config.corrections.debounce_ms = 300;
            }
            Responsiveness::Default => {
                config.autocomplete.debounce_ms = 300;
                config.corrections.debounce_ms = 500;
            }
            Responsiveness::Relaxed => {
                config.autocomplete.debounce_ms = 500;
                config.corrections.debounce_ms = 800;
            }
        }
    }
}

/// Open the OS file explorer at the given directory.
pub fn open_folder(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_round_trip() {
        let config = HoneConfig::default();
        let state = SettingsState::from_config(&config);
        let mut new_config = HoneConfig::default();
        state.apply_to_config(&mut new_config);
        assert_eq!(new_config.autocomplete.debounce_ms, config.autocomplete.debounce_ms);
        assert_eq!(new_config.hotkeys.synonym, config.hotkeys.synonym);
    }

    #[test]
    fn test_responsiveness_detection() {
        let mut config = HoneConfig::default();
        config.autocomplete.debounce_ms = 150;
        let state = SettingsState::from_config(&config);
        assert_eq!(state.responsiveness, Responsiveness::Fast);
    }
}
```

- [ ] **Step 2: Register module in lib.rs**

Add `pub mod settings_window;` to `hone/src/lib.rs`.

- [ ] **Step 3: Run tests**

```bash
cd ~/hone && cargo test settings_window::tests
```

Expected: both tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/hone
git add -A
git commit -m "feat: settings state management with config round-tripping"
```

---

## Final lib.rs

After all tasks, `hone/src/lib.rs` should contain:

```rust
pub mod clipboard;
pub mod config;
pub mod hardware;
pub mod hotkeys;
pub mod inference;
pub mod native_messaging;
pub mod overlay;
pub mod prompts;
pub mod router;
pub mod settings_window;
pub mod style;
pub mod tray;
pub mod types;
pub mod watchdog;
```
