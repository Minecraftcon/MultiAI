# MultiAI

Local multi-provider AI chat and coding agent. One desktop web app talks to many LLMs, runs tools (terminal, files, search, images, Python), and persists chats and build projects on disk.

The UI title is **MultiSearch AI**. There is no cloud account and no build step — start it, open the browser, pick a model.

## Features

- **Many providers, one picker** — Gemini, Groq, OpenRouter, Cohere, Z.AI, LLM7, Logflare, ArliAI, NVIDIA NIM, Mistral, Puter, plus a generic OpenAI-compatible fallback
- **Chat and Build modes** — regular conversations, or project-scoped coding sessions
- **Tool-using agent** — LangGraph loop: router → planner → model ⇄ tools / recovery → synthesizer
- **Local tools** — shell, Python, grep, surgical search/replace, file read/write, web search, page fetch, image generation
- **Vision + images** — attach images to vision models; generate images via Pollinations (default, no key), OpenAI, or Logflare
- **Disk persistence** — chats and projects live under `~/.MultiAI` as `meta.json` + `messages.jsonl`
- **Keys stay on the server** — read from the environment / `~/.bashrc`, never sent to the browser
- **Cross-platform** — Linux and Windows task backends; the starter handles both

## Requirements

- Python 3.8+
- Node.js and npm
- Flask is auto-installed if missing (`start.py` also falls back to a stdlib HTTP server)

## Quick start

```bash
python3 start.py
```

That script:

1. Checks Python, Node, and npm
2. Runs `npm install` if LangGraph / yaml are missing
3. Frees ports **8080** (web) and **5000** (task server)
4. Starts `node --watch server.js`
5. Opens `http://localhost:8080`
6. Kills the whole process tree on Ctrl+C

Flags:

| Flag | Meaning |
|---|---|
| `--check-only` | Verify setup and exit |
| `--no-browser` | Don't open the browser |
| `--port N` | Web port (default from `config.ini`, usually 8080) |

## Architecture

```
Browser (MultiAI-MODular)
        │  REST + SSE
        ▼
Node server.js :8080  ──►  LLM / image APIs
        │
        ├── conversations_manager  →  ~/.MultiAI
        ├── providers/             →  pluggable adapters
        ├── agent_graph.js         →  LangGraph orchestration
        └── code_tools.js          →  grep / replace / write
                │
                ▼
        Python task_server :5000
        (shell, Python runner, grep)
```

| Layer | Role |
|---|---|
| `start.py` | Setup, port cleanup, process supervision |
| `server.js` | HTTP API, static files, chat/agent streaming, tool proxy |
| `task_server/` | Flask sidecar: POSIX/Windows shells, Python runner, grep |
| `providers/` | Pluggable LLM + image adapters |
| `agent_graph.js` | LangGraph workflow |
| `code_tools.js` | Ripgrep → Python → Node grep; 4-stage search/replace; atomic writes |
| `conversations_manager.js` | Disk persistence |
| `MultiAI-MODular/` | Vanilla JS frontend (no bundler) |

Provider quirks belong in `providers/`, not the WebUI.

## Configuration

### `config.ini`

```ini
[General]
DefaultStartupLLM = gemini-2.5-flash
DefaultImageProvider = pollinations
DefaultImageModel = turbo
DefaultImageAspectRatio = 1:1
StorageDir = ~/.MultiAI
Port = 8080
Host = 0.0.0.0
SystemPreset = creative

[Agent]
MaxToolRounds = 0          # 0 = uncapped
MaxToolsPerRound = 10
TurnTimeoutSeconds = 120
Temperature = 0.35

[Tools]
EnableTerminal = true
EnableWebSearch = true
EnableImageGeneration = true
EnableFileOperations = true

[UI]
Theme = dark
AuroraTheme = clouds
```

The UI can also read/write this via `/api/config`.

### `models.yaml`

Catalog of providers and models. Each model declares `supports_tools`, `supports_vision`, and optional `max_context_tokens`. API keys are referenced by **environment variable name**, never stored in the file.

## API keys

Export keys in your shell or `~/.bashrc`. The server resolves them and never exposes them to the client.

| Provider | Environment variable |
|---|---|
| Google Gemini | `GEMINI_API_KEY` |
| Z.AI (GLM) | `Z_AI_API_KEY` |
| LLM7 | `LLM7_API_KEY` |
| Logflare | `LOGFLARE_API_KEY` |
| ArliAI | `ARLIAI_API_KEY` |
| Groq | `API_KEY` |
| OpenRouter | `OPEN_ROUTER` |
| Cohere | `COHERE_API_KEY` |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Web search | `TINYFISH_API_KEY` |
| Puter | none (browser-side) |
| Pollinations images | none |

Example:

```bash
export GEMINI_API_KEY="..."
export OPEN_ROUTER="..."
python3 start.py
```

## Modes

**Chat** — conversations under:

```
~/.MultiAI/chat/conversations/{date}/chats/{id}/
    meta.json
    messages.jsonl
    scratch/
    images/
```

**Build** — project-scoped coding sessions under:

```
~/.MultiAI/build/projects/{projectId}/chats/{id}/
```

Legacy `~/.MuktiAI` data is migrated automatically.

Paths prefixed with `$SCRATCH/` resolve to that conversation's isolated scratch directory.

## Agent tools

| Tool | Purpose |
|---|---|
| `run_task` | Local shell (interactive stdin, keycodes, idle/kill) |
| `run_python` | Execute a Python snippet and return stdout / last expression |
| `read_file` | Read, info, or preview a file (including images) |
| `write_file` | Write, replace, inject, or batch-edit |
| `search_and_replace` | 4-stage cascade (exact → line endings → indent → fuzzy ≥ 85%) |
| `grep_search` | Ripgrep, then Python, then Node fallback |
| `web_search` | Live search (TinyFish) |
| `fetch_web_content` | Fetch a URL as markdown/html/json |
| `generate_image` | Background image generation + status polling |

`MaxToolRounds = 0` means the loop is not capped by that setting.

## Adding a provider

1. Drop a class in `providers/llm/` (or `providers/image/`) that extends `BaseProvider` / `BaseImageProvider`.
2. Set `static id`, `displayName`, and `matchPatterns`.
3. Implement `chat()` / `generateImage()` and any API quirks **in that file**.
4. Add the models to `models.yaml` with the `api_key_env` name.

The registry auto-loads every `*.js` file in those folders. The UI does not need edits for a new provider.

OpenAI-compatible APIs can often skip a custom class and use the generic adapter plus a `models.yaml` entry.

## HTTP API (high level)

| Route | Purpose |
|---|---|
| `POST /api/chat` | Single-turn chat |
| `POST /api/agent/stream` | Streaming agent turn |
| `GET/POST /api/config` | Read / write `config.ini` |
| `GET /api/models` | Model catalog |
| `GET/POST/DELETE /api/chats…` | Chat persistence |
| `GET/POST/DELETE /api/build/projects…` | Build projects |
| `POST /api/search`, `/api/fetch` | Web tools |
| `POST /api/file/*`, `/api/code/grep` | Filesystem tools |
| `POST /api/python/run` | Python runner |
| `/api/task/*` | Shell task proxy → `:5000` |
| `POST /api/image/generate` | Image generation |
| `GET /api/media?path=` | Local media bridge |

## Project layout

```
start.py                 Supervisor / launcher
server.js                Node HTTP server
config.ini               Runtime settings
config_manager.js        INI loader
models.yaml              Provider + model catalog
agent_graph.js           LangGraph agent
code_tools.js            Grep / replace / write engine
conversations_manager.js Disk persistence
providers/
  llm/                   Chat adapters (auto-loaded)
  image/                 Image adapters (auto-loaded)
task_server/             Python sidecar (POSIX + Windows)
MultiAI-MODular/         Frontend (ES modules + CSS)
  src/agent/             Client agent loop
  src/components/        UI
  src/tools/             Client tool registry
```

Node dependencies are only `@langchain/core`, `@langchain/langgraph`, and `yaml`. The frontend loads marked, DOMPurify, highlight.js, KaTeX, Lucide, Mermaid, and Three.js from CDNs.

## License

Private / unspecified. Treat as personal software unless a license file is added.
