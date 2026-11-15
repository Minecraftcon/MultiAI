const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Persistent Files Changed Review Bar ===");

// 1. Verify CSS rules in UI/webui/styles/chat.css
const chatCssPath = path.join(__dirname, "../UI/webui/styles/chat.css");
assert(fs.existsSync(chatCssPath), "chat.css must exist");
const chatCss = fs.readFileSync(chatCssPath, "utf-8");
assert(chatCss.includes(".files-changed-bar-container"), "chat.css must contain .files-changed-bar-container");
assert(chatCss.includes(".files-changed-header"), "chat.css must contain .files-changed-header");
assert(chatCss.includes(".files-changed-code-glyph"), "chat.css must contain .files-changed-code-glyph");
assert(chatCss.includes(".files-changed-review-btn"), "chat.css must contain .files-changed-review-btn");
assert(chatCss.includes(".files-changed-dropdown"), "chat.css must contain .files-changed-dropdown");
assert(chatCss.includes(".files-changed-file-row"), "chat.css must contain .files-changed-file-row");
assert(chatCss.includes(".diff-stat-add"), "chat.css must contain .diff-stat-add");
assert(chatCss.includes(".diff-stat-del"), "chat.css must contain .diff-stat-del");
console.log("✓ chat.css files-changed-bar styles verified cleanly.");

// 2. Verify component JS file and exports
const jsPath = path.join(__dirname, "../UI/webui/src/components/files-changed-bar.js");
assert(fs.existsSync(jsPath), "files-changed-bar.js must exist");
const jsContent = fs.readFileSync(jsPath, "utf-8");
assert(jsContent.includes("export function extractTurnFilesChanged"), "Must export extractTurnFilesChanged");
assert(jsContent.includes("export function renderFilesChangedBar"), "Must export renderFilesChangedBar");
assert(jsContent.includes("export async function finalizeTurnFilesChanged"), "Must export finalizeTurnFilesChanged");
assert(jsContent.includes("files-changed-review-btn"), "Must have review button");
assert(jsContent.includes("files-changed-code-glyph"), "Must have { } code glyph");
assert(jsContent.includes("openDiffTab"), "Must open diff tab on file click and review click");
console.log("✓ files-changed-bar.js exports and markup verified cleanly.");

// 3. Verify chat-ui.js integration
const chatUiPath = path.join(__dirname, "../UI/webui/src/components/chat-ui.js");
assert(fs.existsSync(chatUiPath), "chat-ui.js must exist");
const chatUiContent = fs.readFileSync(chatUiPath, "utf-8");
assert(chatUiContent.includes("extractTurnFilesChanged"), "chat-ui.js must import extractTurnFilesChanged");
assert(chatUiContent.includes("renderFilesChangedBar"), "chat-ui.js must import and call renderFilesChangedBar");
assert(chatUiContent.includes("renderFilesChangedBar(aiDiv, turnFiles, finalAssistantMsg)"), "chat-ui.js must render files changed bar in renderTurn");
console.log("✓ chat-ui.js rehydration & persistence integration verified cleanly.");

// 4. Verify orchestrator.js integration
const orchPath = path.join(__dirname, "../UI/webui/src/agent/orchestrator.js");
assert(fs.existsSync(orchPath), "orchestrator.js must exist");
const orchContent = fs.readFileSync(orchPath, "utf-8");
assert(orchContent.includes("finalizeTurnFilesChanged"), "orchestrator.js must import finalizeTurnFilesChanged");
assert(orchContent.includes("turnModifiedFiles"), "orchestrator.js must track turnModifiedFiles");
assert(orchContent.includes("finalizeTurnFilesChanged(session, currentAIMessage, turnModifiedFiles, initialChangesMap)"), "orchestrator.js must finalize turn files changed on completion");
console.log("✓ orchestrator.js turn lifecycle integration verified cleanly.");

// 5. Test logic of extractTurnFilesChanged dynamically
async function testLogic() {
    // Setup dummy global objects for import
    global.window = {};
    global.document = {
        addEventListener() {},
        removeEventListener() {}
    };

    const { extractTurnFilesChanged } = await import("../UI/webui/src/components/files-changed-bar.js");

    // Case A: Explicit filesChanged on final assistant message
    const turnA = {
        aiMessages: [
            { role: "assistant", content: "Working..." },
            { role: "tool", tool_call_id: "t1", content: "{}" },
            {
                role: "assistant",
                content: "Finished editing.",
                filesChanged: [
                    { path: "src/button.js", additions: 10, deletions: 2 },
                    { path: "src/index.js", additions: 1, deletions: 0 }
                ]
            }
        ]
    };
    const filesA = extractTurnFilesChanged(turnA, turnA.aiMessages[2]);
    assert.strictEqual(filesA.length, 2, "Must extract 2 changed files");
    assert.strictEqual(filesA[0].path, "src/button.js");
    assert.strictEqual(filesA[0].additions, 10);
    assert.strictEqual(filesA[1].path, "src/index.js");
    console.log("✓ Logic Case A passed: Explicit finalAssistantMsg.filesChanged extracted.");

    // Case B: Fallback inference from tool calls in turn
    const turnB = {
        aiMessages: [
            {
                role: "assistant",
                tool_calls: [
                    {
                        id: "call_1",
                        function: {
                            name: "replace_file_content",
                            arguments: JSON.stringify({ path: "lib/parser.js", target_content: "a", replacement_content: "b" })
                        }
                    },
                    {
                        id: "call_2",
                        function: {
                            name: "write_file",
                            arguments: JSON.stringify({ path: "lib/new.js", content: "data" })
                        }
                    }
                ]
            },
            { role: "tool", tool_call_id: "call_1", content: "{}" },
            { role: "tool", tool_call_id: "call_2", content: "{}" },
            { role: "assistant", content: "Applied all updates." }
        ]
    };
    const filesB = extractTurnFilesChanged(turnB, turnB.aiMessages[3]);
    assert.strictEqual(filesB.length, 2, "Must infer 2 changed files from tool calls");
    assert.strictEqual(filesB[0].path, "lib/parser.js");
    assert.strictEqual(filesB[1].path, "lib/new.js");
    console.log("✓ Logic Case B passed: Inferred tool calls fallback extracted.");

    // Case C: Non-file tools return empty list
    const turnC = {
        aiMessages: [
            {
                role: "assistant",
                tool_calls: [
                    {
                        id: "call_read",
                        function: {
                            name: "read_file",
                            arguments: JSON.stringify({ path: "README.md" })
                        }
                    }
                ]
            },
            { role: "tool", tool_call_id: "call_read", content: "hello" },
            { role: "assistant", content: "File read successfully." }
        ]
    };
    const filesC = extractTurnFilesChanged(turnC, turnC.aiMessages[2]);
    assert.strictEqual(filesC.length, 0, "Read-only tools must not produce changed files");
    console.log("✓ Logic Case C passed: Read-only turns produce no files changed bar.");

    console.log("\n=== ALL FILES CHANGED REVIEW BAR TESTS PASSED SUCCESSFULLY! ===");
}

testLogic().catch(err => {
    console.error("Logic test failed:", err);
    process.exit(1);
});
