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
* **Eliminated Status Label Flicker**: Resolved a high-frequency race condition between `orchestrator.js`'s 100ms `statusTimer` (`"Synthesizing (round X)..."`) and `chat-ui.js`'s streaming callback (`"Working... (${elapsed}s)"`), stabilizing activity label rendering.
* **Stabilized Thought Box & Responsive Controls**:
  * Fixed a bug where `preSearchContent.innerHTML` was completely re-rendered on every streamed token chunk, unmounting and remounting the thought box DOM tree.
  * Added `_lastRenderedThought` content-aware memoization: once thinking concludes, the thought container is left untouched while the response body streams.
  * State preservation: user interactions (collapsing via `<summary>` or clicking `... expand`) are tracked and preserved across stream ticks, resolving unresponsive toggle controls and border-line flickering.
* **Preserved Intermediate Commentary**: Resolved an issue where conversational text spoken by the model before executing tool calls was previously lumped into `<think>` blocks and hidden. Intermediate commentary is now parsed cleanly and anchored directly above tool execution badges.
* **RAF Markdown Streaming**: Upgraded `StreamBatchRenderer` to use `requestAnimationFrame` with automatic backtick and code-fence closing, enabling smooth real-time rendering of formatted markdown.
* **Mobile Streaming & Rendering Optimization (`modern-web-guidance`)**:
  * Added `content-visibility: auto` and `contain-intrinsic-size: auto none auto 120px` to `.message` with fallback containment (`contain: layout style`), skipping layout/paint calculations for off-screen turns and isolating layout reflows during streaming.
  * Implemented adaptive ~32ms (~30 FPS) throttling in `StreamBatchRenderer.append()` so markdown parsing does not bottleneck mobile CPUs during high token-rate bursts, while preserving immediate synchronous execution on stream completion.
  * Eliminated redundant full-document `parseMarkdown()` re-computations inside `updateAIStream` during active streaming chunks.
  * Added table detection guards to `wrapTablesForScroll()` to bypass DOM queries when streams lack tables.
* **Stream Model Response & Reasoning Settings**:
  * Exposed dedicated **Stream Model Responses** (`StreamResponse`) switch under **Settings ➔ Models & AI ➔ Inference Tuning** to toggle real-time token streaming on or off.
  * Connected **Stream Reasoning & Thinking** (`StreamReasoning`) directly to SSE stream delta aggregation in `chat-client.js` so reasoning thoughts can stream or only render upon completion.
  * Added `StreamResponse` to system default configuration schemas across `config_manager.js`, `config.ini`, and UI settings auto-save.

