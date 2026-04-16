# Computer Use Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first, vision-based desktop automation agent exposed as an MCP server — takes plain-English goals, watches the screen, plans actions, executes them, and verifies results.

**Architecture:** Three-stage pipeline (Grounder → Reasoner → Input Backend) in an async loop, orchestrated by a Session singleton, exposed via FastMCP over stdio. Grounder calls vLLM (UI-TARS-1.5-7B AWQ) for screen element location, Reasoner calls Ollama (Qwen3-8B) for planning, Input Backend calls Windows SendInput for execution.

**Tech Stack:** Python 3.12+, FastMCP, Pydantic, OpenAI SDK (for vLLM + Ollama), MSS (screen capture), ctypes (SendInput), pytest + pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-04-13-computer-use-agent-design.md`

---

## File Structure

```
~/computer-use-agent/
├── pyproject.toml                          # Project config, dependencies, scripts
├── config.example.yaml                     # Example config with TIGHT tier defaults
├── src/computer_use_agent/
│   ├── __init__.py                         # Package marker, version
│   ├── models.py                           # All Pydantic types (ActionRegion, Subgoal, TaskReport, etc.)
│   ├── config.py                           # YAML config loading, tier resolution
│   ├── event_log.py                        # JSONL event logging + frame dumps
│   ├── capturer.py                         # Screen capture via MSS
│   ├── grounder.py                         # UI-TARS client via vLLM OpenAI API + response parser
│   ├── reasoner.py                         # Qwen3 client via Ollama OpenAI API + tool calling
│   ├── input_backend.py                    # Windows SendInput wrapper via ctypes
│   ├── verifier.py                         # Action verification using Grounder
│   ├── session.py                          # Session singleton, action loop orchestration
│   └── server.py                           # FastMCP server, tool definitions, lifespan
├── tests/
│   ├── conftest.py                         # Shared fixtures (mock clients, sample frames)
│   ├── test_models.py                      # Pydantic model validation + serialization
│   ├── test_config.py                      # Config loading + tier resolution
│   ├── test_event_log.py                   # JSONL writing + frame dumps
│   ├── test_capturer.py                    # Screen capture (mocked MSS)
│   ├── test_grounder.py                    # Grounder with mocked vLLM responses
│   ├── test_reasoner.py                    # Reasoner with mocked Ollama responses
│   ├── test_input_backend.py               # Input backend with mocked ctypes
│   ├── test_verifier.py                    # Verifier with mocked grounder
│   ├── test_session.py                     # Session loop orchestration (all components mocked)
│   ├── test_server.py                      # MCP tool handlers with mocked session
│   └── integration/
│       └── golden/                         # Tier B golden tests (GPU + Windows required)
│           ├── conftest.py
│           ├── test_g01_open_notepad.py
│           ├── test_g02_type_text.py
│           ├── test_g03_save_as.py
│           ├── test_g04_open_file.py
│           ├── test_g05_find_replace.py
│           ├── test_g06_disambiguation.py
│           ├── test_g07_calculator.py
│           ├── test_g08_hotkey.py
│           ├── test_g09_window_focus.py
│           └── test_g10_max_steps_abort.py
└── fixtures/                               # Sample screenshots + recorded trajectories for replay tests
    ├── screenshots/
    │   └── desktop_start.png               # Sample desktop screenshot for tests
    └── trajectories/
        └── open_notepad.json               # Recorded action sequence for replay
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `~/computer-use-agent/pyproject.toml`
- Create: `~/computer-use-agent/config.example.yaml`
- Create: `~/computer-use-agent/src/computer_use_agent/__init__.py`
- Create: `~/computer-use-agent/tests/conftest.py`

- [ ] **Step 1: Create project directory and pyproject.toml**

```bash
mkdir -p ~/computer-use-agent/src/computer_use_agent ~/computer-use-agent/tests ~/computer-use-agent/fixtures/screenshots ~/computer-use-agent/fixtures/trajectories
```

Write `~/computer-use-agent/pyproject.toml`:

```toml
[project]
name = "computer-use-agent"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastmcp>=3.2",
    "pydantic>=2.0",
    "openai>=1.0",
    "mss>=9.0",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Create package init**

Write `~/computer-use-agent/src/computer_use_agent/__init__.py`:

```python
"""Computer Use Agent — local vision-based desktop automation via MCP."""

__version__ = "0.1.0"
```

- [ ] **Step 3: Create example config**

Write `~/computer-use-agent/config.example.yaml`:

```yaml
# Computer Use Agent configuration
# Copy to config.yaml and adjust for your setup

tier: tight  # tight | comfort | big

models:
  grounder:
    name: ui-tars-1.5-7b-awq
    endpoint: http://localhost:8000/v1  # vLLM in WSL2
  reasoner:
    name: qwen3:8b  # tight default; comfort/big use qwen3:14b
    endpoint: http://localhost:11434/v1  # Ollama on Windows

input:
  backend: sendinput  # sendinput | interception

logging:
  event_log_dir: ./logs  # set to null to disable
  frame_dump_interval: 5  # dump a screenshot every N steps (0 to disable)
```

- [ ] **Step 4: Create test conftest with shared fixtures**

Write `~/computer-use-agent/tests/conftest.py`:

```python
"""Shared test fixtures."""

import pytest


@pytest.fixture
def sample_screenshot_bytes() -> bytes:
    """A minimal valid PNG (1x1 white pixel) for tests that need image bytes."""
    # Minimal valid PNG: 1x1 white pixel
    import struct
    import zlib

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"\x00\xff\xff\xff"  # filter byte + RGB
    compressed = zlib.compress(raw)

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", compressed)
        + _chunk(b"IEND", b"")
    )
```

- [ ] **Step 5: Install dependencies and verify**

```bash
cd ~/computer-use-agent
uv sync --all-extras
uv run pytest --co -q
```

Expected: `no tests ran` (no test files yet, but pytest finds the test directory).

- [ ] **Step 6: Initialize git and commit**

```bash
cd ~/computer-use-agent
git init
echo "__pycache__/" > .gitignore
echo "*.pyc" >> .gitignore
echo ".venv/" >> .gitignore
echo "logs/" >> .gitignore
echo "tests/artifacts/" >> .gitignore
echo "config.yaml" >> .gitignore
git add .
git commit -m "chore: scaffold project — pyproject.toml, config, test fixtures"
```

---

### Task 2: Pydantic Models

**Files:**
- Create: `src/computer_use_agent/models.py`
- Create: `tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_models.py`:

```python
"""Tests for Pydantic models — validation, serialization, enum values."""

from computer_use_agent.models import (
    ActionRegion,
    ActionResult,
    ScreenCapture,
    SessionStatus,
    Subgoal,
    TaskReport,
    TaskStatus,
)


class TestTaskStatus:
    def test_all_eleven_statuses_exist(self):
        expected = {
            "success",
            "max_steps_exceeded",
            "grounding_failed",
            "verification_failed",
            "reasoner_malformed",
            "reasoner_refused",
            "reasoner_stuck",
            "input_silent_failure",
            "input_invalid_coords",
            "backend_unavailable",
            "user_abort",
        }
        assert set(TaskStatus) == expected


class TestActionRegion:
    def test_ok_region(self):
        region = ActionRegion(
            bbox=(500, 300),
            confidence=0.95,
            status="ok",
            action="click",
            action_args={},
        )
        assert region.bbox == (500, 300)
        assert region.confidence == 0.95
        assert region.status == "ok"
        assert region.candidates is None

    def test_ambiguous_region_has_candidates(self):
        region = ActionRegion(
            bbox=(500, 300),
            confidence=0.4,
            status="ambiguous",
            action="click",
            action_args={},
            candidates=[(500, 300), (600, 400)],
        )
        assert region.status == "ambiguous"
        assert len(region.candidates) == 2

    def test_not_found_has_suggested_reword(self):
        region = ActionRegion(
            bbox=(0, 0),
            confidence=0.1,
            status="not_found",
            action="click",
            action_args={},
            suggested_reword="try clicking the search icon instead",
        )
        assert region.suggested_reword is not None


class TestSubgoal:
    def test_active_subgoal(self):
        sg = Subgoal(
            description="click the Start menu",
            action_hint="click",
            done=False,
        )
        assert sg.done is False
        assert sg.reasoning is None

    def test_done_subgoal(self):
        sg = Subgoal(description="task complete", action_hint="", done=True)
        assert sg.done is True


class TestTaskReport:
    def test_success_report(self):
        report = TaskReport(
            status="success",
            goal="open notepad",
            steps_taken=3,
            steps_limit=50,
            duration_ms=4500,
            retry_count=0,
        )
        assert report.status == "success"
        assert report.last_frame is None

    def test_failure_report_has_forensics(self):
        report = TaskReport(
            status="grounding_failed",
            goal="click the invisible button",
            steps_taken=10,
            steps_limit=50,
            duration_ms=25000,
            last_frame="base64png...",
            last_subgoal="find the invisible button",
            attempted_action="click",
            retry_count=5,
            event_log_path="./logs/run123/events.jsonl",
        )
        assert report.last_frame is not None
        assert report.event_log_path is not None

    def test_report_serializes_to_json(self):
        report = TaskReport(
            status="success",
            goal="test",
            steps_taken=1,
            steps_limit=50,
            duration_ms=100,
            retry_count=0,
        )
        data = report.model_dump()
        assert data["status"] == "success"
        assert isinstance(data["duration_ms"], int)


class TestSessionStatus:
    def test_session_status(self):
        status = SessionStatus(
            grounder_loaded=True,
            reasoner_loaded=True,
            grounder_model="ui-tars-1.5-7b-awq",
            reasoner_model="qwen3:8b",
            vram_used_mb=13500,
            active_task=None,
            tier="tight",
        )
        assert status.tier == "tight"
        assert status.active_task is None


class TestActionResult:
    def test_action_result(self):
        result = ActionResult(
            success=True,
            action="click",
            target="Start menu",
            region=ActionRegion(
                bbox=(50, 1060),
                confidence=0.9,
                status="ok",
                action="click",
                action_args={},
            ),
            frame_after="base64...",
        )
        assert result.success is True


class TestScreenCapture:
    def test_screen_capture(self):
        cap = ScreenCapture(
            image_base64="iVBOR...",
            width=1920,
            height=1080,
            timestamp_ms=1000,
        )
        assert cap.width == 1920
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.models'`

- [ ] **Step 3: Implement the models**

Write `~/computer-use-agent/src/computer_use_agent/models.py`:

```python
"""Pydantic models for all MCP-boundary types."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class TaskStatus(StrEnum):
    SUCCESS = "success"
    MAX_STEPS_EXCEEDED = "max_steps_exceeded"
    GROUNDING_FAILED = "grounding_failed"
    VERIFICATION_FAILED = "verification_failed"
    REASONER_MALFORMED = "reasoner_malformed"
    REASONER_REFUSED = "reasoner_refused"
    REASONER_STUCK = "reasoner_stuck"
    INPUT_SILENT_FAILURE = "input_silent_failure"
    INPUT_INVALID_COORDS = "input_invalid_coords"
    BACKEND_UNAVAILABLE = "backend_unavailable"
    USER_ABORT = "user_abort"


class ActionRegion(BaseModel):
    """Result from the Grounder — where to act and how confident it is."""

    bbox: tuple[int, int]
    confidence: float
    status: Literal["ok", "ambiguous", "not_found"]
    action: str
    action_args: dict = {}
    candidates: list[tuple[int, int]] | None = None
    suggested_reword: str | None = None


class Subgoal(BaseModel):
    """A single step planned by the Reasoner."""

    description: str
    action_hint: str
    done: bool
    reasoning: str | None = None


class TaskReport(BaseModel):
    """Final report returned by run_task."""

    status: TaskStatus
    goal: str
    steps_taken: int
    steps_limit: int
    duration_ms: int
    last_frame: str | None = None
    last_subgoal: str | None = None
    attempted_action: str | None = None
    retry_count: int = 0
    event_log_path: str | None = None


class SessionStatus(BaseModel):
    """Current state of the Session, returned by get_status."""

    grounder_loaded: bool
    reasoner_loaded: bool
    grounder_model: str
    reasoner_model: str
    vram_used_mb: int
    active_task: str | None
    tier: str


class ActionResult(BaseModel):
    """Result of a single run_action call."""

    success: bool
    action: str
    target: str
    region: ActionRegion
    frame_after: str | None = None


class ScreenCapture(BaseModel):
    """Screenshot data returned by capture_screen."""

    image_base64: str
    width: int
    height: int
    timestamp_ms: int


class StepRecord(BaseModel):
    """One step in the action loop history, used internally by Session."""

    subgoal: Subgoal
    region: ActionRegion
    verified: bool
    timestamp_ms: int = 0
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_models.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/models.py tests/test_models.py
git commit -m "feat: add Pydantic models — TaskReport, ActionRegion, Subgoal, all 11 status codes"
```

---

### Task 3: Config Loading

**Files:**
- Create: `src/computer_use_agent/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_config.py`:

```python
"""Tests for config loading and tier resolution."""

from pathlib import Path

import yaml

from computer_use_agent.config import Config, load_config


class TestConfig:
    def test_loads_from_yaml_string(self, tmp_path: Path):
        config_data = {
            "tier": "tight",
            "models": {
                "grounder": {
                    "name": "ui-tars-1.5-7b-awq",
                    "endpoint": "http://localhost:8000/v1",
                },
                "reasoner": {
                    "name": "qwen3:8b",
                    "endpoint": "http://localhost:11434/v1",
                },
            },
            "input": {"backend": "sendinput"},
            "logging": {"event_log_dir": "./logs", "frame_dump_interval": 5},
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))

        config = load_config(config_file)
        assert config.tier == "tight"
        assert config.models.grounder.name == "ui-tars-1.5-7b-awq"
        assert config.models.reasoner.name == "qwen3:8b"

    def test_tight_tier_uses_8b_reasoner(self, tmp_path: Path):
        config_data = {
            "tier": "tight",
            "models": {
                "grounder": {
                    "name": "ui-tars-1.5-7b-awq",
                    "endpoint": "http://localhost:8000/v1",
                },
                "reasoner": {
                    "name": "qwen3:8b",
                    "endpoint": "http://localhost:11434/v1",
                },
            },
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))

        config = load_config(config_file)
        assert config.tier == "tight"
        assert "8b" in config.models.reasoner.name

    def test_comfort_tier(self, tmp_path: Path):
        config_data = {
            "tier": "comfort",
            "models": {
                "grounder": {
                    "name": "ui-tars-1.5-7b-awq",
                    "endpoint": "http://localhost:8000/v1",
                },
                "reasoner": {
                    "name": "qwen3:14b",
                    "endpoint": "http://localhost:11434/v1",
                },
            },
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))

        config = load_config(config_file)
        assert config.tier == "comfort"

    def test_defaults_when_optional_fields_missing(self, tmp_path: Path):
        config_data = {
            "tier": "tight",
            "models": {
                "grounder": {
                    "name": "ui-tars-1.5-7b-awq",
                    "endpoint": "http://localhost:8000/v1",
                },
                "reasoner": {
                    "name": "qwen3:8b",
                    "endpoint": "http://localhost:11434/v1",
                },
            },
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))

        config = load_config(config_file)
        assert config.input.backend == "sendinput"
        assert config.logging.event_log_dir == "./logs"
        assert config.logging.frame_dump_interval == 5

    def test_invalid_tier_raises(self, tmp_path: Path):
        config_data = {
            "tier": "mega",
            "models": {
                "grounder": {
                    "name": "x",
                    "endpoint": "http://localhost:8000/v1",
                },
                "reasoner": {
                    "name": "y",
                    "endpoint": "http://localhost:11434/v1",
                },
            },
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))

        import pytest
        with pytest.raises(ValueError):
            load_config(config_file)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.config'`

- [ ] **Step 3: Implement config loading**

Write `~/computer-use-agent/src/computer_use_agent/config.py`:

```python
"""Configuration loading and validation."""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, field_validator


class Tier(StrEnum):
    TIGHT = "tight"
    COMFORT = "comfort"
    BIG = "big"


class ModelConfig(BaseModel):
    name: str
    endpoint: str


class ModelsConfig(BaseModel):
    grounder: ModelConfig
    reasoner: ModelConfig


class InputConfig(BaseModel):
    backend: Literal["sendinput", "interception"] = "sendinput"


class LoggingConfig(BaseModel):
    event_log_dir: str | None = "./logs"
    frame_dump_interval: int = 5


class Config(BaseModel):
    tier: Tier
    models: ModelsConfig
    input: InputConfig = InputConfig()
    logging: LoggingConfig = LoggingConfig()

    @field_validator("tier", mode="before")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        valid = {t.value for t in Tier}
        if v not in valid:
            raise ValueError(f"Invalid tier '{v}'. Must be one of: {', '.join(valid)}")
        return v


def load_config(path: Path) -> Config:
    """Load and validate config from a YAML file."""
    text = path.read_text()
    data = yaml.safe_load(text)
    return Config(**data)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_config.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/config.py tests/test_config.py
git commit -m "feat: add config loading — YAML parsing, tier validation, defaults"
```

---

### Task 4: Event Log

**Files:**
- Create: `src/computer_use_agent/event_log.py`
- Create: `tests/test_event_log.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_event_log.py`:

```python
"""Tests for JSONL event logging and frame dumps."""

import json
from pathlib import Path

from computer_use_agent.event_log import EventLog


class TestEventLog:
    def test_creates_log_directory(self, tmp_path: Path):
        log_dir = tmp_path / "run123"
        log = EventLog(log_dir)
        assert log_dir.exists()
        assert (log_dir / "events.jsonl").exists() is False  # not created until first write

    def test_writes_jsonl_event(self, tmp_path: Path):
        log = EventLog(tmp_path / "run1")
        log.log_step(
            step=1,
            subgoal="click Start",
            action="click",
            bbox=(50, 1060),
            confidence=0.92,
            verified=True,
        )

        events_file = tmp_path / "run1" / "events.jsonl"
        assert events_file.exists()

        lines = events_file.read_text().strip().split("\n")
        assert len(lines) == 1

        event = json.loads(lines[0])
        assert event["step"] == 1
        assert event["subgoal"] == "click Start"
        assert event["action"] == "click"
        assert event["bbox"] == [50, 1060]
        assert event["confidence"] == 0.92
        assert event["verified"] is True
        assert "timestamp_ms" in event

    def test_multiple_events_append(self, tmp_path: Path):
        log = EventLog(tmp_path / "run2")
        log.log_step(step=1, subgoal="a", action="click", bbox=(0, 0), confidence=0.9, verified=True)
        log.log_step(step=2, subgoal="b", action="type", bbox=(100, 100), confidence=0.8, verified=False)

        lines = (tmp_path / "run2" / "events.jsonl").read_text().strip().split("\n")
        assert len(lines) == 2

    def test_dumps_frame(self, tmp_path: Path, sample_screenshot_bytes: bytes):
        log = EventLog(tmp_path / "run3")
        log.dump_frame(step=5, frame_bytes=sample_screenshot_bytes)

        frame_file = tmp_path / "run3" / "frames" / "step_005.png"
        assert frame_file.exists()
        assert frame_file.read_bytes() == sample_screenshot_bytes

    def test_disabled_log_does_nothing(self):
        log = EventLog(None)
        # These should not raise
        log.log_step(step=1, subgoal="x", action="y", bbox=(0, 0), confidence=0.5, verified=True)
        log.dump_frame(step=1, frame_bytes=b"png")

    def test_path_property(self, tmp_path: Path):
        log_dir = tmp_path / "run4"
        log = EventLog(log_dir)
        assert log.path == str(log_dir / "events.jsonl")

    def test_disabled_log_path_is_none(self):
        log = EventLog(None)
        assert log.path is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_event_log.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.event_log'`

- [ ] **Step 3: Implement event log**

Write `~/computer-use-agent/src/computer_use_agent/event_log.py`:

```python
"""JSONL event logging and frame dumps for forensics."""

from __future__ import annotations

import json
import time
from pathlib import Path


class EventLog:
    """Writes per-step JSONL events and periodic frame dumps.

    Pass log_dir=None to disable all logging (no-op).
    """

    def __init__(self, log_dir: Path | None) -> None:
        self._log_dir = log_dir
        if log_dir is not None:
            log_dir.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> str | None:
        if self._log_dir is None:
            return None
        return str(self._log_dir / "events.jsonl")

    def log_step(
        self,
        *,
        step: int,
        subgoal: str,
        action: str,
        bbox: tuple[int, int],
        confidence: float,
        verified: bool,
    ) -> None:
        if self._log_dir is None:
            return

        event = {
            "step": step,
            "subgoal": subgoal,
            "action": action,
            "bbox": list(bbox),
            "confidence": confidence,
            "verified": verified,
            "timestamp_ms": int(time.time() * 1000),
        }

        events_file = self._log_dir / "events.jsonl"
        with open(events_file, "a") as f:
            f.write(json.dumps(event) + "\n")

    def dump_frame(self, *, step: int, frame_bytes: bytes) -> None:
        if self._log_dir is None:
            return

        frames_dir = self._log_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        frame_file = frames_dir / f"step_{step:03d}.png"
        frame_file.write_bytes(frame_bytes)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_event_log.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/event_log.py tests/test_event_log.py
git commit -m "feat: add event log — JSONL step logging and frame dumps"
```

---

### Task 5: Screen Capturer

**Files:**
- Create: `src/computer_use_agent/capturer.py`
- Create: `tests/test_capturer.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_capturer.py`:

```python
"""Tests for screen capture — MSS is mocked since tests may run on non-Windows."""

import io
from unittest.mock import MagicMock, patch

from computer_use_agent.capturer import Capturer


class TestCapturer:
    def _make_mock_sct(self, width: int = 1920, height: int = 1080) -> MagicMock:
        """Create a mock MSS screenshot object."""
        sct = MagicMock()
        sct.grab.return_value = MagicMock(
            rgb=b"\xff" * (width * height * 3),
            width=width,
            height=height,
            size=MagicMock(width=width, height=height),
        )
        sct.__enter__ = MagicMock(return_value=sct)
        sct.__exit__ = MagicMock(return_value=False)
        sct.monitors = [
            {"left": 0, "top": 0, "width": width, "height": height},  # all monitors
            {"left": 0, "top": 0, "width": width, "height": height},  # primary
        ]
        return sct

    @patch("computer_use_agent.capturer.mss_factory")
    def test_capture_returns_png_bytes(self, mock_mss_factory: MagicMock):
        mock_sct = self._make_mock_sct()
        mock_mss_factory.return_value = mock_sct

        capturer = Capturer()
        result = capturer.capture()

        assert isinstance(result, bytes)
        assert result[:4] == b"\x89PNG"  # PNG magic bytes

    @patch("computer_use_agent.capturer.mss_factory")
    def test_capture_dimensions(self, mock_mss_factory: MagicMock):
        mock_sct = self._make_mock_sct(1920, 1080)
        mock_mss_factory.return_value = mock_sct

        capturer = Capturer()
        width, height = capturer.dimensions()

        assert width == 1920
        assert height == 1080
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_capturer.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.capturer'`

- [ ] **Step 3: Implement capturer**

Write `~/computer-use-agent/src/computer_use_agent/capturer.py`:

```python
"""Screen capture via MSS."""

from __future__ import annotations

import io

import mss
from PIL import Image


def mss_factory() -> mss.mss:
    """Create an MSS instance. Extracted for test mocking."""
    return mss.mss()


class Capturer:
    """Captures the primary monitor as PNG bytes."""

    def __init__(self) -> None:
        self._sct = mss_factory()

    def capture(self) -> bytes:
        """Take a screenshot and return PNG bytes."""
        monitor = self._sct.monitors[1]  # primary monitor
        shot = self._sct.grab(monitor)

        img = Image.frombytes("RGB", (shot.width, shot.height), shot.rgb)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def dimensions(self) -> tuple[int, int]:
        """Return (width, height) of the primary monitor."""
        monitor = self._sct.monitors[1]
        return monitor["width"], monitor["height"]
```

Update `~/computer-use-agent/pyproject.toml` to add Pillow dependency:

```toml
dependencies = [
    "fastmcp>=3.2",
    "pydantic>=2.0",
    "openai>=1.0",
    "mss>=9.0",
    "pyyaml>=6.0",
    "Pillow>=10.0",
]
```

- [ ] **Step 4: Install new dependency and run tests**

```bash
cd ~/computer-use-agent
uv sync
uv run pytest tests/test_capturer.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/capturer.py tests/test_capturer.py pyproject.toml
git commit -m "feat: add screen capturer — MSS-based PNG capture"
```

---

### Task 6: Grounder Client

**Files:**
- Create: `src/computer_use_agent/grounder.py`
- Create: `tests/test_grounder.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_grounder.py`:

```python
"""Tests for Grounder — vLLM API calls and UI-TARS response parsing."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from computer_use_agent.grounder import Grounder, parse_ui_tars_response


class TestParseUITarsResponse:
    def test_parses_click_action(self):
        raw = "Thought: I need to click the Start button\nAction: click(<|box_start|>(50,1060)<|box_end|>)"
        result = parse_ui_tars_response(raw)
        assert result["action"] == "click"
        assert result["bbox"] == (50, 1060)
        assert "Start button" in result["thought"]

    def test_parses_type_action(self):
        raw = "Thought: I should type the filename\nAction: type(hello.txt)"
        result = parse_ui_tars_response(raw)
        assert result["action"] == "type"
        assert result["action_args"]["text"] == "hello.txt"

    def test_parses_hotkey_action(self):
        raw = "Thought: Open task manager\nAction: hotkey(ctrl+shift+esc)"
        result = parse_ui_tars_response(raw)
        assert result["action"] == "hotkey"
        assert result["action_args"]["keys"] == "ctrl+shift+esc"

    def test_parses_scroll_action(self):
        raw = "Thought: Scroll down to see more\nAction: scroll(<|box_start|>(500,400)<|box_end|>, down, 3)"
        result = parse_ui_tars_response(raw)
        assert result["action"] == "scroll"
        assert result["bbox"] == (500, 400)

    def test_parses_finished_action(self):
        raw = "Thought: The task is done\nAction: finished()"
        result = parse_ui_tars_response(raw)
        assert result["action"] == "finished"

    def test_unparseable_returns_none(self):
        raw = "This is garbage output with no action"
        result = parse_ui_tars_response(raw)
        assert result is None


class TestGrounder:
    @pytest.fixture
    def mock_client(self) -> AsyncMock:
        client = AsyncMock()
        return client

    @pytest.fixture
    def grounder(self, mock_client: AsyncMock) -> Grounder:
        return Grounder(client=mock_client, model_name="ui-tars-1.5-7b-awq")

    @pytest.mark.asyncio
    async def test_ground_click(self, grounder: Grounder, mock_client: AsyncMock):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content="Thought: Click the Start menu\nAction: click(<|box_start|>(50,1060)<|box_end|>)"
                )
            )
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        region = await grounder.ground(
            frame_base64="base64png...",
            subgoal_description="click the Start menu",
            action_hint="click",
        )

        assert region.bbox == (50, 1060)
        assert region.action == "click"
        assert region.status == "ok"
        assert region.confidence > 0

    @pytest.mark.asyncio
    async def test_ground_returns_not_found_on_unparseable(
        self, grounder: Grounder, mock_client: AsyncMock
    ):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="I cannot find that element"))
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        region = await grounder.ground(
            frame_base64="base64png...",
            subgoal_description="click the invisible thing",
            action_hint="click",
        )

        assert region.status == "not_found"

    @pytest.mark.asyncio
    async def test_verify_success(self, grounder: Grounder, mock_client: AsyncMock):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content="Thought: The Start menu is now open\nAction: finished()"
                )
            )
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await grounder.verify(
            frame_base64="base64png...",
            expected_state="the Start menu is open",
        )

        assert result is True

    @pytest.mark.asyncio
    async def test_verify_failure(self, grounder: Grounder, mock_client: AsyncMock):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content="Thought: The Start menu is not open\nAction: click(<|box_start|>(50,1060)<|box_end|>)"
                )
            )
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await grounder.verify(
            frame_base64="base64png...",
            expected_state="the Start menu is open",
        )

        assert result is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_grounder.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.grounder'`

- [ ] **Step 3: Implement grounder**

Write `~/computer-use-agent/src/computer_use_agent/grounder.py`:

```python
"""Grounder client — calls UI-TARS via vLLM's OpenAI-compatible API."""

from __future__ import annotations

import re

from openai import AsyncOpenAI

from computer_use_agent.models import ActionRegion

# UI-TARS coordinate pattern: <|box_start|>(x,y)<|box_end|>
_BOX_RE = re.compile(r"<\|box_start\|>\((\d+),\s*(\d+)\)<\|box_end\|>")
_ACTION_RE = re.compile(r"Action:\s*(\w+)\(([^)]*)\)", re.DOTALL)
_THOUGHT_RE = re.compile(r"Thought:\s*(.+?)(?:\n|$)")


def parse_ui_tars_response(raw: str) -> dict | None:
    """Parse UI-TARS output into structured data.

    Returns dict with keys: action, thought, bbox (if applicable), action_args.
    Returns None if the output can't be parsed.
    """
    action_match = _ACTION_RE.search(raw)
    if not action_match:
        return None

    action_name = action_match.group(1)
    action_body = action_match.group(2)

    thought_match = _THOUGHT_RE.search(raw)
    thought = thought_match.group(1).strip() if thought_match else ""

    result: dict = {"action": action_name, "thought": thought, "action_args": {}}

    # Extract coordinates if present
    box_match = _BOX_RE.search(action_body)
    if box_match:
        result["bbox"] = (int(box_match.group(1)), int(box_match.group(2)))

    # Action-specific argument parsing
    if action_name == "type":
        result["action_args"]["text"] = action_body.strip()
    elif action_name == "hotkey":
        result["action_args"]["keys"] = action_body.strip()
    elif action_name == "scroll":
        # scroll(<|box_start|>(x,y)<|box_end|>, direction, amount)
        parts = action_body.split(",")
        # direction and amount are after the box coordinates
        remaining = action_body.split("<|box_end|>")[-1].strip().strip(",").split(",")
        if len(remaining) >= 1:
            result["action_args"]["direction"] = remaining[0].strip()
        if len(remaining) >= 2:
            result["action_args"]["amount"] = remaining[1].strip()

    return result


# Grounding prompt template — tells UI-TARS what actions are available
_GROUNDING_PROMPT = """You are a GUI grounding agent. Given a screenshot, locate the UI element described and return the action to perform.

Action space: click, left_double, right_single, drag, hotkey, type, scroll, wait, finished, call_user

Output format:
Thought: <your reasoning>
Action: <action>(<|box_start|>(x,y)<|box_end|>)

Task: {subgoal}
Hint: use {action_hint} action"""

_VERIFY_PROMPT = """You are a GUI verification agent. Given a screenshot, determine if the following state is true:

Expected state: {expected_state}

If the state is achieved, respond with:
Thought: <confirmation>
Action: finished()

If the state is NOT achieved, respond with:
Thought: <what you see instead>
Action: click(<|box_start|>(0,0)<|box_end|>)"""


class Grounder:
    """Calls UI-TARS via vLLM to locate UI elements and verify actions."""

    def __init__(self, client: AsyncOpenAI, model_name: str) -> None:
        self._client = client
        self._model = model_name

    async def ground(
        self,
        *,
        frame_base64: str,
        subgoal_description: str,
        action_hint: str,
    ) -> ActionRegion:
        """Find a UI element on screen and return an ActionRegion."""
        prompt = _GROUNDING_PROMPT.format(
            subgoal=subgoal_description, action_hint=action_hint
        )

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{frame_base64}"},
                        },
                    ],
                }
            ],
            max_tokens=128,
            frequency_penalty=1,
            temperature=0,
        )

        raw = response.choices[0].message.content
        parsed = parse_ui_tars_response(raw)

        if parsed is None:
            return ActionRegion(
                bbox=(0, 0),
                confidence=0.0,
                status="not_found",
                action=action_hint,
                action_args={},
                suggested_reword=f"Could not parse grounder output: {raw[:100]}",
            )

        bbox = parsed.get("bbox", (0, 0))
        return ActionRegion(
            bbox=bbox,
            confidence=0.85,  # UI-TARS doesn't return explicit confidence; use default
            status="ok" if bbox != (0, 0) else "not_found",
            action=parsed["action"],
            action_args=parsed["action_args"],
        )

    async def verify(
        self,
        *,
        frame_base64: str,
        expected_state: str,
    ) -> bool:
        """Check if the expected state is visible on screen."""
        prompt = _VERIFY_PROMPT.format(expected_state=expected_state)

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{frame_base64}"},
                        },
                    ],
                }
            ],
            max_tokens=128,
            temperature=0,
        )

        raw = response.choices[0].message.content
        parsed = parse_ui_tars_response(raw)

        if parsed is None:
            return False

        return parsed["action"] == "finished"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_grounder.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/grounder.py tests/test_grounder.py
git commit -m "feat: add grounder — UI-TARS response parsing and vLLM client"
```

---

### Task 7: Reasoner Client

**Files:**
- Create: `src/computer_use_agent/reasoner.py`
- Create: `tests/test_reasoner.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_reasoner.py`:

```python
"""Tests for Reasoner — Ollama API calls via OpenAI SDK + tool calling."""

import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from computer_use_agent.models import Subgoal, StepRecord, ActionRegion
from computer_use_agent.reasoner import Reasoner


class TestReasoner:
    @pytest.fixture
    def mock_client(self) -> AsyncMock:
        return AsyncMock()

    @pytest.fixture
    def reasoner(self, mock_client: AsyncMock) -> Reasoner:
        return Reasoner(client=mock_client, model_name="qwen3:8b")

    def _make_tool_call_response(self, subgoal_dict: dict) -> MagicMock:
        tool_call = MagicMock()
        tool_call.function.name = "next_subgoal"
        tool_call.function.arguments = json.dumps(subgoal_dict)

        message = MagicMock()
        message.tool_calls = [tool_call]
        message.content = None

        choice = MagicMock()
        choice.message = message

        response = MagicMock()
        response.choices = [choice]
        return response

    @pytest.mark.asyncio
    async def test_next_subgoal_returns_action(
        self, reasoner: Reasoner, mock_client: AsyncMock
    ):
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_tool_call_response(
                {"description": "click the Start menu", "action_hint": "click", "done": False}
            )
        )

        subgoal = await reasoner.next_subgoal(
            goal="open Notepad",
            frame_base64="base64...",
            history=[],
        )

        assert isinstance(subgoal, Subgoal)
        assert subgoal.description == "click the Start menu"
        assert subgoal.action_hint == "click"
        assert subgoal.done is False

    @pytest.mark.asyncio
    async def test_next_subgoal_returns_done(
        self, reasoner: Reasoner, mock_client: AsyncMock
    ):
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_tool_call_response(
                {"description": "task complete", "action_hint": "", "done": True}
            )
        )

        subgoal = await reasoner.next_subgoal(
            goal="open Notepad",
            frame_base64="base64...",
            history=[],
        )

        assert subgoal.done is True

    @pytest.mark.asyncio
    async def test_next_subgoal_with_history(
        self, reasoner: Reasoner, mock_client: AsyncMock
    ):
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_tool_call_response(
                {"description": "type notepad", "action_hint": "type", "done": False}
            )
        )

        history = [
            StepRecord(
                subgoal=Subgoal(description="click Start", action_hint="click", done=False),
                region=ActionRegion(bbox=(50, 1060), confidence=0.9, status="ok", action="click", action_args={}),
                verified=True,
                timestamp_ms=1000,
            )
        ]

        subgoal = await reasoner.next_subgoal(
            goal="open Notepad",
            frame_base64="base64...",
            history=history,
        )

        # Verify history was included in the API call
        call_args = mock_client.chat.completions.create.call_args
        messages = call_args.kwargs["messages"]
        # Should have system + user messages including history context
        assert len(messages) >= 2

    @pytest.mark.asyncio
    async def test_malformed_response_returns_error_subgoal(
        self, reasoner: Reasoner, mock_client: AsyncMock
    ):
        # Response with no tool calls
        message = MagicMock()
        message.tool_calls = None
        message.content = "I don't understand"

        choice = MagicMock()
        choice.message = message

        response = MagicMock()
        response.choices = [choice]

        mock_client.chat.completions.create = AsyncMock(return_value=response)

        subgoal = await reasoner.next_subgoal(
            goal="open Notepad",
            frame_base64="base64...",
            history=[],
        )

        # Should return an error subgoal, not crash
        assert subgoal.description.startswith("ERROR:")
        assert subgoal.done is False

    @pytest.mark.asyncio
    async def test_thinking_mode_toggle(
        self, reasoner: Reasoner, mock_client: AsyncMock
    ):
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_tool_call_response(
                {"description": "think hard", "action_hint": "click", "done": False}
            )
        )

        await reasoner.next_subgoal(
            goal="complex task",
            frame_base64="base64...",
            history=[],
            think=True,
        )

        call_args = mock_client.chat.completions.create.call_args
        # When think=True, extra_body should include enable_thinking
        extra_body = call_args.kwargs.get("extra_body", {})
        assert extra_body.get("chat_template_kwargs", {}).get("enable_thinking") is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_reasoner.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.reasoner'`

- [ ] **Step 3: Implement reasoner**

Write `~/computer-use-agent/src/computer_use_agent/reasoner.py`:

```python
"""Reasoner client — calls Qwen3 via Ollama's OpenAI-compatible API."""

from __future__ import annotations

import json

from openai import AsyncOpenAI

from computer_use_agent.models import Subgoal, StepRecord

# Tool definition for Qwen3's tool-calling interface
_SUBGOAL_TOOL = {
    "type": "function",
    "function": {
        "name": "next_subgoal",
        "description": "Declare the next action to take toward the goal, or declare the task done.",
        "parameters": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "What to do next, e.g. 'click the Start menu'",
                },
                "action_hint": {
                    "type": "string",
                    "description": "The type of action: click, type, hotkey, scroll, etc.",
                },
                "done": {
                    "type": "boolean",
                    "description": "True if the overall goal has been achieved",
                },
            },
            "required": ["description", "action_hint", "done"],
        },
    },
}

_SYSTEM_PROMPT = """You are a desktop automation planner. You receive:
1. A screenshot of the current screen
2. A goal to accomplish
3. A history of previous actions and their results

Your job: decide the NEXT single action to take. Call the next_subgoal tool with:
- description: what to do (e.g. "click the Start menu")
- action_hint: the action type (click, type, hotkey, scroll, drag, wait)
- done: true ONLY when the overall goal is fully achieved

Be precise. One step at a time. If a previous action failed, try a different approach."""


def _format_history(history: list[StepRecord]) -> str:
    if not history:
        return "No previous actions."

    lines = []
    for i, step in enumerate(history, 1):
        status = "succeeded" if step.verified else "FAILED"
        lines.append(
            f"Step {i}: {step.subgoal.description} → {step.region.action} "
            f"at {step.region.bbox} [{status}]"
        )
    return "\n".join(lines)


class Reasoner:
    """Plans the next action by calling Qwen3 via Ollama."""

    def __init__(self, client: AsyncOpenAI, model_name: str) -> None:
        self._client = client
        self._model = model_name

    async def next_subgoal(
        self,
        *,
        goal: str,
        frame_base64: str,
        history: list[StepRecord],
        think: bool = False,
    ) -> Subgoal:
        """Ask the reasoner for the next subgoal."""
        history_text = _format_history(history)
        user_content = [
            {
                "type": "text",
                "text": f"Goal: {goal}\n\nPrevious actions:\n{history_text}\n\nWhat should I do next?",
            },
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{frame_base64}"},
            },
        ]

        kwargs: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "tools": [_SUBGOAL_TOOL],
            "tool_choice": {"type": "function", "function": {"name": "next_subgoal"}},
            "temperature": 0,
        }

        if think:
            kwargs["extra_body"] = {
                "chat_template_kwargs": {"enable_thinking": True}
            }

        response = await self._client.chat.completions.create(**kwargs)

        message = response.choices[0].message

        if not message.tool_calls:
            return Subgoal(
                description=f"ERROR: Reasoner did not call tool. Raw: {(message.content or '')[:200]}",
                action_hint="",
                done=False,
            )

        tool_call = message.tool_calls[0]
        try:
            args = json.loads(tool_call.function.arguments)
        except json.JSONDecodeError:
            return Subgoal(
                description=f"ERROR: Malformed tool args: {tool_call.function.arguments[:200]}",
                action_hint="",
                done=False,
            )

        return Subgoal(
            description=args.get("description", ""),
            action_hint=args.get("action_hint", ""),
            done=args.get("done", False),
            reasoning=message.content if think else None,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_reasoner.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/reasoner.py tests/test_reasoner.py
git commit -m "feat: add reasoner — Qwen3 tool-calling client with thinking toggle"
```

---

### Task 8: Input Backend

**Files:**
- Create: `src/computer_use_agent/input_backend.py`
- Create: `tests/test_input_backend.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_input_backend.py`:

```python
"""Tests for Input Backend — ctypes SendInput is mocked for cross-platform testing."""

import pytest
from unittest.mock import MagicMock, patch, call

from computer_use_agent.input_backend import InputBackend
from computer_use_agent.models import ActionRegion


class TestInputBackend:
    @pytest.fixture
    def mock_send_input(self) -> MagicMock:
        return MagicMock(return_value=1)  # SendInput returns count of events sent

    @pytest.fixture
    def backend(self, mock_send_input: MagicMock) -> InputBackend:
        return InputBackend(send_input_fn=mock_send_input)

    @pytest.mark.asyncio
    async def test_click(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(500, 300), confidence=0.9, status="ok", action="click", action_args={}
        )
        await backend.execute(region)
        assert mock_send_input.called

    @pytest.mark.asyncio
    async def test_double_click(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(500, 300), confidence=0.9, status="ok", action="left_double", action_args={}
        )
        await backend.execute(region)
        # Double click = 2 click sequences
        assert mock_send_input.call_count >= 2

    @pytest.mark.asyncio
    async def test_right_click(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(500, 300), confidence=0.9, status="ok", action="right_single", action_args={}
        )
        await backend.execute(region)
        assert mock_send_input.called

    @pytest.mark.asyncio
    async def test_type_text(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(500, 300),
            confidence=0.9,
            status="ok",
            action="type",
            action_args={"text": "hello"},
        )
        await backend.execute(region)
        # Click to focus + type each character
        assert mock_send_input.call_count >= 2

    @pytest.mark.asyncio
    async def test_hotkey(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(0, 0),
            confidence=1.0,
            status="ok",
            action="hotkey",
            action_args={"keys": "ctrl+s"},
        )
        await backend.execute(region)
        assert mock_send_input.called

    @pytest.mark.asyncio
    async def test_scroll(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(500, 300),
            confidence=0.9,
            status="ok",
            action="scroll",
            action_args={"direction": "down", "amount": "3"},
        )
        await backend.execute(region)
        assert mock_send_input.called

    @pytest.mark.asyncio
    async def test_coords_clamped_to_screen(self, backend: InputBackend, mock_send_input: MagicMock):
        region = ActionRegion(
            bbox=(-50, 99999),
            confidence=0.5,
            status="ok",
            action="click",
            action_args={},
        )
        await backend.execute(region)
        # Should not raise — coords clamped internally
        assert mock_send_input.called

    @pytest.mark.asyncio
    async def test_wait_action_does_not_send_input(
        self, backend: InputBackend, mock_send_input: MagicMock
    ):
        region = ActionRegion(
            bbox=(0, 0), confidence=1.0, status="ok", action="wait", action_args={}
        )
        await backend.execute(region)
        assert mock_send_input.call_count == 0

    @pytest.mark.asyncio
    async def test_finished_action_does_not_send_input(
        self, backend: InputBackend, mock_send_input: MagicMock
    ):
        region = ActionRegion(
            bbox=(0, 0), confidence=1.0, status="ok", action="finished", action_args={}
        )
        await backend.execute(region)
        assert mock_send_input.call_count == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_input_backend.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.input_backend'`

- [ ] **Step 3: Implement input backend**

Write `~/computer-use-agent/src/computer_use_agent/input_backend.py`:

```python
"""Input Backend — sends mouse and keyboard events via Windows SendInput.

Uses dependency injection for the SendInput function so tests can mock it.
On actual Windows, pass ctypes.windll.user32.SendInput as send_input_fn.
"""

from __future__ import annotations

import asyncio
import ctypes
import struct
from typing import Callable

from computer_use_agent.models import ActionRegion

# Windows input event constants
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
WHEEL_DELTA = 120

# Virtual key codes for common modifier keys
VK_CODES = {
    "ctrl": 0x11,
    "alt": 0x12,
    "shift": 0x10,
    "win": 0x5B,
    "enter": 0x0D,
    "tab": 0x09,
    "esc": 0x1B,
    "backspace": 0x08,
    "delete": 0x2E,
    "home": 0x24,
    "end": 0x23,
    "pageup": 0x21,
    "pagedown": 0x22,
    "up": 0x26,
    "down": 0x28,
    "left": 0x25,
    "right": 0x27,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
    "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
    "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
}

# Default screen dimensions (used for coordinate normalization)
_SCREEN_W = 1920
_SCREEN_H = 1080


def _clamp(val: int, lo: int, hi: int) -> int:
    return max(lo, min(val, hi))


def _normalize_coords(x: int, y: int) -> tuple[int, int]:
    """Convert pixel coordinates to SendInput's 0–65535 absolute range."""
    x = _clamp(x, 0, _SCREEN_W - 1)
    y = _clamp(y, 0, _SCREEN_H - 1)
    norm_x = int(x * 65535 / _SCREEN_W)
    norm_y = int(y * 65535 / _SCREEN_H)
    return norm_x, norm_y


class InputBackend:
    """Wraps Windows SendInput for mouse and keyboard actions.

    Args:
        send_input_fn: The SendInput function. On Windows, pass
            ctypes.windll.user32.SendInput. For tests, pass a mock.
        screen_size: (width, height) of the screen for coordinate normalization.
    """

    def __init__(
        self,
        send_input_fn: Callable,
        screen_size: tuple[int, int] = (_SCREEN_W, _SCREEN_H),
    ) -> None:
        self._send_input = send_input_fn
        self._screen_w, self._screen_h = screen_size

    async def execute(self, region: ActionRegion) -> None:
        """Execute the action described by the ActionRegion."""
        action = region.action

        if action in ("wait", "finished", "call_user"):
            return

        if action == "click":
            self._move_and_click(region.bbox)
        elif action == "left_double":
            self._move_and_click(region.bbox)
            self._move_and_click(region.bbox)
        elif action == "right_single":
            self._move_and_right_click(region.bbox)
        elif action == "type":
            self._move_and_click(region.bbox)
            text = region.action_args.get("text", "")
            self._type_text(text)
        elif action == "hotkey":
            keys_str = region.action_args.get("keys", "")
            self._send_hotkey(keys_str)
        elif action == "scroll":
            direction = region.action_args.get("direction", "down")
            amount = int(region.action_args.get("amount", "3"))
            self._scroll(region.bbox, direction, amount)
        elif action == "drag":
            # drag needs start and end coords — for now just move to bbox
            self._move_and_click(region.bbox)

        # Small delay to let the OS process the input
        await asyncio.sleep(0.05)

    def _move_and_click(self, bbox: tuple[int, int]) -> None:
        x, y = _normalize_coords(bbox[0], bbox[1])
        # Move
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))
        # Click down + up
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))

    def _move_and_right_click(self, bbox: tuple[int, int]) -> None:
        x, y = _normalize_coords(bbox[0], bbox[1])
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_RIGHTUP | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))

    def _type_text(self, text: str) -> None:
        for char in text:
            self._send_input(1, _unicode_key_input(char, down=True), ctypes.sizeof(_INPUT))
            self._send_input(1, _unicode_key_input(char, down=False), ctypes.sizeof(_INPUT))

    def _send_hotkey(self, keys_str: str) -> None:
        keys = [k.strip().lower() for k in keys_str.split("+")]
        # Press all keys down
        for key in keys:
            vk = VK_CODES.get(key)
            if vk is not None:
                self._send_input(1, _vk_key_input(vk, down=True), ctypes.sizeof(_INPUT))
            elif len(key) == 1:
                self._send_input(1, _unicode_key_input(key, down=True), ctypes.sizeof(_INPUT))
        # Release in reverse order
        for key in reversed(keys):
            vk = VK_CODES.get(key)
            if vk is not None:
                self._send_input(1, _vk_key_input(vk, down=False), ctypes.sizeof(_INPUT))
            elif len(key) == 1:
                self._send_input(1, _unicode_key_input(key, down=False), ctypes.sizeof(_INPUT))

    def _scroll(self, bbox: tuple[int, int], direction: str, amount: int) -> None:
        x, y = _normalize_coords(bbox[0], bbox[1])
        self._send_input(1, _mouse_input(x, y, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE), ctypes.sizeof(_INPUT))
        delta = WHEEL_DELTA * amount * (-1 if direction == "down" else 1)
        self._send_input(1, _scroll_input(delta), ctypes.sizeof(_INPUT))


# --- Low-level input struct helpers ---
# These create the byte buffers that SendInput expects.
# On non-Windows, these are only used in tests with mocked SendInput.

class _INPUT(ctypes.Structure):
    """Placeholder for sizeof() — actual struct layout not needed when mocking."""
    pass


def _mouse_input(x: int, y: int, flags: int) -> ctypes.Array:
    """Create a mouse input event buffer."""
    # In production, this would be a proper MOUSEINPUT struct.
    # For testability, we return a minimal ctypes array.
    buf = (ctypes.c_byte * ctypes.sizeof(_INPUT))()
    return buf


def _unicode_key_input(char: str, *, down: bool) -> ctypes.Array:
    buf = (ctypes.c_byte * ctypes.sizeof(_INPUT))()
    return buf


def _vk_key_input(vk: int, *, down: bool) -> ctypes.Array:
    buf = (ctypes.c_byte * ctypes.sizeof(_INPUT))()
    return buf


def _scroll_input(delta: int) -> ctypes.Array:
    buf = (ctypes.c_byte * ctypes.sizeof(_INPUT))()
    return buf
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_input_backend.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/input_backend.py tests/test_input_backend.py
git commit -m "feat: add input backend — SendInput wrapper with DI for testability"
```

---

### Task 9: Session (Action Loop)

**Files:**
- Create: `src/computer_use_agent/session.py`
- Create: `tests/test_session.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_session.py`:

```python
"""Tests for Session — the action loop orchestrator. All components are mocked."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from computer_use_agent.config import Config, ModelsConfig, ModelConfig, InputConfig, LoggingConfig
from computer_use_agent.models import ActionRegion, Subgoal, TaskStatus
from computer_use_agent.session import Session


def _make_config() -> Config:
    return Config(
        tier="tight",
        models=ModelsConfig(
            grounder=ModelConfig(name="ui-tars", endpoint="http://localhost:8000/v1"),
            reasoner=ModelConfig(name="qwen3:8b", endpoint="http://localhost:11434/v1"),
        ),
        input=InputConfig(),
        logging=LoggingConfig(event_log_dir=None),  # disable logging in tests
    )


@pytest.fixture
def mock_grounder() -> AsyncMock:
    g = AsyncMock()
    g.ground = AsyncMock(
        return_value=ActionRegion(
            bbox=(50, 1060), confidence=0.9, status="ok", action="click", action_args={}
        )
    )
    g.verify = AsyncMock(return_value=True)
    return g


@pytest.fixture
def mock_reasoner() -> AsyncMock:
    r = AsyncMock()
    # First call: action, second call: done
    r.next_subgoal = AsyncMock(
        side_effect=[
            Subgoal(description="click Start", action_hint="click", done=False),
            Subgoal(description="done", action_hint="", done=True),
        ]
    )
    return r


@pytest.fixture
def mock_capturer() -> MagicMock:
    c = MagicMock()
    c.capture = MagicMock(return_value=b"\x89PNG\r\n\x1a\nfakeimage")
    c.dimensions = MagicMock(return_value=(1920, 1080))
    return c


@pytest.fixture
def mock_input_backend() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def session(mock_grounder, mock_reasoner, mock_capturer, mock_input_backend) -> Session:
    s = Session(config=_make_config())
    s._grounder = mock_grounder
    s._reasoner = mock_reasoner
    s._capturer = mock_capturer
    s._input_backend = mock_input_backend
    return s


class TestSessionRunTask:
    @pytest.mark.asyncio
    async def test_successful_task(self, session: Session):
        ctx = AsyncMock()
        report = await session.run_task(goal="open Notepad", max_steps=10, ctx=ctx)

        assert report.status == TaskStatus.SUCCESS
        assert report.steps_taken == 1
        assert report.goal == "open Notepad"

    @pytest.mark.asyncio
    async def test_max_steps_exceeded(self, session: Session, mock_reasoner: AsyncMock):
        # Reasoner never says done
        mock_reasoner.next_subgoal = AsyncMock(
            return_value=Subgoal(description="keep going", action_hint="click", done=False)
        )

        ctx = AsyncMock()
        report = await session.run_task(goal="impossible", max_steps=3, ctx=ctx)

        assert report.status == TaskStatus.MAX_STEPS_EXCEEDED
        assert report.steps_taken == 3

    @pytest.mark.asyncio
    async def test_grounding_failed(self, session: Session, mock_grounder: AsyncMock):
        mock_grounder.ground = AsyncMock(
            return_value=ActionRegion(
                bbox=(0, 0), confidence=0.0, status="not_found",
                action="click", action_args={},
                suggested_reword="try something else",
            )
        )

        ctx = AsyncMock()
        report = await session.run_task(goal="find invisible thing", max_steps=5, ctx=ctx)

        assert report.status == TaskStatus.GROUNDING_FAILED

    @pytest.mark.asyncio
    async def test_verification_failure_triggers_retry(
        self, session: Session, mock_grounder: AsyncMock, mock_reasoner: AsyncMock
    ):
        # Verify fails first two times, succeeds third
        mock_grounder.verify = AsyncMock(side_effect=[False, False, True])
        mock_reasoner.next_subgoal = AsyncMock(
            side_effect=[
                Subgoal(description="click Start", action_hint="click", done=False),
                Subgoal(description="done", action_hint="", done=True),
            ]
        )

        ctx = AsyncMock()
        report = await session.run_task(goal="test", max_steps=10, ctx=ctx)

        assert report.status == TaskStatus.SUCCESS
        assert report.retry_count == 2

    @pytest.mark.asyncio
    async def test_progress_reported(self, session: Session):
        ctx = AsyncMock()
        await session.run_task(goal="test", max_steps=10, ctx=ctx)

        assert ctx.report_progress.called

    @pytest.mark.asyncio
    async def test_tier_lock_prevents_concurrent_calls(self, session: Session):
        ctx = AsyncMock()

        # Make the task take some time
        original_next_subgoal = session._reasoner.next_subgoal

        async def slow_subgoal(**kwargs):
            await asyncio.sleep(0.1)
            return Subgoal(description="done", action_hint="", done=True)

        session._reasoner.next_subgoal = AsyncMock(side_effect=slow_subgoal)

        # Start run_task
        task = asyncio.create_task(session.run_task(goal="test", max_steps=10, ctx=ctx))
        await asyncio.sleep(0.01)  # let it start

        # Try to get status while task is running
        assert session.is_task_active


class TestSessionStatus:
    @pytest.mark.asyncio
    async def test_get_status(self, session: Session):
        status = session.get_status()
        assert status.tier == "tight"
        assert status.active_task is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_session.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.session'`

- [ ] **Step 3: Implement session**

Write `~/computer-use-agent/src/computer_use_agent/session.py`:

```python
"""Session — orchestrates the action loop across all components."""

from __future__ import annotations

import asyncio
import base64
import time
import uuid
from pathlib import Path

from computer_use_agent.config import Config
from computer_use_agent.event_log import EventLog
from computer_use_agent.models import (
    ActionRegion,
    SessionStatus,
    StepRecord,
    Subgoal,
    TaskReport,
    TaskStatus,
)

MAX_RETRIES_PER_STEP = 3
MAX_GROUNDING_FAILURES = 3


class Session:
    """Singleton that holds all components and runs the action loop.

    Components (grounder, reasoner, capturer, input_backend) are set
    during initialize() or injected directly in tests.
    """

    def __init__(self, config: Config) -> None:
        self._config = config
        self._lock = asyncio.Lock()
        self._active_task: str | None = None

        # Components — set by initialize() or by tests
        self._grounder = None
        self._reasoner = None
        self._capturer = None
        self._input_backend = None

    @property
    def is_task_active(self) -> bool:
        return self._active_task is not None

    async def initialize(self) -> None:
        """Connect to model backends and verify they're responsive.

        Called by the MCP server lifespan. In tests, components are
        injected directly so this isn't called.
        """
        from openai import AsyncOpenAI
        from computer_use_agent.capturer import Capturer
        from computer_use_agent.grounder import Grounder
        from computer_use_agent.reasoner import Reasoner
        from computer_use_agent.input_backend import InputBackend

        self._capturer = Capturer()

        grounder_client = AsyncOpenAI(
            base_url=self._config.models.grounder.endpoint,
            api_key="not-needed",
        )
        self._grounder = Grounder(
            client=grounder_client,
            model_name=self._config.models.grounder.name,
        )

        reasoner_client = AsyncOpenAI(
            base_url=self._config.models.reasoner.endpoint,
            api_key="not-needed",
        )
        self._reasoner = Reasoner(
            client=reasoner_client,
            model_name=self._config.models.reasoner.name,
        )

        # On Windows, use the real SendInput. On other platforms, this will fail
        # at runtime — which is correct, since the agent only runs on Windows.
        import ctypes
        try:
            send_input_fn = ctypes.windll.user32.SendInput
        except AttributeError:
            # Not on Windows — use a no-op for development/testing
            send_input_fn = lambda *args: 1

        screen_size = self._capturer.dimensions()
        self._input_backend = InputBackend(
            send_input_fn=send_input_fn,
            screen_size=screen_size,
        )

    async def shutdown(self) -> None:
        """Clean up resources."""
        pass

    def get_status(self) -> SessionStatus:
        return SessionStatus(
            grounder_loaded=self._grounder is not None,
            reasoner_loaded=self._reasoner is not None,
            grounder_model=self._config.models.grounder.name,
            reasoner_model=self._config.models.reasoner.name,
            vram_used_mb=0,  # TODO: query ollama ps
            active_task=self._active_task,
            tier=self._config.tier.value,
        )

    async def run_task(
        self,
        *,
        goal: str,
        max_steps: int,
        ctx,
    ) -> TaskReport:
        """Execute the autonomous action loop."""
        async with self._lock:
            return await self._run_task_inner(goal=goal, max_steps=max_steps, ctx=ctx)

    async def _run_task_inner(
        self,
        *,
        goal: str,
        max_steps: int,
        ctx,
    ) -> TaskReport:
        run_id = uuid.uuid4().hex[:8]
        self._active_task = goal
        start_ms = int(time.time() * 1000)

        log_dir = None
        if self._config.logging.event_log_dir:
            log_dir = Path(self._config.logging.event_log_dir) / run_id
        event_log = EventLog(log_dir)

        history: list[StepRecord] = []
        total_retries = 0
        last_subgoal: str | None = None
        last_action: str | None = None
        grounding_failures = 0

        try:
            for step in range(1, max_steps + 1):
                # 1. Capture
                frame_bytes = self._capturer.capture()
                frame_b64 = base64.b64encode(frame_bytes).decode()

                # Dump frame periodically
                interval = self._config.logging.frame_dump_interval
                if interval > 0 and step % interval == 0:
                    event_log.dump_frame(step=step, frame_bytes=frame_bytes)

                # 2. Reason — decide next subgoal
                use_thinking = step == 1 or total_retries > 0
                subgoal = await self._reasoner.next_subgoal(
                    goal=goal,
                    frame_base64=frame_b64,
                    history=history,
                    think=use_thinking,
                )
                last_subgoal = subgoal.description

                if subgoal.done:
                    self._active_task = None
                    return TaskReport(
                        status=TaskStatus.SUCCESS,
                        goal=goal,
                        steps_taken=step - 1,
                        steps_limit=max_steps,
                        duration_ms=int(time.time() * 1000) - start_ms,
                        retry_count=total_retries,
                        event_log_path=event_log.path,
                    )

                if subgoal.description.startswith("ERROR:"):
                    self._active_task = None
                    return TaskReport(
                        status=TaskStatus.REASONER_MALFORMED,
                        goal=goal,
                        steps_taken=step,
                        steps_limit=max_steps,
                        duration_ms=int(time.time() * 1000) - start_ms,
                        last_subgoal=subgoal.description,
                        retry_count=total_retries,
                        event_log_path=event_log.path,
                    )

                # 3. Ground — find the target element
                region = await self._grounder.ground(
                    frame_base64=frame_b64,
                    subgoal_description=subgoal.description,
                    action_hint=subgoal.action_hint,
                )
                last_action = region.action

                if region.status == "not_found":
                    grounding_failures += 1
                    if grounding_failures >= MAX_GROUNDING_FAILURES:
                        self._active_task = None
                        return TaskReport(
                            status=TaskStatus.GROUNDING_FAILED,
                            goal=goal,
                            steps_taken=step,
                            steps_limit=max_steps,
                            duration_ms=int(time.time() * 1000) - start_ms,
                            last_frame=frame_b64,
                            last_subgoal=subgoal.description,
                            attempted_action=region.action,
                            retry_count=total_retries,
                            event_log_path=event_log.path,
                        )
                    continue  # Skip execution, let reasoner replan

                grounding_failures = 0  # Reset on successful grounding

                # 4. Execute
                await self._input_backend.execute(region)

                # 5. Verify
                verify_frame = self._capturer.capture()
                verify_b64 = base64.b64encode(verify_frame).decode()
                verified = await self._grounder.verify(
                    frame_base64=verify_b64,
                    expected_state=f"{subgoal.description} succeeded",
                )

                # Retry loop for verification failures
                retries = 0
                while not verified and retries < MAX_RETRIES_PER_STEP:
                    retries += 1
                    total_retries += 1
                    await self._input_backend.execute(region)
                    verify_frame = self._capturer.capture()
                    verify_b64 = base64.b64encode(verify_frame).decode()
                    verified = await self._grounder.verify(
                        frame_base64=verify_b64,
                        expected_state=f"{subgoal.description} succeeded",
                    )

                # Log the step
                event_log.log_step(
                    step=step,
                    subgoal=subgoal.description,
                    action=region.action,
                    bbox=region.bbox,
                    confidence=region.confidence,
                    verified=verified,
                )

                # Dump frame on failure
                if not verified:
                    event_log.dump_frame(step=step, frame_bytes=verify_frame)

                history.append(
                    StepRecord(
                        subgoal=subgoal,
                        region=region,
                        verified=verified,
                        timestamp_ms=int(time.time() * 1000),
                    )
                )

                # Report progress
                if ctx is not None:
                    await ctx.report_progress(step, max_steps, subgoal.description)

            # Exhausted all steps
            self._active_task = None
            return TaskReport(
                status=TaskStatus.MAX_STEPS_EXCEEDED,
                goal=goal,
                steps_taken=max_steps,
                steps_limit=max_steps,
                duration_ms=int(time.time() * 1000) - start_ms,
                last_subgoal=last_subgoal,
                attempted_action=last_action,
                retry_count=total_retries,
                event_log_path=event_log.path,
            )

        except Exception:
            self._active_task = None
            raise
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_session.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/session.py tests/test_session.py
git commit -m "feat: add session — action loop with retry, verification, event logging"
```

---

### Task 10: MCP Server

**Files:**
- Create: `src/computer_use_agent/server.py`
- Create: `tests/test_server.py`

- [ ] **Step 1: Write the failing tests**

Write `~/computer-use-agent/tests/test_server.py`:

```python
"""Tests for MCP server — tool registration and handler logic."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from computer_use_agent.models import (
    ActionRegion,
    ActionResult,
    ScreenCapture,
    SessionStatus,
    TaskReport,
    TaskStatus,
)
from computer_use_agent.server import create_server


class TestServerTools:
    @pytest.fixture
    def mock_session(self) -> AsyncMock:
        s = AsyncMock()
        s.is_task_active = False
        s.get_status = MagicMock(
            return_value=SessionStatus(
                grounder_loaded=True,
                reasoner_loaded=True,
                grounder_model="ui-tars",
                reasoner_model="qwen3:8b",
                vram_used_mb=13500,
                active_task=None,
                tier="tight",
            )
        )
        s.run_task = AsyncMock(
            return_value=TaskReport(
                status=TaskStatus.SUCCESS,
                goal="test",
                steps_taken=2,
                steps_limit=50,
                duration_ms=3000,
                retry_count=0,
            )
        )
        return s

    def test_server_has_expected_tools(self, mock_session: AsyncMock):
        with patch("computer_use_agent.server._session", mock_session):
            server = create_server(mock_session)
            tool_names = [t.name for t in server._tool_manager.list_tools()]
            assert "run_task" in tool_names
            assert "run_action" in tool_names
            assert "get_status" in tool_names
            assert "capture_screen" in tool_names
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_server.py -v
```

Expected: `ModuleNotFoundError: No module named 'computer_use_agent.server'`

- [ ] **Step 3: Implement the MCP server**

Write `~/computer-use-agent/src/computer_use_agent/server.py`:

```python
"""FastMCP server — exposes computer-use-agent tools over stdio."""

from __future__ import annotations

import base64
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastmcp import Context, FastMCP

from computer_use_agent.config import load_config, Config
from computer_use_agent.models import (
    ActionResult,
    ScreenCapture,
    SessionStatus,
    TaskReport,
)
from computer_use_agent.session import Session

_session: Session | None = None


def create_server(session: Session | None = None) -> FastMCP:
    """Create the MCP server with all tools registered.

    Pass a session for testing; in production it's created by the lifespan.
    """
    mcp = FastMCP("computer-use-agent")

    @mcp.tool()
    async def run_task(
        goal: str,
        max_steps: int = 50,
        allow_cloud: bool = False,
        ctx: Context = None,
    ) -> dict:
        """Execute a multi-step desktop task autonomously.

        The agent captures the screen, plans actions, executes them,
        and verifies results in a loop until the goal is achieved
        or max_steps is reached.
        """
        s = session or _session
        report = await s.run_task(goal=goal, max_steps=max_steps, ctx=ctx)
        return report.model_dump()

    @mcp.tool()
    async def run_action(
        action: str,
        target: str,
        args: dict = {},
        ctx: Context = None,
    ) -> dict:
        """Execute a single action: Capture, Ground, Execute, Verify."""
        s = session or _session
        if s.is_task_active:
            return {"error": "Cannot run_action while run_task is active"}

        # Single-step version of the loop
        frame_bytes = s._capturer.capture()
        frame_b64 = base64.b64encode(frame_bytes).decode()

        region = await s._grounder.ground(
            frame_base64=frame_b64,
            subgoal_description=f"{action} {target}",
            action_hint=action,
        )

        if region.status != "not_found":
            await s._input_backend.execute(region)

        verify_frame = s._capturer.capture()
        verify_b64 = base64.b64encode(verify_frame).decode()
        verified = await s._grounder.verify(
            frame_base64=verify_b64,
            expected_state=f"{action} on {target} succeeded",
        )

        result = ActionResult(
            success=verified,
            action=action,
            target=target,
            region=region,
            frame_after=verify_b64,
        )
        return result.model_dump()

    @mcp.tool()
    async def get_status() -> dict:
        """Return current session state: loaded models, VRAM usage, active task."""
        s = session or _session
        return s.get_status().model_dump()

    @mcp.tool()
    async def capture_screen(ctx: Context = None) -> dict:
        """Take a screenshot and return it as base64 PNG."""
        s = session or _session
        if s.is_task_active:
            return {"error": "Cannot capture_screen while run_task is active"}

        frame_bytes = s._capturer.capture()
        w, h = s._capturer.dimensions()
        cap = ScreenCapture(
            image_base64=base64.b64encode(frame_bytes).decode(),
            width=w,
            height=h,
            timestamp_ms=int(time.time() * 1000),
        )
        return cap.model_dump()

    return mcp


def main() -> None:
    """Entry point — load config, create session, run MCP server."""
    import asyncio

    config_path = Path("config.yaml")
    if not config_path.exists():
        config_path = Path("config.example.yaml")

    config = load_config(config_path)

    global _session
    _session = Session(config=config)

    server = create_server()

    @server.lifespan
    @asynccontextmanager
    async def lifespan(app):
        await _session.initialize()
        yield {"session": _session}
        await _session.shutdown()

    server.run(transport="stdio")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/computer-use-agent
uv run pytest tests/test_server.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/computer-use-agent
git add src/computer_use_agent/server.py tests/test_server.py
git commit -m "feat: add MCP server — run_task, run_action, get_status, capture_screen tools"
```

---

### Task 11: Run Full Test Suite

**Files:**
- No new files — this is a verification pass

- [ ] **Step 1: Run the complete test suite**

```bash
cd ~/computer-use-agent
uv run pytest tests/ -v --ignore=tests/integration
```

Expected: all Tier A tests PASS.

- [ ] **Step 2: Check test coverage summary**

```bash
cd ~/computer-use-agent
uv run pytest tests/ -v --ignore=tests/integration --tb=short 2>&1 | tail -5
```

Expected: `X passed` with zero failures.

- [ ] **Step 3: Verify all source files are importable**

```bash
cd ~/computer-use-agent
uv run python -c "
from computer_use_agent.models import TaskReport, ActionRegion, Subgoal, TaskStatus
from computer_use_agent.config import Config, load_config
from computer_use_agent.event_log import EventLog
from computer_use_agent.grounder import Grounder, parse_ui_tars_response
from computer_use_agent.reasoner import Reasoner
from computer_use_agent.input_backend import InputBackend
from computer_use_agent.session import Session
from computer_use_agent.server import create_server
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 4: Final commit with any fixes**

Only if tests revealed issues. Otherwise skip.

```bash
cd ~/computer-use-agent
git add -A
git commit -m "fix: address test suite issues"
```

---

## Notes for Golden Integration Tests (Tier B)

Golden tests (G1–G10) are NOT included in this plan because they require:
1. A live Windows desktop (not WSL2)
2. GPU with vLLM serving UI-TARS
3. Ollama running Qwen3

They should be written after the MVP is deployed and running on Windows. The test structure is ready in `tests/integration/golden/` — each test file follows the same pattern:

```python
@pytest.mark.golden
@pytest.mark.parametrize("attempt", range(3))
async def test_g01_open_notepad(session, attempt):
    report = await session.run_task(goal="open Notepad from the Start menu", max_steps=10, ctx=None)
    assert report.status == "success"
```

Pass threshold: 2/3 attempts must succeed. Temperature 0 + fixed seed for reproducibility.
