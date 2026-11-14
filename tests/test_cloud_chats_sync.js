const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const configManager = require("../src/core/config_manager");
const supabaseStorage = require("../src/core/supabase_storage");

async function runTests() {
    console.log("=== Running Cloud Chats Cross-Device Sync Tests ===");

    // Test 1: Verify supabaseStorage exports
    assert.strictEqual(typeof supabaseStorage.getPool, "function", "getPool must be exported");
    assert.strictEqual(typeof supabaseStorage.listChats, "function", "listChats must be exported");
    assert.strictEqual(typeof supabaseStorage.getChat, "function", "getChat must be exported");
    assert.strictEqual(typeof supabaseStorage.saveChat, "function", "saveChat must be exported");
    console.log("✓ Test 1: supabaseStorage exports getPool, listChats, getChat, and saveChat");

    // Setup an isolated sandbox representing Device B (a brand new device with empty storage)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-device-b-"));
    const origGetConfig = configManager.getConfig;
    configManager.getConfig = () => ({
        General: {
            StorageDir: tempDir
        }
    });

    const convManager = require("../src/core/conversations_manager");

    // Test 2: Simulate Device B calling listChats() when local disk is empty
    // Mock supabaseStorage.listChats with sample cloud conversations
    const origListChats = supabaseStorage.listChats;
    const origGetChat = supabaseStorage.getChat;

    const mockCloudChats = [
        {
            id: "chat_cloud_001",
            title: "Hernia Explanation",
            mode: "chat",
            type: "chat",
            projectId: null,
            date: "2026-11-14",
            updatedAt: 1794665000000,
            createdAt: 1794660000000,
            messageCount: 5,
            source: "supabase",
            fromBackend: true,
            workspace: { dateStr: "2026-11-14" }
        },
        {
            id: "chat_cloud_002",
            title: "What does break the bitch means",
            mode: "chat",
            type: "chat",
            projectId: null,
            date: "2026-11-14",
            updatedAt: 1794664000000,
            createdAt: 1794661000000,
            messageCount: 3,
            source: "supabase",
            fromBackend: true,
            workspace: { dateStr: "2026-11-14" }
        }
    ];

    supabaseStorage.listChats = async () => mockCloudChats;

    try {
        const chats = await convManager.listChats();
        assert(Array.isArray(chats), "listChats must return an array");
        assert.strictEqual(chats.length, 2, "Device B must retrieve all 2 cloud chats on empty disk");
        assert.strictEqual(chats[0].id, "chat_cloud_001", "Chats must be sorted with most recent first");
        assert.strictEqual(chats[0].title, "Hernia Explanation");
        assert.strictEqual(chats[0].mode, "chat");
        assert.strictEqual(chats[1].id, "chat_cloud_002");
        assert.strictEqual(chats[1].title, "What does break the bitch means");
        console.log("✓ Test 2: Device B successfully lists all cloud conversations despite clean local disk");

        // Test 3: Device B clicks on a chat -> getChat() fetches from cloud and materializes to disk
        supabaseStorage.getChat = async (id) => {
            if (id === "chat_cloud_001") {
                return {
                    id: "chat_cloud_001",
                    title: "Hernia Explanation",
                    mode: "chat",
                    date: "2026-11-14",
                    updatedAt: 1794665000000,
                    createdAt: 1794660000000,
                    source: "supabase",
                    fromBackend: true,
                    messages: [
                        { role: "system", content: "You are an assistant." },
                        { role: "user", content: "Explain hernia." },
                        { role: "assistant", content: "A hernia occurs when an internal organ pushes through a muscle or tissue." }
                    ]
                };
            }
            return null;
        };

        const loaded = await convManager.getChat("chat_cloud_001");
        assert.ok(loaded, "Chat must be loaded from cloud");
        assert.strictEqual(loaded.session.id, "chat_cloud_001");
        assert.strictEqual(loaded.session.title, "Hernia Explanation");
        assert.strictEqual(loaded.session.messages.length, 3);
        assert.strictEqual(loaded.session.messages[1].content, "Explain hernia.");

        // Verify that disk workspace was materialized
        assert.ok(fs.existsSync(loaded.workspace.messagesFile), "messages.jsonl must be materialized on disk");
        assert.ok(fs.existsSync(loaded.workspace.metaFile), "meta.json must be materialized on disk");

        // Test 4: Second read now resolves locally from disk without calling cloud
        let cloudCalled = false;
        supabaseStorage.getChat = async () => { cloudCalled = true; return null; };
        const secondLoad = await convManager.getChat("chat_cloud_001");
        assert.ok(secondLoad, "Chat should be cached on disk");
        assert.strictEqual(secondLoad.session.messages.length, 3);
        assert.strictEqual(cloudCalled, false, "Local disk cache should be used for subsequent reads");
        console.log("✓ Test 3 & 4: getChat hydrates cloud conversations and caches them to container disk");

        console.log("✓ ALL CLOUD CHATS CROSS-DEVICE SYNC TESTS PASSED!");
    } finally {
        supabaseStorage.listChats = origListChats;
        supabaseStorage.getChat = origGetChat;
        configManager.getConfig = origGetConfig;
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
