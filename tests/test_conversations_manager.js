const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const configManager = require("../src/core/config_manager");

// Create temporary isolated sandbox for tests
const tmpBase = path.join(os.tmpdir(), "multiai-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
fs.mkdirSync(tmpBase, { recursive: true });

// Monkey-patch getConfig to use our test sandbox directory
const origGetConfig = configManager.getConfig;
configManager.getConfig = () => ({
    General: {
        StorageDir: tmpBase
    }
});

const convManager = require("../src/core/conversations_manager");

console.log("=== Running Characterization Tests for Conversations Manager ===");

try {
    // 1. Utilities
    console.log("Test: resolveHome & formatDate");
    assert(convManager.resolveHome("~").length > 1);
    assert.strictEqual(convManager.resolveHome("/tmp/test"), path.resolve("/tmp/test"));
    assert.strictEqual(convManager.formatDate(new Date("2026-09-25T12:00:00Z").getTime()), "2026-09-25");

    // 2. Chat Workspace Scaffolding
    console.log("Test: ensureChatWorkspace");
    const ws = convManager.ensureChatWorkspace("chat-abc-123", "2026-09-25");
    assert.strictEqual(ws.chatId, "chat-abc-123");
    assert.strictEqual(ws.dateStr, "2026-09-25");
    assert(fs.existsSync(ws.chatDir), "chatDir should exist");
    assert(fs.existsSync(ws.scratchDir), "scratchDir should exist");
    assert(fs.existsSync(ws.artifactsDir), "artifactsDir should exist");
    assert(fs.existsSync(ws.imagesDir), "imagesDir should exist");
    assert(ws.workspacePrompt.includes("$SCRATCH"), "Prompt must define $SCRATCH");
    assert(ws.workspacePrompt.includes("$ARTIFACTS"), "Prompt must define $ARTIFACTS");
    assert(ws.workspacePrompt.includes("chat-abc-123"), "Prompt must contain chat ID");

    // 3. Save Chat & Get Chat
    console.log("Test: saveChat & getChat");
    const sessionData = {
        id: "chat-abc-123",
        title: "Test Conversation Title",
        model: "gemini-2.5-flash",
        createdAt: Date.now() - 10000,
        updatedAt: Date.now(),
        messages: [
            { role: "system", content: "You are an assistant." },
            { role: "user", content: "Hello world" },
            { role: "assistant", content: "Greetings! How can I help you?" }
        ],
        compactionState: {
            summary: "User said hello.",
            compactedThroughIndex: 1
        }
    };

    convManager.saveChat(sessionData);
    assert(fs.existsSync(ws.metaFile), "meta.json must exist");
    assert(fs.existsSync(ws.messagesFile), "messages.jsonl must exist");
    assert(fs.existsSync(ws.contextFile), "context.json must exist");

    const loaded = convManager.getChat("chat-abc-123");
    assert(loaded, "Chat must be loaded");
    assert.strictEqual(loaded.session.id, "chat-abc-123");
    assert.strictEqual(loaded.session.title, "Test Conversation Title");
    assert.strictEqual(loaded.session.messages.length, 3);
    assert.strictEqual(loaded.session.messages[1].content, "Hello world");
    assert.strictEqual(loaded.session.compactionState?.summary, "User said hello.");

    // 4. Append Chat Message
    console.log("Test: appendChatMessage");
    convManager.appendChatMessage("chat-abc-123", { role: "user", content: "What is 2+2?" });
    const afterAppend = convManager.getChat("chat-abc-123");
    assert.strictEqual(afterAppend.session.messages.length, 4);
    assert.strictEqual(afterAppend.session.messages[3].content, "What is 2+2?");
    assert.strictEqual(afterAppend.session.messageCount, 4);

    // 5. Truncation Protection (safelyWriteMessages)
    console.log("Test: truncation protection on saveChat");
    // 5a. Saving a smaller trailing slice should NOT truncate disk history
    const sliceOnly = {
        id: "chat-abc-123",
        title: "Test Conversation Title",
        messages: [
            { role: "user", content: "What is 2+2?" }
        ]
    };
    convManager.saveChat(sliceOnly);
    const afterSliceSave = convManager.getChat("chat-abc-123");
    assert.strictEqual(afterSliceSave.session.messages.length, 4, "Must preserve all 4 messages when saving slice");

    // 5b. Saving slice with new turn appended should merge onto disk
    const sliceWithNewTurn = {
        id: "chat-abc-123",
        title: "Test Conversation Title",
        messages: [
            { role: "user", content: "What is 2+2?" },
            { role: "assistant", content: "4" }
        ]
    };
    convManager.saveChat(sliceWithNewTurn);
    const afterMergeSave = convManager.getChat("chat-abc-123");
    assert.strictEqual(afterMergeSave.session.messages.length, 5, "Must merge new turn to total 5 messages");
    assert.strictEqual(afterMergeSave.session.messages[4].content, "4");

    // 6. List Chats & Delete Chat
    console.log("Test: listChats & deleteChat");
    const chatsList = convManager.listChats();
    assert(Array.isArray(chatsList));
    const foundChat = chatsList.find(c => c.id === "chat-abc-123");
    assert(foundChat, "chat-abc-123 must appear in listChats");
    assert.strictEqual(foundChat.title, "Test Conversation Title");

    const deleted = convManager.deleteChat("chat-abc-123");
    assert.strictEqual(deleted, true);
    assert.strictEqual(convManager.getChat("chat-abc-123"), null);

    // 7. Build Mode Projects
    console.log("Test: Build Mode Projects & Project Chats");
    const fakeProjectFolder = path.join(tmpBase, "sample-project");
    fs.mkdirSync(fakeProjectFolder, { recursive: true });

    const proj = convManager.addProject(fakeProjectFolder, "Sample Workspace Project");
    assert(proj && proj.id, "Project must have id");
    assert.strictEqual(proj.name, "Sample Workspace Project");
    assert.strictEqual(proj.rootPath, fakeProjectFolder);

    const projectsList = convManager.listProjects();
    assert(projectsList.some(p => p.id === proj.id));

    // Scaffolding Project Chat
    const pWs = convManager.ensureProjectChatWorkspace(proj.id, "build-chat-001");
    assert(fs.existsSync(pWs.chatDir));
    assert(pWs.workspacePrompt.includes("BUILD WORKSPACE - PROJECT CONTEXT"));
    assert.strictEqual(pWs.projectRoot, fakeProjectFolder);

    // Save and Get Project Chat
    convManager.saveProjectChat(proj.id, {
        id: "build-chat-001",
        title: "Refactor task",
        messages: [
            { role: "user", content: "Run refactor" },
            { role: "assistant", content: "Refactor complete." }
        ]
    });

    const pLoaded = convManager.getProjectChat(proj.id, "build-chat-001");
    assert(pLoaded);
    assert.strictEqual(pLoaded.session.title, "Refactor task");
    assert.strictEqual(pLoaded.session.messages.length, 2);

    const pChats = convManager.listProjectChats(proj.id);
    assert(pChats.some(c => c.id === "build-chat-001"));

    // Delete project chat and remove project
    assert.strictEqual(convManager.deleteProjectChat(proj.id, "build-chat-001"), true);
    assert.strictEqual(convManager.getProjectChat(proj.id, "build-chat-001"), null);

    assert.strictEqual(convManager.removeProject(proj.id), true);
    const afterRemoveProjects = convManager.listProjects();
    assert(!afterRemoveProjects.some(p => p.id === proj.id));

    console.log("✓ ALL CONVERSATIONS MANAGER CHARACTERIZATION TESTS PASSED CLEANLY!");
} finally {
    // Restore configManager and clean up sandbox
    configManager.getConfig = origGetConfig;
    try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (_) {}
}
