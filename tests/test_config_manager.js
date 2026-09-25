const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
    loadConfig,
    saveConfig,
    parseINI,
    serializeINI,
    DEFAULT_CONFIG
} = require("../src/core/config_manager");

console.log("=== Running Safety Net Tests for Config Manager ===");

// 1. Test parseINI
console.log("Test: parseINI parsing and casting");
{
    const iniText = `
# Comment at top
[General]
Port = 9000
Host = "127.0.0.1"
EnableFeature = true
DisableFeature = false
Temperature = 0.85
QuoteString = "hello world" # inline comment

[Agent]
MaxToolRounds = 0
`;
    const parsed = parseINI(iniText);
    assert.strictEqual(parsed.General.Port, 9000);
    assert.strictEqual(parsed.General.Host, "127.0.0.1");
    assert.strictEqual(parsed.General.EnableFeature, true);
    assert.strictEqual(parsed.General.DisableFeature, false);
    assert.strictEqual(parsed.General.Temperature, 0.85);
    assert.strictEqual(parsed.General.QuoteString, "hello world");
    assert.strictEqual(parsed.Agent.MaxToolRounds, 0);
}

// 2. Test serializeINI
console.log("Test: serializeINI formatting");
{
    const sample = {
        General: { Port: 8080, Host: "0.0.0.0" }
    };
    const ini = serializeINI(sample);
    assert(ini.includes("[General]"));
    assert(ini.includes("Port = 8080"));
    assert(ini.includes("Host = 0.0.0.0"));
}

// 3. Test saveConfig preserving non-updated keys (Bug Fix Verification)
console.log("Test: saveConfig preserves customized keys within section on partial update");
{
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-cfg-test-"));
    const tempConfigPath = path.join(tempDir, "config.ini");

    try {
        // Initial save with customized Port & Host
        saveConfig({
            General: {
                Port: 9999,
                Host: "192.168.1.50",
                DefaultStartupLLM: "gemini-2.5-flash"
            }
        }, tempConfigPath);

        const loaded1 = loadConfig(tempConfigPath);
        assert.strictEqual(loaded1.General.Port, 9999);
        assert.strictEqual(loaded1.General.Host, "192.168.1.50");
        assert.strictEqual(loaded1.General.DefaultStartupLLM, "gemini-2.5-flash");

        // Partial update: only change DefaultStartupLLM in General
        saveConfig({
            General: {
                DefaultStartupLLM: "claude-3-5-sonnet"
            }
        }, tempConfigPath);

        const loaded2 = loadConfig(tempConfigPath);
        assert.strictEqual(loaded2.General.DefaultStartupLLM, "claude-3-5-sonnet");
        // CRITICAL BUG VERIFICATION: Port and Host must NOT be wiped or reset to defaults!
        assert.strictEqual(loaded2.General.Port, 9999, "Custom Port must be preserved on partial update");
        assert.strictEqual(loaded2.General.Host, "192.168.1.50", "Custom Host must be preserved on partial update");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

console.log("✓ ALL CONFIG MANAGER SAFETY NET TESTS PASSED CLEANLY!");
