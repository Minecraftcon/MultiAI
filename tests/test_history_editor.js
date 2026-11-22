const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { safelyWriteMessages } = require("../src/core/jsonl_session_store.js");
const conversationsManager = require("../src/core/conversations_manager.js");

async function runTests() {
    console.log("=== Testing History Editor & Force Overwrite Logic ===");

    // 1. Test safelyWriteMessages without forceOverwrite
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai_hist_test_"));
    const msgFile = path.join(tmpDir, "messages.jsonl");

    const initialMessages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "Can you help me?" },
        { role: "assistant", content: "Sure, what do you need?" }
    ];

    safelyWriteMessages(msgFile, initialMessages, true, false);
    assert.strictEqual(fs.existsSync(msgFile), true, "msgFile should exist");

    let lines = fs.readFileSync(msgFile, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 4, "Should have 4 lines initially");

    // 2. Test safelyWriteMessages without forceOverwrite when shorter slice is provided (should protect history)
    const shorterSlice = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" }
    ];
    safelyWriteMessages(msgFile, shorterSlice, true, false);
    lines = fs.readFileSync(msgFile, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 4, "Should still have 4 lines because protection is active without forceOverwrite");

    // 3. Test safelyWriteMessages WITH forceOverwrite: true (explicit history edit/removal)
    safelyWriteMessages(msgFile, shorterSlice, true, true);
    lines = fs.readFileSync(msgFile, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 2, "Should have 2 lines because forceOverwrite was explicitly set to true");
    const parsedLine0 = JSON.parse(lines[0]);
    assert.strictEqual(parsedLine0.content, "Hello");
    const parsedLine1 = JSON.parse(lines[1]);
    assert.strictEqual(parsedLine1.content, "Hi there!");

    console.log("  [PASS] safelyWriteMessages forceOverwrite logic verified.");

    // 4. Test conversationsManager.saveChat with forceOverwrite
    const testChatId = "test_hist_chat_" + Date.now();
    const chatSession = {
        id: testChatId,
        title: "History Editor Test Chat",
        messages: [
            { role: "user", content: "Message 1" },
            { role: "assistant", content: "Response 1" },
            { role: "user", content: "Message 2 (to be deleted)" },
            { role: "assistant", content: "Response 2 (to be deleted)" }
        ]
    };

    const ws = conversationsManager.saveChat(chatSession);
    assert.strictEqual(fs.existsSync(ws.messagesFile), true, "Chat messages file created");
    const initialGet = conversationsManager.getChat(testChatId);
    assert.strictEqual(initialGet.session.messages.length, 4);

    // Now edit chat history: remove last 2 messages and forceOverwrite: true
    const editedSession = {
        id: testChatId,
        title: "History Editor Test Chat (Edited)",
        messages: [
            { role: "user", content: "Message 1" },
            { role: "assistant", content: "Response 1 (modified)" }
        ],
        forceOverwrite: true
    };

    conversationsManager.saveChat(editedSession);
    const updated = conversationsManager.getChat(testChatId);
    assert.strictEqual(updated.session.messages.length, 2, "Updated chat on disk should have exactly 2 messages");
    assert.strictEqual(updated.session.messages[1].content, "Response 1 (modified)");
    assert.strictEqual(updated.session.messageCount, 2, "meta.json messageCount should be updated to 2");
    assert.strictEqual(fs.existsSync(ws.messagesFile + ".bak"), true, "Silent micro-backup .bak file created on disk (Rule 3)");

    console.log("  [PASS] conversationsManager.saveChat with forceOverwrite & silent disk backup verified.");

    // 5. Test index.html contains DOM buttons
    const indexHtml = fs.readFileSync(path.join(__dirname, "../UI/webui/index.html"), "utf8");
    assert(indexHtml.includes('id="chatCtxEditHistoryBtn"'), "index.html must have #chatCtxEditHistoryBtn");
    assert(indexHtml.includes('id="chatEditHistoryBtn"'), "index.html must have #chatEditHistoryBtn");
    assert(indexHtml.includes('href="./styles/history-editor.css"'), "index.html must link history-editor.css");

    console.log("  [PASS] index.html markup and stylesheets verified.");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
        fs.rmSync(ws.chatDir, { recursive: true, force: true });
    } catch (_) {}

    console.log("✓ ALL HISTORY EDITOR TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
