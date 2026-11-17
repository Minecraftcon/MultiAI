# MultiAI Test Infrastructure & E2E Verification Methodology

This document defines the 4-tier opaque-box test infrastructure and automated verification methodology for MultiAI, governing tools consolidation, UI theme integrity, the Antigravity-replica artifacting system, and right-panel synchronization.

---

## 1. Architecture & Testing Philosophy

MultiAI follows an **opaque-box (black-box / behavioral) testing methodology**. Tests verify observable behaviors, API contracts, file system effects, DOM events, and schema validations against the authoritative requirements in `PROJECT.md` and `ORIGINAL_REQUEST.md` without coupling to internal private implementation details.

### Core Testing Tenets

1. **Progressive Testability**: Tests are designed to verify current milestone capabilities and completed dependencies independently. When a feature has not yet been implemented, the test fails deterministically with actionable diagnostics, establishing an unambiguous verification gate.
2. **Test Independence & Isolation**: Every test creates and tears down its own isolated sandbox in temporary directories (`os.tmpdir()`), leaving zero persistent state, avoiding cross-test side effects, and running without ordering constraints.
3. **Explicit Expected Output Derivation**: Expected outputs are derived authoritatively from documented interface contracts:
   - Tool return signatures: `{ status: "success", path, resolved_path, is_artifact, artifact_metadata? }`
   - Artifact registry structure: `{ artifacts: [ { id, name, path, resolvedPath, summary, userFacing, requestFeedback, size, updatedAt } ] }`
   - Design tokens: Warm Monochrome + Spot Pastels CSS variables in `variables.css`.
4. **Adversarial Verification**: Tests purposefully subject the system to malformed inputs, case variations (`path` vs `Path`), directory traversal attempts, empty/null parameters, and boundary conditions to ensure deterministic, hallucination-preventing error handling.

---

## 2. 4-Tier Opaque-Box Test Hierarchy

```
+-------------------------------------------------------------------------+
|                  Tier 4: Real-World Application Workloads               |
|      (End-to-End Subagent Workflows, Multi-Artifact Milestones)         |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                Tier 3: Cross-Feature Interactions & Events              |
| (Tool Execution -> Artifact Registry -> SSE -> Right Panel Live Sync)   |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                  Tier 2: Boundary & Corner Cases                        |
| (Empty Inputs, Case-Insensitive Keys, Traversal, Malformed Metadata)    |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                     Tier 1: Feature Coverage                            |
| (Tool Consolidation, Preview Auto-Reveal, Theme Integrity, Storage)     |
+-------------------------------------------------------------------------+
```

---

### Tier 1: Feature Coverage (Core Functional Paths)

Tier 1 verifies individual feature behaviors in isolation across tools, themes, storage, and rendering.

#### 1.1 Tool Consolidation & Schemas
- **`show_html_preview` Auto-Reveal**:
  - Invocations of `show_html_preview` must automatically open and focus the workspace preview panel (`window.rightPanel.open()`) and display the rendered HTML in the browser iframe.
  - A separate `toggle_panel` call is strictly prohibited from the designer workflow.
  - `toggle_panel` must be removed from `SUBAGENT_ALLOWED_TOOLS["designer"]`.
- **Anti-Hallucination Schemas**:
  - Parameters across `SERVER_BUILD_TOOLS` (backend) and `UI/webui/src/tools/` must define strict schemas: `type: "object"`, explicit `required` properties array, deterministic error messages for missing parameters, and integer coercion.
  - Synchronize `SERVER_BUILD_TOOLS` with WebUI tools, including `multi_replace_file_content`.
- **Instruct Tool Result Formatting**:
  - `formatToolResult` must produce clean, structured, human-readable instruct strings for task outputs, terminal runs, questionnaire prompts, and file operations.
  - Eliminates escaped raw JSON blobs and trash context to minimize LLM token waste.

#### 1.2 UI Theme Integrity & Aesthetics
- **Theme Token Centralization**:
  - All color tokens must be defined in `UI/webui/styles/variables.css` adhering to Warm Monochrome + Spot Pastels.
  - All 23 component stylesheets in `UI/webui/styles/` and JS components in `UI/webui/src/` must reference `var(--...)` tokens. Zero hardcoded hex (`#...`) or RGB (`rgb(...)` / `rgba(...)`) literals may exist outside `variables.css`.
  - All referenced CSS variables must exist in `variables.css`.
- **Typography & Scrollbars**:
  - Prohibited typefaces (`Roboto`, `Inter`, `Open Sans`) are banned from all CSS and JS files.
  - Scrollbars must be globally styled with theme tokens (`::-webkit-scrollbar` / `scrollbar-color`).
  - No decorative emojis in UI code.

#### 1.3 Native Artifact Storage Hierarchy
- **Storage Segregation**:
  - Artifacts are stored persistently in `${chatDir}/artifacts/` (`$ARTIFACTS`).
  - Ephemeral scratch files are stored in `${chatDir}/scratch/` (`$SCRATCH`).
  - Both Chat Mode (`~/.MultiAI/chat/conversations/{Date}/chats/{chatId}/`) and Build Mode (`~/.MultiAI/build/projects/{projectId}/chats/{chatId}/`) must create and maintain this segregation.
  - Safe path resolution in `src/server/utils.js` converts `$ARTIFACTS` and `$SCRATCH` paths deterministically.

#### 1.4 Artifact Metadata Contracts
- **Tool Parameter Acceptance**:
  - `handleWriteFile` and `handleReplaceFileContent` must accept `ArtifactMetadata` (or `artifact_metadata`):
    - `UserFacing`: boolean (default: true for `$ARTIFACTS`)
    - `Summary`: string (multi-line overview)
    - `RequestFeedback`: boolean (triggers interactive user action buttons)
- **Artifact Registry**:
  - Writing or updating an artifact updates `${chatDir}/artifacts/artifacts.json`.
  - Exposes `/api/artifacts/list?chatId=...` returning the current artifact inventory.

#### 1.5 Markdown & Dedicated Viewer
- **Extended Markdown Rendering**:
  - GitHub-style alert callouts: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.
  - KaTeX math formulas (`$...$` and `$$...$$`).
  - Mermaid diagram generation.
  - Carousels and syntax-highlighted code blocks.
- **Dedicated Artifact Viewer**:
  - Right panel tab `type: "artifact"`.
  - Split view toggle (Rendered Markdown vs Raw Source).
  - Interactive Proceed / Accept action controls when `RequestFeedback: true`.

---

### Tier 2: Boundary & Corner Cases

Tier 2 exposes the system to edge conditions, malformed arguments, and adversarial inputs to guarantee resilience.

| Category | Input Scenario | Expected Behavior |
|----------|----------------|-------------------|
| **Empty Inputs** | `path: ""` or `path: null` to file tools | Throws deterministic error: `Missing 'path' parameter.` |
| **Empty Content** | `content: ""` to `write_file` | Successfully creates 0-byte file without crashing; calculates 0 lines. |
| **Case Sensitivity** | Tool call with `Path` and `Content` (capitalized) | Normalized transparently; tool operates identically to lowercase. |
| **Metadata Aliasing** | `ArtifactMetadata` vs `artifact_metadata` | Both keys parsed into normalized metadata structure. |
| **Malformed Metadata** | `UserFacing: "yes"`, `RequestFeedback: "false"` | Coerced to booleans or rejected with explicit validation message. |
| **Path Traversal** | `path: "$ARTIFACTS/../../etc/passwd"` | Rejected by `resolveSafePath` or confined strictly inside root sandbox. |
| **Unknown Tools** | LLM invokes nonexistent tool name | Returns deterministic error indicating available tools. |
| **Large Payloads** | Writing >2MB file or markdown artifact | Correct byte counting, diff generation without heap exhaustion. |

---

### Tier 3: Cross-Feature Interactions & Events

Tier 3 validates data flow and reactive synchronization between backend services, tools, and the WebUI right panel.

```
+-------------------+      write_file      +------------------------+
|   Subagent / LLM  | -------------------> | src/tools/code_tools   |
+-------------------+                      +------------------------+
                                                       |
                             +-------------------------+-------------------------+
                             |                                                   |
                             v                                                   v
                  +---------------------+                             +--------------------+
                  |  Disk Storage       |                             | artifacts.json     |
                  |  ${chatDir}/...     |                             | Catalog Registry   |
                  +---------------------+                             +--------------------+
                             |                                                   |
                             +-------------------------+-------------------------+
                                                       |
                                                       v
                                            +---------------------+
                                            | SSE Broadcast       |
                                            | "workspace:file"    |
                                            +---------------------+
                                                       |
                                                       v
                                            +---------------------+
                                            | UI Right Panel      |
                                            | Live Sync & Preview |
                                            +---------------------+
```

- **Tool Execution -> Artifact Catalog Sync**:
  Executing `write_file` with `$ARTIFACTS/spec.md` and metadata must atomically write the file to disk AND insert/update the entry in `artifacts.json`.
- **Preview Auto-Reveal**:
  Invoking `show_html_preview` must trigger the right panel open action and activate the browser preview iframe without requiring separate panel toggling.
- **Subagent Persona Isolation**:
  A session running as `designer` subagent cannot execute `toggle_panel` (enforced via tool registry filtering), while retaining full access to file writing and HTML previewing.
- **Theme Cascade Across Panels**:
  Switching theme from `dark` to `midnight` or custom themes cascades through CSS variables into diff viewers, markdown callouts, artifact tabs, and terminal panes.

---

### Tier 4: Real-World Application Workloads

Tier 4 tests realistic end-to-end workflows that simulate real developer interactions.

- **Workflow 4.1: End-to-End Designer Subagent Session**:
  1. User prompts: *"Design a modern landing page for an AI studio."*
  2. Orchestrator invokes `designer` subagent.
  3. Designer subagent reads existing styles and writes `$ARTIFACTS/index.html` with `ArtifactMetadata: { UserFacing: true, Summary: "Landing page", RequestFeedback: true }`.
  4. Designer invokes `show_html_preview(html, title)`.
  5. Right panel automatically reveals and renders the live DOM.
  6. Artifact catalog lists `index.html`.
  7. User clicks "Accept / Proceed" on the artifact feedback banner.
- **Workflow 4.2: Build Milestone Multi-Artifact Generation**:
  1. Build agent develops feature and creates three related artifacts:
     - `$ARTIFACTS/PLAN.md` (architecture overview)
     - `$ARTIFACTS/SCHEMA.json` (data contracts)
     - `$ARTIFACTS/preview.html` (interactive mock)
  2. All three artifacts appear in the right panel artifact tab list with summaries and timestamps.
  3. Ephemeral logs generated during test execution reside strictly in `$SCRATCH/` and do not appear in the artifact catalog.

---

## 3. Automated Verification Suite (`tests/`)

MultiAI includes automated verification scripts in `tests/` executable via standard Node.js:

| Script | Scope & Responsibilities | Exit Code |
|--------|--------------------------|-----------|
| `tests/verify_theme_integrity.js` | Scans all CSS/JS for hardcoded hex/RGB colors, verifies CSS variable declarations in `variables.css`, enforces typeface restrictions (no Roboto/Inter/Open Sans), and checks scrollbar styling. | 0 on clean, 1 on violations |
| `tests/verify_tools_consolidation.js` | Verifies `show_html_preview` auto-open behavior and parameter handling, checks `toggle_panel` removal from designer allowed tools, validates schema consistency between build runner and webui, and tests `formatToolResult` instruct formatting. | 0 on pass, 1 on failure |
| `tests/verify_artifacts_system.js` | Validates `$ARTIFACTS` vs `$SCRATCH` directory isolation in chat and build modes, tests `ArtifactMetadata` validation in `code_tools.js`, verifies `artifacts.json` persistence, and checks the `/api/artifacts/list` endpoint contract. | 0 on pass, 1 on failure |
| `tests/run_all_checks.js` | Master test runner executing all verification scripts, aggregating assertion stats, and reporting forensic diagnostic traces. | 0 if all pass, 1 if any fail |

---

## 4. Running the Verification Suite

Run all verification checks:
```bash
node tests/run_all_checks.js
```

Run individual verification checks:
```bash
node tests/verify_theme_integrity.js
node tests/verify_tools_consolidation.js
node tests/verify_artifacts_system.js
```
