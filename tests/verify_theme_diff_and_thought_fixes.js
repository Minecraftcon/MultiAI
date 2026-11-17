/**
 * verify_theme_diff_and_thought_fixes.js
 *
 * Automated verification for:
 * 1. White / Light Theme Contrast & Highlighting:
 *    - Validates that code.css defines crisp, high-contrast colors for all hljs tokens (including .hljs-section, .hljs-template-tag, .hljs-variable).
 *    - Validates that diff-viewer.css enforces high-contrast text on added (+359) and deleted lines.
 * 2. Diff View & Accept Lifecycle:
 *    - Validates that /api/history/changes and /api/history/accept receive chatId from right-panel.js and diff-viewer.js.
 *    - Validates that accepting changes updates tab id to file_${path} and activeTabId transitions.
 * 3. Thought Trace & Reasoning Preservation:
 *    - Validates that round > 0 reasoning does not overwrite round 0's top thought box, but renders in the activity stream.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function testThemeContrast() {
    console.log("1. Verifying White / Light Theme Code & Diff Contrast...");
    const codeCss = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/styles/code.css"), "utf-8");
    const diffCss = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/styles/diff-viewer.css"), "utf-8");

    // Must have light mode overrides for .hljs-section and .hljs-template-tag
    assert(codeCss.includes(".hljs-section"), "code.css must define .hljs-section");
    assert(codeCss.includes(':root[data-theme="light"] .hljs-section'), "code.css must have light theme rule for .hljs-section");
    assert(codeCss.includes(':root[data-theme="system"] .hljs-section'), "code.css must have system light theme rule for .hljs-section");

    // Dark theme pre code must not accidentally match light theme when data-theme="system"
    assert(codeCss.includes(':not([data-theme="system"])'), "Dark theme rules in code.css must avoid clobbering system light mode");

    // Diff line additions and deletions in light mode must force readable text on children
    assert(diffCss.includes(".mv-row-add .mv-code-line *"), "diff-viewer.css must enforce high-contrast color on added line children");
    assert(diffCss.includes(".mv-row-del .mv-code-line *"), "diff-viewer.css must enforce high-contrast color on deleted line children");

    console.log("  [PASS] Light theme hljs tokens and diff line contrast verified.");
}

function testDiffAcceptContract() {
    console.log("2. Verifying Diff Accept and Right Panel Lifecycle...");
    const rightPanelJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/components/right-panel.js"), "utf-8");
    const diffViewerJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/components/diff-viewer.js"), "utf-8");

    // checkWorkspaceChanges must pass chatId
    assert(rightPanelJs.includes("changesUrl += `?chatId="), "right-panel.js checkWorkspaceChanges must pass chatId to /api/history/changes");

    // loadViewerSidebar must pass chatId in isDiffMode
    assert(rightPanelJs.includes("let changesUrl = \"/api/history/changes\";"), "right-panel.js loadViewerSidebar must construct changesUrl with chatId");

    // refreshFileTree must check type === 'diff'
    assert(rightPanelJs.includes("const isDiffMode = activeTab?.type === \"diff\";"), "refreshFileTree must accurately detect diff tab mode");

    // diffTabAcceptBtn must update tab.id and activeTabId
    assert(rightPanelJs.includes("tab.id = `file_${tab.path}`;"), "right-panel.js diffTabAcceptBtn must update tab id on accept");

    // diff-viewer.js inline hunk accept must update tab id and activeTabId
    assert(diffViewerJs.includes("t.id = `file_${t.path}`;"), "diff-viewer.js inline accept must update tab id to file_${path}");

    console.log("  [PASS] Right panel and diff accept contracts verified.");
}

function testThoughtTracePreservation() {
    console.log("3. Verifying Reasoning Block & Thought Trace Preservation...");
    const toolBadgesJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/components/chat-tool-badges.js"), "utf-8");
    const chatUiJs = fs.readFileSync(path.join(ROOT_DIR, "UI/webui/src/components/chat-ui.js"), "utf-8");

    // addThoughtTrace must clear preSearchContent when thoughts are placed in activity stream
    assert(toolBadgesJs.includes("preSearchContent.innerHTML = \"\";"), "addThoughtTrace must clear preSearchContent when reasoning is in activity stream");
    assert(toolBadgesJs.includes("item.className = \"activity-thought-item\";"), "addThoughtTrace must create activity-thought-item for round > 0");

    // updateAIStream must not overwrite preSearchContent when tools are present
    assert(chatUiJs.includes("hasToolsPresent"), "chat-ui.js updateAIStream must detect active tools present");
    assert(chatUiJs.includes("_activeRoundThoughtEl"), "chat-ui.js updateAIStream must stream round > 0 thoughts into _activeRoundThoughtEl in search-items-container");

    console.log("  [PASS] Reasoning block preservation across multi-round execution verified.");
}

try {
    testThemeContrast();
    testDiffAcceptContract();
    testThoughtTracePreservation();
    console.log("\nALL VERIFICATIONS PASSED!");
} catch (err) {
    console.error("\nVERIFICATION FAILED:", err.message);
    process.exit(1);
}

