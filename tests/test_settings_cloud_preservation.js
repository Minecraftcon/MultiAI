const assert = require("assert");
const {
    DEFAULT_CONFIG,
    serializeINI,
    parseINI,
    mergeWithDefaults,
    saveConfig
} = require("../src/core/config_manager");

async function runSettingsAudit() {
    console.log("=== Auditing Settings Cloud Preservation ===");

    // 1. Verify all sections and required keys exist in DEFAULT_CONFIG
    const expectedSections = [
        "General", "Agent", "Tools", "Search", "UI", "Mobile",
        "ContextFilter", "Mcp"
    ];

    for (const sec of expectedSections) {
        assert.ok(DEFAULT_CONFIG[sec], `Section [${sec}] must exist in DEFAULT_CONFIG`);
    }
    console.log("✓ All expected configuration sections present in DEFAULT_CONFIG.");

    // 2. Verify UI Accent and Custom Accent are defined
    assert.strictEqual(typeof DEFAULT_CONFIG.UI.Accent, "string");
    assert.strictEqual(typeof DEFAULT_CONFIG.UI.CustomAccent, "string");
    console.log("✓ UI Accent and Custom Accent keys present in DEFAULT_CONFIG.");

    // 3. Verify Context Filter section
    assert.strictEqual(DEFAULT_CONFIG.ContextFilter.Enabled, true);
    assert.strictEqual(typeof DEFAULT_CONFIG.ContextFilter.Filters, "string");
    console.log("✓ Context Privacy Filters present in DEFAULT_CONFIG.");

    // 4. Verify MCP section
    assert.strictEqual(typeof DEFAULT_CONFIG.Mcp.Servers, "string");
    console.log("✓ MCP section present in DEFAULT_CONFIG.");

    // 5. Test Multiline System Prompt preservation
    const multilinePrompt = "Line 1: Role definition\nLine 2 = Instructions with equals\nLine 3: Output format";
    const testConfig = {
        General: {
            CustomSystemPrompt: multilinePrompt
        },
        UI: {
            CustomAccent: JSON.stringify({ accent: "#3b82f6", bg: "#0f0f0f", surface: "#161618", sendBg: "#f4f4f5" })
        },
        ContextFilter: {
            Enabled: true,
            Filters: JSON.stringify([{ id: "rule-1", pattern: "sk-[a-z0-9]+", action: "replace" }])
        }
    };

    const serialized = serializeINI(testConfig);
    const parsed = parseINI(serialized);

    assert.strictEqual(parsed.General.CustomSystemPrompt, multilinePrompt, "Multiline prompt must survive serialization and parsing intact");
    console.log("✓ Multiline system prompt preserved perfectly through INI serialization.");

    const parsedCustomAccent = JSON.parse(parsed.UI.CustomAccent);
    assert.strictEqual(parsedCustomAccent.accent, "#3b82f6");
    assert.strictEqual(parsedCustomAccent.bg, "#0f0f0f");
    console.log("✓ Custom accent JSON preserved with hex colors intact.");

    const parsedFilters = JSON.parse(parsed.ContextFilter.Filters);
    assert.strictEqual(parsedFilters.length, 1);
    assert.strictEqual(parsedFilters[0].id, "rule-1");
    console.log("✓ Context privacy filter rules preserved with patterns intact.");

    // 6. Test mergeWithDefaults retains custom values
    const merged = mergeWithDefaults(testConfig);
    assert.strictEqual(merged.General.CustomSystemPrompt, multilinePrompt);
    assert.strictEqual(merged.UI.CustomAccent, testConfig.UI.CustomAccent);
    assert.strictEqual(merged.General.DefaultStartupLLM, "gemini-2.5-flash"); // fallback retained
    console.log("✓ mergeWithDefaults merges custom values while preserving default fallbacks.");

    console.log("\n🎉 ALL SETTINGS CLOUD PRESERVATION TESTS PASSED CLEANLY!");
}

runSettingsAudit().catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
});
