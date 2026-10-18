# MultiAI: Autonomous Multi-Model AI Orchestrator & Execution Subsystem

[![Engine](https://img.shields.io/badge/Engine-Go%20%7C%20Python-00ADD8?style=flat-square&logo=go)](task_server_go/)
[![Runtime](https://img.shields.io/badge/Runtime-Node.js%2020%2B-339933?style=flat-square&logo=node.js)](package.json)
[![Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-FF5722?style=flat-square)](src/core/mcp_manager.js)
[![Safety](https://img.shields.io/badge/Safety-Shadow%20Git%20%7C%20Bubblewrap-607D8B?style=flat-square)](src/core/shadow_git_manager.js)
[![Platforms](https://img.shields.io/badge/Platforms-Linux%20%7C%20Windows%20%7C%20Android%20%7C%20macOS-4CAF50?style=flat-square)](#cross-platform-architecture)

**MultiAI** (UI title: **MultiSearch AI**) is an open, modular, zero-cloud-lockin autonomous AI development environment. It unifies dozens of frontier LLMs and vision models behind a single responsive desktop and mobile interface, paired with an isolated dual-engine task execution subsystem (Go & Python) capable of running native shell commands, persistent process daemons, surgical code refactoring, and automated workspace versioning.

There is no mandatory cloud account, no telemetry, and no client-side bundling step. All configuration, chats, projects, and shadow revision histories live locally on your filesystem.

---

## Table of Contents

1. [Architectural Overview](#architectural-overview)
2. [Dual-Engine Execution Subsystem (Go & Python)](#dual-engine-execution-subsystem)
3. [Sandbox Isolation & Security Boundaries](#sandbox-isolation--security-boundaries)
4. [Shadow Git File Revision Engine](#shadow-git-file-revision-engine)
5. [Model Context Protocol (MCP) Integration](#model-context-protocol-mcp-integration)
6. [Supported Providers & Key Management](#supported-providers--key-management)
7. [Operating Modes: Chat vs. Build](#operating-modes-chat-vs-build)
8. [Agent Tool Ecosystem](#agent-tool-ecosystem)
9. [Configuration Reference](#configuration-reference)
10. [Local Storage Architecture (`~/.MultiAI`)](#local-storage-architecture)
11. [Quickstart & Supervisor CLI](#quickstart--supervisor-cli)
12. [Compiling the Go Task Daemon](#compiling-the-go-task-daemon)
13. [Testing & Verification](#testing--verification)

---

## Architectural Overview

MultiAI is built around a decoupled three-tier architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      CLIENT TIER (Pure Vanilla JS)                     │
│  - ES Modules & Design Tokens (zero bundler required, zero CDN)        │
│  - Vendored: Marked, DOMPurify, Highlight.js, KaTeX, Lucide Icons      │
│  - Streaming SSE receiver, Markdown parser, Diff-viewer timeline       │
│  - Dynamic Celestial Aurora Theme Engine (Saturn, Aurora, Eclipse)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST + Server-Sent Events (SSE)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   NODE.JS SUPERVISOR & ORCHESTRATION                   │
│  - Process Lifecycle & Port Guard (src/server/supervisor.js)           │
│  - Multi-Provider LLM & Vision Normalization (src/providers/)          │
│  - LangGraph Agentic Loop (Router → Planner → Dispatcher → Synthesis)  │
│  - Model Context Protocol (MCP) Client Manager (src/core/mcp_manager)  │
│  - Shadow Git Automated Rollback Engine (src/core/shadow_git_manager)  │
│  - Canonical Configuration Manager (src/core/config_manager.js)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ TCP Loopback (:5789) OR Unix Socket (.sock)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 TASK EXECUTION SUBSYSTEM (Dual-Engine)                 │
│                                                                        │
│   [Engine A: Go Task Daemon]          [Engine B: Python Task Server]   │
│   - Ultra-low latency binary          - Universal fallback engine      │
│   - Linux, macOS, Win, Android ARM64  - POSIX PTY & Windows Job Mgr    │
│   - Process tree supervision          - Flask / stdlib HTTP backend    │
│   - Native memory-mapped grep         - Python code evaluation         │
│   - IPC: TCP or Unix Domain Socket    - IPC: TCP loopback              │
│                                                                        │
│                   SECURITY BOUNDARY (Sandbox Profiles)                 │
│              Direct Host  │  Bubblewrap (bwrap)  │  Docker              │
└────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

* **Strict Provider Decoupling**: Provider-specific quirks, payload transforms, and API anomalies are encapsulated strictly within [`src/providers/`](src/providers/). The frontend remains 100% provider-agnostic.
* **Component-First Frontend**: Pure standards-based ES modules. Markup templates (such as [`client/src/components/settings-template.js`](client/src/components/settings-template.js)) and modular CSS split by domain ([`composer.css`](client/styles/composer.css), [`bottom-sheet.css`](client/styles/bottom-sheet.css), [`error-recovery.css`](client/styles/error-recovery.css), [`start-page.css`](client/styles/start-page.css)).
* **Resilient IPC**: Node.js communicates with the local task daemon via loopback HTTP (`http://127.0.0.1:5789`) or local Unix Domain Sockets (`~/.MultiAI/task_server.sock`).

---

## Dual-Engine Execution Subsystem

MultiAI provides two switchable task engines to execute terminal commands, run interactive scripts, conduct code searches, and manage background tasks.

### Engine Comparison

| Feature | Go Task Daemon (`task_server_go/`) | Python Task Server (`task_server/`) |
| :--- | :--- | :--- |
| **Runtime Dependency** | **None** (Statically linked binary) | Python 3.8+ (Flask or stdlib) |
| **Startup Latency** | **< 2 ms** | ~150–300 ms (interpreter overhead) |
| **Idle Memory Footprint**| **~6 MB** | ~35–50 MB |
| **Android ARM64 Native** | **Yes** (Position-Independent Executable - PIE)| Requires Python environment in Termux |
| **Windows Support** | Native `cmd.exe`/PowerShell + Process Groups | Native `WindowsTaskManager` |
| **Transport** | TCP Loopback or **Unix Domain Socket** (`.sock`) | TCP Loopback |
| **Concurrency** | Goroutine per connection & streaming task | Threading / greenlet worker pool |

### How to Switch Engines

The active engine is dynamically resolved at launch:
1. **CLI Flag**: `multiai --task-server=go` or `multiai --task-daemon=go` (or `python`)
2. **Environment Variable**: `MULTIAI_TASK_DAEMON=go` or `MULTIAI_TASK_DAEMON=python`
3. **Configuration File**: In `~/.MultiAI/config.ini`:
   ```ini
   [Agent]
   TaskServer = go   # Options: go | python (alias: TaskDaemon = go)
   ```
4. **Auto-Fallback**: If `go` is requested but the compiled binary (`bin/task_daemon` or `bin/task_daemon.exe`) is missing, MultiAI logs a warning and automatically falls back to Python without crashing.

---

## Sandbox Isolation & Security Boundaries

MultiAI features a built-in sandbox abstraction manager ([`src/core/sandbox_manager.js`](src/core/sandbox_manager.js)) governed by `~/.MultiAI/vm_conf.json`.

```
Direct Host (Unrestricted) ◄──► Bubblewrap (bwrap Linux Namespaces) ◄──► Docker Container
```

* **Direct Profile (`direct`)**: Commands execute directly on the host workspace with inherited environment variables.
* **Bubblewrap Profile (`bwrap`)**: Linux user namespaces isolate `/`, mounting read-only system roots (`/usr`, `/lib`, `/bin`) while exposing only the project directory and `~/.MultiAI/scratch` as read-write. Network isolation can be toggled per task.
* **Docker Profile (`docker`)**: Tasks execute inside isolated ephemeral or persistent containers.

---

## Shadow Git File Revision Engine

When building software in **Build Mode**, MultiAI automatically safeguards your workspace using an independent **Shadow Git Engine** ([`src/core/shadow_git_manager.js`](src/core/shadow_git_manager.js)):

1. **Zero Pollution**: Tracks project mutations under `~/.MultiAI/shadow_git/<project-hash>`. It **never** touches or alters your repository's `.git/` tree, branches, or commit history.
2. **Micro-Snapshots**: Before modifying files via `write_file`, `search_and_replace`, or atomic patch tools, a baseline commit is recorded.
3. **Turn-by-Turn Diff Ticker**: The UI displays real-time additions and deletions per turn with visual diff chips (`+24 -3`).
4. **Interactive Timeline & Revert**: Review unified side-by-side diffs directly in the UI. Reverting a change restores byte-level file fidelity instantly.
5. **Accept & Clear**: Once you are satisfied with the agent's work, changes are marked accepted.

---

## Model Context Protocol (MCP) Integration

MultiAI includes native support for Anthropic's **Model Context Protocol** ([`src/core/mcp_manager.js`](src/core/mcp_manager.js)):

* **Transports Supported**: `stdio` (local subprocesses) and `sse` (HTTP Server-Sent Events).
* **Live Discovery**: Discovers tools, transforms MCP schemas into agent-compatible JSON schemas, and namespaces them as `mcp_<server>_<tool>`.
* **Dynamic Settings Control**: Add, enable, disable, and refresh MCP servers live from **Settings → Tools & MCP** without restarting the application.
* **Full Streaming Support**: MCP tool executions are surfaced in chat with dedicated badges (`MCP [server_name]`) and expandable JSON execution inspector drawers.

---

## Supported Providers & Key Management

API keys are stored securely on the host machine (either in `~/.bashrc`, `/etc/environment`, or local `.env`) and are **never** transmitted to the browser client.

| Provider | Environment Variable | Vision Capable | Native Tool Calling |
| :--- | :--- | :---: | :---: |
| **Google Gemini & Gemma** | `GEMINI_API_KEY` | Yes | Yes |
| **Groq (Llama 3, Mixtral)**| `API_KEY` or `GROQ_API_KEY` | Yes | Yes |
| **OpenRouter (Multi-model)**| `OPEN_ROUTER` or `OPENROUTER_API_KEY` | Yes | Yes |
| **Cohere (Command R/R+)** | `COHERE_API_KEY` | No | Yes |
| **Z.AI (GLM-4)** | `Z_AI_API_KEY` | Yes | Yes |
| **LLM7** | `LLM7_API_KEY` | Yes | Yes |
| **Logflare** | `LOGFLARE_API_KEY` | Yes | Yes |
| **ArliAI** | `ARLIAI_API_KEY` | No | Yes |
| **NVIDIA NIM** | `NVIDIA_API_KEY` | Yes | Yes |
| **Mistral AI** | `MISTRAL_API_KEY` | Yes | Yes |
| **Puter.js** | *None (Free in-browser proxy)* | Yes | Yes |
| **Pollinations** | *None (Free open-source diffusion/LLM)*| Yes | Yes |
| **TokenHarbour** | `TOKENHARBOUR_API_KEY` | Yes | Yes |
| **OmniRoute** | `OMNIROUTE_API_KEY` | Yes | Yes |
| **OpenCode** | `OPENCODE_API_KEY` | Yes | Yes |
| **Web Search (TinyFish)** | `TINYFISH_API_KEY` | N/A | N/A |

---

## Operating Modes: Chat vs. Build

MultiAI features two dedicated operational workflows switchable via the sidebar pill:

### 1. Chat Mode
* General-purpose conversation, code explanation, reasoning, and image generation.
* Support for multimodal image attachments, KaTeX mathematical formulas, and syntax-highlighted code with one-click copy.
* Dynamic celestial ambient themes: **Saturn**, **Northern Lights (Aurora)**, **Lunar Mist**, **Cosmic Nebula**, **Solar Eclipse**, or achromatic Minimalist.

### 2. Build Mode
* Full-stack agentic software engineering bound to a specific local project directory.
* **Planning Subsystem**: Employs `write_todos` to maintain a persistent, interactive checklist dock showing pending, active, and completed milestones.
* **Subagent Delegation**: Spawns focused subagents (`task`) to research docs, audit subcomponents, or inspect dependency trees in parallel.
* **Human-in-the-Loop Clarification**: Automatically prompts the developer using `ask_question` with selectable options whenever requirements are ambiguous.
* **Reversible Code Editing**: All file edits are guarded by the Shadow Git revision engine.

---

## Agent Tool Ecosystem

| Tool Name | Scope | Capabilities |
| :--- | :--- | :--- |
| `run_task` / `run_command` | Terminal | Executes shell commands, captures stdout/stderr, supports background daemon tracking and stdin/key injection. |
| `read_file` | Filesystem | Reads full or partial byte ranges, displays line numbers, inspects file metadata and images. |
| `write_file` | Filesystem | Writes new files or overwrites existing files atomically. |
| `search_and_replace` | Filesystem | 4-stage cascade editor: Exact match → Normal line endings → Indentation agnostic → Fuzzy Levenshtein match (≥ 85%). |
| `grep_search` | Filesystem | Multithreaded search using Ripgrep, Go, Python regex, or Node fallback. |
| `run_python` | Code Runner | Evaluates Python snippets in memory, captures print statements and last returned expressions. |
| `web_search` | Research | Live multi-query web search engine powered by TinyFish. |
| `fetch_web_content` | Research | Fetches arbitrary HTTP/HTTPS endpoints and converts HTML into sanitized Markdown. |
| `generate_image` | Creative | Asynchronous text-to-image synthesis with Pollinations Flux, Turbo, or OpenAI DALL-E. |
| `write_todos` | Planning | Creates and updates the structured multi-phase execution task plan. |
| `task` | Orchestration | Dispatches specialized subagent workflows (researcher, reviewer, coder). |
| `ask_question` | HITL | Renders interactive choice modals in the UI to ask the user clarifying questions. |

---

## Configuration Reference

### Canonical Configuration (`~/.MultiAI/config.ini`)

All system defaults are controlled by `~/.MultiAI/config.ini`. If this file does not exist, MultiAI automatically copies [`config.example.ini`](config.example.ini) on first launch:

```ini
[General]
DefaultStartupLLM = gemini-2.5-flash
DefaultImageProvider = pollinations
DefaultImageModel = flux
DefaultImageAspectRatio = 1:1
StorageDir = ~/.MultiAI
Port = 4440
Host = 0.0.0.0
LogLevel = info

[Agent]
MaxToolRounds = 0              # 0 = uncapped continuous agent loop
MaxToolsPerRound = 10
TurnTimeoutSeconds = 120
TaskDaemon = go                # Switchable: 'go' or 'python'
StreamReasoning = false

[Tools]
EnableTerminal = true
EnableWebSearch = true
EnableImageGeneration = true
EnableFileOperations = true
EnableMcp = true
DefaultTaskCooldown = 2
MaxFileSizeKB = 1024

[UI]
Theme = dark                   # Options: dark, light, midnight, system
AuroraTheme = saturn           # Options: saturn, aurora, nebula, mist, eclipse, off
ShowLineNumbers = true
CompactMobileView = true
```

---

## Local Storage Architecture (`~/.MultiAI`)

All user state is strictly isolated under `~/.MultiAI`:

```
~/.MultiAI/
├── config.ini                     # Master user configuration
├── task_server.sock               # Unix Domain Socket for Go/Python daemon IPC
├── vm_conf.json                   # Sandbox container profile settings
├── shadow_git/                    # Local workspace micro-commits & diff timelines
│   └── <project-slug-hash>/       # Isolated shadow git repository
├── chat/
│   └── conversations/{date}/      # Chat sessions stored as meta.json + messages.jsonl
└── build/
    └── projects/{projectId}/      # Project-scoped build sessions & state
```

---

## Quickstart & Supervisor CLI

### Prerequisites

* **Node.js**: v20.0.0 or higher
* **npm**: v10.0.0 or higher
* **Python**: v3.8+ *(Only required if using the Python task server engine)*
* **Go**: v1.21+ *(Only required if compiling the Go task daemon from source)*

### 1. Launching MultiAI

Start MultiAI using the native helper or Python launcher:

```bash
# Recommended launcher
multiai

# With options:
multiai --task-daemon=go --socket --port=4440
```

Alternatively, launch via Python or Node:
```bash
python3 start.py
# or
node src/index.js
```

### 2. Configuration & Model Management

Quickly inspect and edit your MultiAI settings and model catalog in your preferred terminal editor (`$EDITOR` or `$VISUAL`, defaulting to `nano`):

```bash
# Open canonical configuration file (~/.MultiAI/config.ini)
multiai conf
# or with a custom editor:
EDITOR=vim multiai conf

# Open models & providers configuration (models.yaml)
multiai models
# or with a custom editor:
EDITOR=nano multiai models
```

### 3. Available CLI Flags

| Flag | Description |
| :--- | :--- |
| `--task-daemon=go\|python` | Explicitly choose the task engine (`--go-daemon` or `--python-daemon`) |
| `--socket` | Bind Go task daemon to Unix Domain Socket (`~/.MultiAI/task_server.sock`) |
| `--port N` | Override HTTP port (default: 4440 or configured value in `config.ini`) |
| `--host IP` | Override binding host address (default: `0.0.0.0` or `127.0.0.1`) |
| `--no-browser` | Prevent auto-opening the browser window on launch |
| `--check-only` | Run pre-flight dependency diagnostics and exit |

### 3. Interactive Server Console Commands

While MultiAI is running, you can enter management commands directly into the terminal prompt:

| Command | Action |
| :--- | :--- |
| `status` / `info` | Displays active ports, task daemon engine, active PID, memory, and uptime |
| `restart` / `reload` | Gracefully reloads both the Node web server and the task daemon |
| `pull` [branch] | Pulls the latest git commits and auto-restarts if updates are found |
| `stop` / `exit` / `quit` | Terminates all subprocesses and daemon trees cleanly and exits |
| `clear` / `cls` | Clears the terminal console buffer |
| `help` / `?` | Displays the console command manual |

---

## Compiling the Go Task Daemon

The Go task daemon lives in [`task_server_go/`](task_server_go/) and can be compiled statically across platforms with zero external C dependencies (`CGO_ENABLED=0`):

```bash
# Compile for host platform (Linux x86_64) -> bin/task_daemon
npm run build:daemon

# Compile static binary for Linux ARM64 (aarch64 / proot) -> bin/task_daemon_arm64
npm run build:daemon:arm64

# Compile static binary for Linux ARMv7l (32-bit ARM / proot) -> bin/task_daemon_armv7l
npm run build:daemon:armv7l

# Compile for Windows x64 -> bin/task_daemon.exe
npm run build:daemon:windows

# Compile for macOS ARM64 -> bin/task_daemon_darwin_arm64
npm run build:daemon:darwin

# Compile all platform binaries at once
npm run build:daemon:all
```

> **Automatic Pre-Flight Download**: MultiAI's startup script (`start.py`) automatically detects your host architecture (`x86_64`, `arm64`, `armv7l`, `windows`, etc.) and downloads the appropriate static binary from GitHub Releases if missing. If offline or unavailable, it will automatically compile locally via `go build` if Go is installed, or seamlessly fall back to the Python Flask task server.

---

## Testing & Verification

MultiAI features a comprehensive characterization and safety-net test suite under [`tests/`](tests/).

Run test modules individually or in sequence:

```bash
# Test Config Manager resolution & migration
node tests/test_config_manager.js

# Test Supervisor live switching between Go and Python daemons
node tests/test_live_supervisor_switch.js

# Test Go Task Daemon (TCP + Unix Domain Socket IPC)
node tests/test_go_daemon.js

# Test Model Context Protocol (MCP) Manager & routes
node tests/test_mcp_manager.js
node tests/test_mcp_settings_ui.js

# Test Shadow Git revision engine & byte fidelity rollback
node tests/test_shadow_git_manager.js

# Test Chat tool badges, checklists, and expandable inspectors
node tests/test_chat_tool_badges.js

# Test Build Projects directory validation & persistence
node tests/test_build_projects_routes.js
```

---

## License

Private / Unspecified. Treat as personal laboratory software unless explicitly designated otherwise.
