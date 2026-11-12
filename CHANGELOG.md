# MultiAI Changelog & Release Notes

## [v0.2.0-alpha] - 2026-11-12

### 🔍 PAS-BM25 Search Engine (Positional Attention Soft-BM25)
* **Zero-AI / Zero-Token Cost RAG**: Implemented an in-memory heuristic retrieval-augmented generation (RAG) engine running in pure JavaScript (~3ms latency) without requiring external embedding models, Python runtimes, or secondary LLM turns.
* **Positional Span Attention Kernel**: Computes the shortest token span containing matched query terms (`Span Compactness`). Heavily suppresses scattered table/navbox clutter (e.g. Wikipedia navboxes, unrelated SoC matrices) while applying up to a 3.5× boost to tight sentence clusters (patch diffs, code definitions, technical explanations).
* **Anchor Token Gating**: Extracts high-specificity alphanumeric anchors (e.g. `ili9882n`, `mt6768`, `dl_async`, `starry`) from queries and enforces that candidate excerpts must match at least one primary anchor. Completely eliminates cross-domain false-positive collisions (such as generic word overlap matching unrelated documents).
* **BM25 Length-Normalization Floor**: Enforced an effective document length floor (`Math.max(docLen, 25)`) to eliminate the classic BM25 short-document score distortion on 2–3 word navigation crumbs.
* **Context-Centric Micro-Windowing**: Extracts tight 200–280 character snippets snapped to sentence boundaries, bounded by a global 450-word cap to eliminate context window overflow and model truncation warnings.
* **Stream-Capped Zero-Chromium Fetcher**: Replaced heavy headless Chromium fallbacks with a pure native HTTP stream-capped reader with a 3.5s timeout. In-memory cleaning strips scripts, SVGs, styles, and headers before parsing, running smoothly on low-power ARM devices and Android/Termux without risk of Out-of-Memory (OOM) kills.
* **Snippet Fallback & Stage 1 Auto-Relaxation**: Gracefully falls back to search snippets when target sites block headless HTTP (Cloudflare). Automatically relaxes over-constrained queries with boolean noise or excessive tokens when Stage 1 returns zero results.

---

### ⚙️ Search Configuration & Settings
* **Search Provider Selection**: Added UI settings toggle allowing instant switching between `TinyFish (Official API)` and `DuckDuckGo (Free / No Key Needed)`.
* **Pair DeepSearch Toggle**: Introduced a dedicated switch under **Settings ➔ Agent Capabilities & Tools ➔ Web Search** to enable/disable PAS-BM25 second-stage retrieval.
* **Dual Persistence**: Configured settings auto-save seamlessly across `~/.MultiAI/config.ini`, repo defaults, and active runtime memory via `/api/config`.

---

### 🎨 UI & Streaming Stability Fixes
* **Auto-Collapsing Finalized Reasoning on Action / Output**:
  * Configured `<details class="thought-box">` to automatically collapse as soon as the model finishes thinking (when user-facing response text starts streaming, tools begin executing, the next round starts, or generation completes).
  * Streaming thoughts remain open live while thinking is actively in progress, allowing real-time inspection, but automatically fold into compact cards once the model moves to action without dominating the viewport.
  * Preserved user manual toggle overrides (`data-user-toggled="open"`) and ensured historical messages rehydrate with thought boxes closed by default.
* **Smart User Home Path Resolution in Filesystem Tools**:
  * Enhanced `resolveSafePath()` in `src/server/utils.js` to automatically translate sanitized `[USER]` placeholders (e.g. `/home/[USER]`, `/Users/[USER]`, `C:\Users\[USER]`) and tilde (`~/...`) back to the user's actual home directory (`os.homedir()`).
  * Disabled the default local path scrubbing filter (`flt_default_paths`) in `context-filter.js` so workspace project paths are not rewritten into synthetic `[USER]` strings that confuse coding LLMs into thinking file paths are broken.
* **Eliminated Micro-Shaking & Vertical Jitter on Badges & Elements**:
  * Replaced `content-visibility: auto` on `.message` with stable CSS style containment (`contain: style;`). In chat layouts with highly variable message heights, `content-visibility: auto` dynamically swapped off-screen turns between placeholder sizes and rendered heights, creating an infinite scroll oscillation feedback loop against smooth auto-scrolling.
  * Increased subpixel landing threshold in `chat-scroll.js` from `0.8px` to `1.5px`, eliminating subpixel ping-pong oscillations on displays with non-integer scaling ratios (125%, 150%, Retina).
  * Replaced vertical `popIn` (`translateY(8px)`) animation on `.search-badge-item` with a clean opacity fade (`fadeIn 0.2s ease-out`), preventing tool call badges and status chips from hopping up and down as they render.
* **Inline Dynamic Streaming Cursor**:
  * Upgraded streaming mode in `StreamBatchRenderer` to attach the blinking cursor directly inline at the tip of the actively generating leaf element (paragraphs, lists, blockquotes, and code blocks), so the cursor moves naturally with the streaming words instead of sitting on a static line at the bottom.
  * Styled `.blinking-cursor` with proportional `1.15em` height and `-0.15em` baseline alignment to match font sizes seamlessly across prose, headings, and code snippets.

---

### 🚀 OpenCode Provider Runtime Bridge (Eliminated 429 Client-Detection Errors)
* **OpenCode v2 Local Daemon & CLI Integration**:
  * Upgraded `src/providers/llm/opencode.js` to bridge directly with the local OpenCode v2 client runtime instead of sending spoofed HTTP requests to edge endpoints (`opencode.ai/zen/v1`).
  * Completely eliminated upstream `HTTP 429 FreeUsageLimitError` gate failures on free community models (`mimo-v2.6-flash-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `nemotron-3.5-lightning-free`, etc.).
* **Dual-Tier High-Performance Execution**:
  * **Tier 1 (Local Daemon Bridge)**: Detects active OpenCode background service from `~/.local/state/opencode/service.json` and communicates via authenticated REST (`/api/session`, `/api/session/:id/model`, `/api/session/:id/prompt`) and real-time SSE (`/api/event`), delivering <2s response times and live token streaming. Sessions are automatically cleaned up on completion or client disconnect.
  * **Tier 2 (CLI Subprocess Fallback)**: Automatically falls back to `opencode run --format json --thinking -m opencode/<model>` if the daemon is offline, parsing streaming deltas (`step_start`, `reasoning`, `text`, `tool_use`, `step_finish`) directly into MultiAI chat streams.
  * **Tier 3 (Cloud API)**: Preserves direct cloud routing when explicit `OPENCODE_API_KEY` credentials are provided.

