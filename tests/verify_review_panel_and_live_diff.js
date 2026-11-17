import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    renderDiffCardHtml,
    renderStackedReviewHtml,
    parseUnifiedDiff,
    getLanguageMeta
} from "../UI/webui/src/components/diff-viewer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

console.log("================================================================================");
console.log(" REVIEW PANEL & LIVE DIFFING CONTRACT VERIFICATION");
console.log("================================================================================");

// 1. Language Meta & Badges
console.log("1. Verifying Language Metadata & Badges...");
const jsMeta = getLanguageMeta("UI/webui/src/state/actions.js");
assert.strictEqual(jsMeta.shortBadge, "JS");
assert.strictEqual(jsMeta.color, "#f7df1e");

const tsMeta = getLanguageMeta("src/core/runner.ts");
assert.strictEqual(tsMeta.shortBadge, "TS");

const pyMeta = getLanguageMeta("backend/app.py");
assert.strictEqual(pyMeta.shortBadge, "PY");

console.log("  [PASS] Language metadata and badge shortcodes verified.");

// 2. Diff Card Header & Dual Gutter Line Numbers
console.log("2. Verifying Diff Card Header, Dual Gutters & Hunk Expander Dividers...");
const sampleDiff = `--- a/UI/webui/src/state/actions.js
+++ b/UI/webui/src/state/actions.js
@@ -70,3 +72,15 @@
+/**
+ * Sets the configured agents list.
+ */
+export function setAgents(agents) {
+    state.agents = Array.isArray(agents) ? agents : [];
+}
+
+/**
+ * Sets the currently active Agent ID.
+ */
+export function setCurrentAgentId(agentId) {
+    state.currentAgentId = agentId || null;
+}
@@ -113,3 +127,3 @@
     state.isDeepSearchActive = Boolean(active);
 }
`;

const cardHtml = renderDiffCardHtml({
    diffStr: sampleDiff,
    filePath: "UI/webui/src/state/actions.js",
    stats: { additions: 17, deletions: 3 }
});

assert(cardHtml.includes('class="mv-lang-badge js"'), "Must render language badge pill");
assert(cardHtml.includes('JS</span>'), "Must render JS badge text");
assert(cardHtml.includes('class="mv-filename"'), "Must render filename container");
assert(cardHtml.includes('actions.js</span>'), "Must render actions.js basename");
assert(cardHtml.includes('class="mv-dirpath"'), "Must render directory path container");
assert(cardHtml.includes('UI/webui/src/state</span>'), "Must render directory path UI/webui/src/state");
assert(cardHtml.includes('class="mv-stat add">+17</span>'), "Must render green additions count +17");
assert(cardHtml.includes('class="mv-stat del">-3</span>'), "Must render red deletions count -3");
assert(cardHtml.includes('class="mv-collapse-btn"'), "Must render collapse/expand chevron toggle");
assert(cardHtml.includes('class="mv-gutter dual"'), "Must render dual gutter");
assert(cardHtml.includes('class="mv-old-num"'), "Must render old line number column");
assert(cardHtml.includes('class="mv-new-num"'), "Must render new line number column");
assert(cardHtml.includes('class="mv-hunk-divider"'), "Must render mockup hunk expander divider");
assert(cardHtml.includes('class="mv-hunk-pill"'), "Must render centered hunk pill");
assert(cardHtml.includes('class="mv-hunk-micro-btn"'), "Must render +10 micro-buttons");

console.log("  [PASS] Header, dual gutter, and hunk expander divider markup verified.");

// 3. Multi-File Stacked Review Stream
console.log("3. Verifying Multi-File Stacked Review Stream...");
const files = [
    {
        path: "UI/webui/src/state/actions.js",
        displayPath: "UI/webui/src/state/actions.js",
        diff: sampleDiff,
        stats: { additions: 17, deletions: 3 }
    },
    {
        path: "UI/webui/src/state/store.js",
        displayPath: "UI/webui/src/state/store.js",
        diff: `--- a/UI/webui/src/state/store.js
+++ b/UI/webui/src/state/store.js
@@ -1,3 +1,3 @@
 /* CENTRAL REACTIVE APPLICATION STATE STORE */
@@ -14,2 +14,4 @@
+    agents: [],
+    currentAgentId: null,
`,
        stats: { additions: 2, deletions: 0 }
    }
];

const stackedHtml = renderStackedReviewHtml({ files });
assert(stackedHtml.includes('class="mv-stacked-review-container"'), "Must render stacked review container");
assert(stackedHtml.includes('class="mv-review-summary-bar"'), "Must render review summary bar");
assert(stackedHtml.includes('2 files changed'), "Must display total files changed count");
assert(stackedHtml.includes('+19</span>'), "Must aggregate total additions count (+19)");
assert(stackedHtml.includes('-3</span>'), "Must aggregate total deletions count (-3)");
assert(stackedHtml.includes('id="reviewExpandAllBtn"'), "Must provide Expand All button");
assert(stackedHtml.includes('id="reviewCollapseAllBtn"'), "Must provide Collapse All button");
assert(stackedHtml.includes('id="reviewAcceptAllBtn"'), "Must provide Accept All button");
assert(stackedHtml.includes('id="reviewRevertAllBtn"'), "Must provide Revert All button");
assert(stackedHtml.includes('actions.js</span>'), "Must stack actions.js diff card");
assert(stackedHtml.includes('store.js</span>'), "Must stack store.js diff card");

console.log("  [PASS] Stacked multi-file review stream verified.");

// 4. Live Diffing Hook in Right Panel & Orchestrator
console.log("4. Verifying Live Diffing & Workspace Event Handlers...");
const rightPanelJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/components/right-panel.js"), "utf-8");
const orchestratorJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/agent/orchestrator.js"), "utf-8");

assert(rightPanelJs.includes('renderReviewTab'), "Right panel must implement renderReviewTab");
assert(rightPanelJs.includes('renderStackedReviewHtml'), "Right panel must import renderStackedReviewHtml");
assert(rightPanelJs.includes('activeTab?.type === "review"'), "Right panel must live-update review tab in refreshFileTree");
assert(rightPanelJs.includes('activeTab?.type === "diff"'), "Right panel must live-update diff tab in refreshFileTree");
assert(orchestratorJs.includes('workspace-files-changed'), "Orchestrator must dispatch workspace-files-changed on file modifications");

console.log("  [PASS] Live diffing hooks and event subscriptions verified.");

console.log("================================================================================");
console.log("ALL REVIEW PANEL & LIVE DIFFING VERIFICATIONS PASSED!");
console.log("================================================================================");

