# NEXT: DeepSearch UI & Subsystem Registry

This document tracks the DeepSearch feature in MultiAI:
1. **What was removed from the UI** (the `+` menu item)
2. **Where the code was and how to add it back**
3. **Complete tracking and information of all DeepSearch files** across client, server, services, and tests.

---

## 1. UI Removal Summary (+ Menu DeepSearch)

The DeepSearch toggle card was removed from the composer's **Attachment Bottom Sheet** (`+` button menu in the chat input).

- **Location in DOM**: `#attachSheet` > `.sheet-actions-grid`
- **Trigger**: Clicking `#attachSheetBtn` (`+` button next to textarea) opens the bottom sheet drawer. Previously it showed 3 cards: **Image**, **Documents**, and **Deep Search**. It now cleanly displays 2 cards: **Image** and **Documents**.
- **Reason for Removal**: Keeps the primary conversation input streamlined while preserving the entire underlying multi-agent engine, backend routes, state management, and rendering pipelines intact.

---

## 2. Where It Was & How to Add It Back

### The Removed Markup
The button was located in [`client/index.html`](file:///home/shado/Documents/Web-projects/MultiAI/client/index.html) inside `<div class="sheet-actions-grid">` (directly after `<button id="pickDocBtn">`):

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

### Step-by-Step Restoration Instructions
1. Open [`client/index.html`](file:///home/shado/Documents/Web-projects/MultiAI/client/index.html).
2. Locate the `<div class="sheet-actions-grid">` container around lines 740–765:
   ```html
   <div class="sheet-actions-grid">
       <button id="pickImageBtn" type="button" class="sheet-action-card">...</button>
       <button id="pickDocBtn" type="button" class="sheet-action-card">...</button>
       <!-- PASTE pickDeepSearchBtn HERE -->
   </div>
   ```
3. Paste the removed HTML block shown above right below the `</button>` of `pickDocBtn`.
4. Save the file.
5. **No JavaScript modifications are needed!**
   - [`client/src/components/bottom-sheet.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/bottom-sheet.js) already contains all the event wiring, disabled-state checks (`updateDeepSearchAvailability()`), toast notifications, and state toggling (`setDeepSearchActive()`).
   - When the button element with ID `pickDeepSearchBtn` is present in the DOM, `bottom-sheet.js` automatically binds to it on initialization.

---

## 3. Comprehensive File Tracking & DeepSearch Architecture

All files related to DeepSearch remain fully intact in the codebase. Below is an architectural breakdown of every file, its purpose, and its responsibilities.

### A. Frontend / Client-side Files

| File | Purpose & Responsibilities |
| :--- | :--- |
| [`client/index.html`](file:///home/shado/Documents/Web-projects/MultiAI/client/index.html) | Root HTML template. Contains the attachment drawer structure (`#attachSheet`, `#attachBackdrop`, `.sheet-actions-grid`). |
| [`client/src/components/bottom-sheet.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/bottom-sheet.js) | Handles the attachment sheet drawer gestures and click handlers. Manages `updateDeepSearchAvailability()` (restricting DeepSearch to new chats without messages), badges ("ON", "OFF", "NEW CHATS ONLY"), and calls `setDeepSearchActive()`. |
| [`client/src/components/chatbox.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/chatbox.js) | Composer controller. Hosts `#attachSheetBtn` (`+` button), handles `#deepSearchPill` (active mode pill inside composer dock with close `X` button), and listens to the window event `"deepsearch-state-changed"`. |
| [`client/src/components/deepsearch-bar.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/deepsearch-bar.js) | Live polling & UI widget for active research tasks. Renders progress bar, step counter, live queries searched, page scrape count, stop button, and logs accordion. Polls `/api/deepsearch/status/:id`. |
| [`client/src/components/renderer.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/renderer.js) | Markdown renderer with dedicated support for DeepSearch research plans. Contains `renderDeepSearchStepper(rawText)` to format ```` ```plan ```` or ```` ```stepper ```` codeblocks into connected roadmap stepper cards. |
| [`client/src/components/side-panel.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/components/side-panel.js) | Chat session switcher. Reads `session.isDeepSearch`, resumes DeepSearch polling if switching into a chat with an active job (`/api/deepsearch/chat/:id`), and resets `setDeepSearchActive(false)` when starting a fresh chat. |
| [`client/src/state/store.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/state/store.js) | Central state store containing `isDeepSearchActive: false`. |
| [`client/src/state/actions.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/state/actions.js) | Action creator `setDeepSearchActive(active)`: toggles state flag and dispatches `"deepsearch-state-changed"` custom DOM event. |
| [`client/src/tools/index.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/tools/index.js) | Defines `getDeepSearchOnChatTools()` to restrict available tools in DeepSearch chats to isolated execution sandboxes. |
| [`client/src/tools/filesystem/artifact-writer.js`](file:///home/shado/Documents/Web-projects/MultiAI/client/src/tools/filesystem/artifact-writer.js) | Tool for saving multi-step research reports and synthesized findings as downloadable project artifacts. |
| [`client/styles/chat.css`](file:///home/shado/Documents/Web-projects/MultiAI/client/styles/chat.css) | Styles for `.deepsearch-stats-box`, `.deepsearch-stepper`, `.deepsearch-plan-card`, and research progress indicators. |
| [`client/styles/composer.css`](file:///home/shado/Documents/Web-projects/MultiAI/client/styles/composer.css) | Styles for bottom sheet action cards (`.sheet-action-card`, `.sheet-actions-grid`) and composer mode pills (`#deepSearchPill`). |

---

### B. Backend / Server-side Files

| File | Purpose & Responsibilities |
| :--- | :--- |
| [`src/server/routes/deepsearch.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/server/routes/deepsearch.js) | Dedicated HTTP REST route handler: <br>• `POST /api/deepsearch/start` (initiates multi-agent job)<br>• `GET /api/deepsearch/status/:id` (polls job progress & logs)<br>• `POST /api/deepsearch/stop/:id` (aborts execution)<br>• `GET /api/deepsearch/chat/:chatId` (retrieves job for session) |
| [`src/server/router.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/server/router.js) | Top-level HTTP router. Matches `/api/deepsearch/` prefix and forwards requests to `src/server/routes/deepsearch.js`. |
| [`src/services/deepsearch/manager.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/manager.js) | Job supervisor and lifecycle manager. Stores active/archived jobs, coordinates state updates, handles abort signals, and streams progress milestones. |
| [`src/services/deepsearch/graph.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/graph.js) | LangGraph multi-agent research workflow: <br>1. **Planner**: Analyzes query, forms research questions, and creates execution roadmap.<br>2. **Researcher**: Dispatches search queries, scrapes web pages, and synthesizes source extracts.<br>3. **Synthesizer / Reviewer**: Validates evidence, summarizes findings, and generates final comprehensive markdown document. |
| [`src/services/deepsearch/tools.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/tools.js) | Tool bindings for the research graph agents (search provider invocation, URL reader, summarizer). |
| [`src/services/deepsearch/engines/duckduckgo.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/engines/duckduckgo.js) | Search engine connector querying DuckDuckGo for live web links and snippets without requiring API keys. |
| [`src/services/deepsearch/engines/google.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/engines/google.js) | Google Custom Search API connector. |
| [`src/services/deepsearch/engines/google_grounding.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/engines/google_grounding.js) | Gemini-native Google Search Grounding provider. |
| [`src/services/deepsearch/engines/fetch_page.js`](file:///home/shado/Documents/Web-projects/MultiAI/src/services/deepsearch/engines/fetch_page.js) | Web page scraper that downloads, parses HTML, and extracts clean markdown/text content for agent analysis. |

---

### C. Test Files

| File | Purpose & Responsibilities |
| :--- | :--- |
| [`tests/test_live_deepsearch.js`](file:///home/shado/Documents/Web-projects/MultiAI/tests/test_live_deepsearch.js) | End-to-end integration test verifying that the research graph compiles, queries search engines, and produces structured output. |
| [`tests/test_deepsearch_isolated_tools.js`](file:///home/shado/Documents/Web-projects/MultiAI/tests/test_deepsearch_isolated_tools.js) | Verifies tool security isolation so DeepSearch sessions only invoke safe research tools and cannot execute unauthorized tools. |
| [`tests/test_complete_screenshot.js`](file:///home/shado/Documents/Web-projects/MultiAI/tests/test_complete_screenshot.js) | Automated Puppeteer visual test verifying full UI layout, stepper rendering, and composer sheet behavior. |
