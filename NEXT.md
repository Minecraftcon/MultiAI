# MultiAI: Upcoming Milestones & Architectural Roadmap (NEXT.md)

This living roadmap tracks active development priorities, architectural specifications, and subsystem registries for MultiAI.

---

## 1. Active Priority 1: Agent Execution Isolation & Sandboxing

### The Problem
In Build Mode and Agent workflows, the model can execute shell commands via `run_task` (`start.py` / Python task runner on port 5000) and modify files via file tools. Without sandboxing, an autonomous agent can:
- Accidentally or intentionally overwrite core server code outside the project root (e.g. `src/server/utils.js`).
- Mutate user configuration templates (e.g. `src/core/config.ini`).
- Access sensitive dotfiles in the host home directory (`~/.ssh`, `~/.config`, `~/.bashrc`).

### The Two-Layer Isolation Architecture

```
                              ┌─────────────────────────────────────────┐
                              │            MultiAI Enforcer             │
                              └────────────────────┬────────────────────┘
                                                   │
                   ┌───────────────────────────────┴───────────────────────────────┐
                   ▼                                                               ▼
        [Layer 1: Native Tools]                                         [Layer 2: run_task Execution]
    read_file / write_file / list_dir                                  Shell commands & Python scripts
                   │                                                               │
  Enforce strict path boundary in JS:                             Detect host environment automatically:
  • Path MUST resolve within Project Root,                        • Desktop Linux -> Bubblewrap (`bwrap`)
    $SCRATCH, or $ARTIFACTS.                                      • Termux / Android -> `proot`
  • Access to ~, /etc, parent dirs -> REJECTED.                   • Fallback -> User-confirmed unconfined
```

#### Layer 1: JS-Level Path Boundary Enforcement (Immediate & Zero Overhead)
- **Target File**: [`src/server/utils.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/server/utils.js) -> `resolveSafePath(inputPath, chatId)`
- **Behavior**:
  - Resolve canonical paths for:
    1. Active Project Root (`wsContext.project.rootPath`)
    2. Chat Scratchpad Directory (`getChatScratchDir(chatId)`)
    3. Chat Artifacts Directory (`getChatArtifactsDir(chatId)`)
  - If a path resolves outside all three allowed roots, throw a strict `PermissionDeniedError`:
    ```
    Access Denied: Path '/home/shado/Documents/Web-projects/MultiAI/src/server/utils.js' is outside the active project workspace.
    ```
  - Eliminates rogue direct edits from `write_file`, `read_file`, and `list_dir`.

#### Layer 2: Command Execution Sandbox (`run_task`)
- **Target Files**: 
  - `start.py` (Local Task Daemon port 5000)
  - [`src/server/routes/tasks.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/server/routes/tasks.js)
  - [`src/core/config.ini`](file:///home/shado/Documents/Web-projects/MultiAI/src/core/config.ini)
- **Engine Selection**:
  1. **Desktop Linux -> Bubblewrap (`bwrap`)**:
     - Uses unprivileged user namespaces (`CLONE_NEWUSER`). Requires no root.
     - Mounts host `/usr`, `/lib`, `/bin` **read-only**.
     - Binds `/tmp` as ephemeral `tmpfs`.
     - Completely masks `~/.ssh` and host home directory.
     - Mounts **read-write ONLY** to `$PROJECT_DIR` and `$SCRATCH_DIR`.
     ```bash
     bwrap --ro-bind / / \
           --bind "$PROJECT_DIR" "$PROJECT_DIR" \
           --bind "$SCRATCH_DIR" "$SCRATCH_DIR" \
           --tmpfs /tmp \
           --dev /dev \
           --unshare-pid \
           --dir /run/user/$(id -u) \
           bash -c "$CMD"
     ```
  2. **Rootless Android (Termux) -> `proot`**:
     - Bubblewrap cannot run on Android because Android kernels disable `CONFIG_USER_NS` and block unprivileged user namespaces.
     - `proot` (`pkg install proot`) uses user-space `ptrace` syscall interception, which is **100% rootless** and supported by Android.
     - Maps host project root and scratch directory, preventing access to the Termux home or Android storage outside the workspace:
     ```bash
     proot -b "$PROJECT_DIR":/workspace -b "$SCRATCH_DIR":/scratch -b "$PREFIX":/usr -w /workspace bash -c "$CMD"
     ```
- **Configuration Spec (`config.ini`)**:
  ```ini
  [Security]
  Isolation = auto        # auto | bwrap | proot | none
  AllowNetwork = true     # allow outbound network during build tasks
  ProtectDotfiles = true  # hide ~/.ssh, ~/.config, ~/.env outside workspace
  ```

---

## 2. Active Priority 2: Safe Streaming & Live Long-Think Reasoning

### The Problem
Modern reasoning models (DeepSeek-R1, OpenAI o1/o3/o4-mini, Claude 3.7 Sonnet Extended Thinking, Gemini 2.5 Flash Thinking) produce thousands of reasoning tokens before emitting an answer. In MultiAI:
- Current `/api/chat` waits for the complete HTTP response, leaving the user with a blank "Working... (Xs)" spinner for 30–90 seconds.
- Previous streaming attempts broke the UI due to:
  1. **HTML & Markdown Parser Tearing**: Calling `parseMarkdown()` on incomplete chunks (`<think`, unclosed ````python`) broke DOM structure.
  2. **Thought vs Content Collision**: Streaming reasoning and final answer into the same container caused text jumping and re-renders.
  3. **Tool Call Leaks**: Partial JSON chunks (`{"command": ...}`) leaked into the message bubble.
  4. **DOM Thrashing**: Rendering at 100Hz token arrival frequency caused scroll jank and high CPU usage.

### The Solution Architecture

1. **Structured SSE Protocol (`/api/chat/stream`)**:
   Segregate streams by event type:
   - `event: thought` -> Live reasoning tokens
   - `event: tool_call` -> Live function call arguments
   - `event: text` -> Live user-facing markdown tokens
   - `event: done` -> Final message, duration, token usage

2. **Frontend Dual-Buffer Engine**:
   - [`client/src/components/chat-ui.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/chat-ui.js) maintains two distinct in-memory buffers: `thoughtBuffer` and `contentBuffer`.
   - `thoughtBuffer` streams directly into `.thought-box .thought-content` with a live stopwatch (`Thinking... 12s`).
   - When the first `event: text` arrives, `.thought-box` collapses (or marks duration: `Thought for 12.4s`) and `contentBuffer` streams into `.final-content`.

3. **`requestAnimationFrame` (RAF) 30 FPS Throttling**:
   - Token chunks append to memory instantly.
   - DOM updates are batched through a 30 FPS RAF loop (every ~30ms).
   - Heavy post-processing (Prism syntax highlighting, Mermaid charts, KaTeX math) is deferred until `event: done`.

4. **Stream-Tolerant Markdown Helper**:
   - Detect unclosed code blocks (```````) in the buffer and append a virtual closing delimiter before parsing to prevent layout reflow during active typing.

---

## 3. Subsystem Registry: DeepSearch

The DeepSearch subsystem remains fully intact across the codebase. The composer `+` bottom-sheet toggle card was detached to streamline conversational input.

### Quick Restoration Guide
To re-enable the DeepSearch card in the `+` menu:
1. Open [`client/index.html`](file:///home/shado/Documents/Web-projects/MultiAI/client/index.html).
2. Inside `<div class="sheet-actions-grid">` (after `pickDocBtn`), insert:
   ```html
   <button id="pickDeepSearchBtn" type="button" class="sheet-action-card">
       <div class="sheet-action-icon search-icon-bg">
           <i data-lucide="compass"></i>
       </div>
       <div class="sheet-action-text">
           <div class="sheet-action-title-row">
               <span class="sheet-action-title">Deep Search</span>
               <span class="sheet-action-badge" id="deepSearchSheetBadge">OFF</span>
           </div>
           <span class="sheet-action-desc" id="deepSearchSheetDesc">Multi-agent research (New chats only)</span>
       </div>
   </button>
   ```
3. [`client/src/components/bottom-sheet.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/bottom-sheet.js) automatically binds to `#pickDeepSearchBtn` on load. No JS changes are needed.

### DeepSearch Architecture & File Map
- **Route Handler**: [`src/server/routes/deepsearch.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/server/routes/deepsearch.js) (`/api/deepsearch/*`)
- **Research Graph**: [`src/services/deepsearch/graph.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/graph.js) (Planner -> Researcher -> Synthesizer)
- **Lifecycle Manager**: [`src/services/deepsearch/manager.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/manager.js)
- **Search Engines**: [`src/services/deepsearch/engines/`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/engines/) (DuckDuckGo, Google, Google Grounding, Fetch Page)
- **UI Progress Bar**: [`client/src/components/deepsearch-bar.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/deepsearch-bar.js)
- **Stepper Renderer**: [`client/src/components/renderer.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/renderer.js) (`renderDeepSearchStepper`)
- **Tests**: [`tests/test_live_deepsearch.js`](file:///home/shado/Documents/Web-projects/MultiAI/tests/test_live_deepsearch.js), [`tests/test_deepsearch_isolated_tools.js`](file:///home/shado/Documents/Web-projects/MultiAI/tests/test_deepsearch_isolated_tools.js)
