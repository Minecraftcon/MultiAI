const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const configManager = require("../src/core/config_manager");
const supabaseStorage = require("../src/core/supabase_storage");

async function runTests() {
    console.log("=== Running Cloud Config Persistence Tests ===");

    // Test 1: Verify supabaseStorage export signatures
    assert.strictEqual(typeof supabaseStorage.saveAppConfig, "function", "saveAppConfig should be a function");
    assert.strictEqual(typeof supabaseStorage.getAppConfig, "function", "getAppConfig should be a function");
    console.log("✓ Test 1: supabaseStorage exports saveAppConfig and getAppConfig");

    // Test 2: Local fallback when Supabase is not connected
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-test-cfg-"));
    const tempCfgPath = path.join(tempDir, "config.ini");

    try {
        const initial = configManager.loadConfig(tempCfgPath);
        assert.ok(initial.General, "Initial config should contain General section");

        const updated = await configManager.saveConfigAsync({
            General: {
                DefaultStartupLLM: "test-model-xyz",
                CustomSystemPrompt: "You are a test assistant.",
                SendKey: "ctrl+enter"
            },
            Agent: {
                Temperature: 0.42
            },
            UI: {
                Scale: 1.15
            }
        }, tempCfgPath);

        assert.strictEqual(updated.General.DefaultStartupLLM, "test-model-xyz");
        assert.strictEqual(updated.General.CustomSystemPrompt, "You are a test assistant.");
        assert.strictEqual(updated.General.SendKey, "ctrl+enter");
        assert.strictEqual(updated.Agent.Temperature, 0.42);
        assert.strictEqual(updated.UI.Scale, 1.15);
        console.log("✓ Test 2: saveConfigAsync updates local config and preserves all custom fields");

        // Test 3: Reloading from disk verifies file serialization
        const reloaded = configManager.loadConfig(tempCfgPath);
        assert.strictEqual(reloaded.General.DefaultStartupLLM, "test-model-xyz");
        assert.strictEqual(reloaded.General.CustomSystemPrompt, "You are a test assistant.");
        assert.strictEqual(reloaded.General.SendKey, "ctrl+enter");
        assert.strictEqual(reloaded.Agent.Temperature, 0.42);
        assert.strictEqual(reloaded.UI.Scale, 1.15);
        console.log("✓ Test 3: Reloading verifies file serialization and casting");

        // Test 4: Verify initCloudConfig does not crash when disconnected
        await configManager.initCloudConfig();
        console.log("✓ Test 4: initCloudConfig safely handles disconnected state without unhandled rejection");

    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }

    console.log("✓ ALL CLOUD CONFIG PERSISTENCE TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
