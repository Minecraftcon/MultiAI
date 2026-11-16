if (typeof global.localStorage === "undefined") {
    global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
}
if (typeof global.document === "undefined") {
    global.document = {
        documentElement: { style: { setProperty: () => {} } },
        getElementById: () => null
    };
}
if (typeof global.window === "undefined") {
    global.window = {
        localStorage: global.localStorage
    };
}

import assert from "node:assert/strict";
import { getAllToolSchemas, getTool, hasTool } from "../UI/webui/src/tools/index.js";
import { getActiveSubagents, hasActiveSubagents, onSubagentsChange } from "../UI/webui/src/agent/subagent.js";
import { getToolBadgeConfig } from "../UI/webui/src/components/chat-tool-badges.js";

async function runTests() {
    console.log("=== Testing Invoke Subagent & Designer Subtools ===");

    // 1. Verify main agent tool schemas do NOT include subagent-only tools
    const schemas = getAllToolSchemas();
    const schemaNames = schemas.map(s => s?.function?.name || s?.name);
    console.log(`Main agent has ${schemas.length} published tools.`);

    assert.ok(schemaNames.includes("invoke_subagent"), "Main agent schemas must include invoke_subagent");
    assert.ok(!schemaNames.includes("show_html_preview"), "show_html_preview must NOT clutter main agent schemas");
    assert.ok(!schemaNames.includes("open_browser_tab"), "open_browser_tab must NOT clutter main agent schemas");
    assert.ok(!schemaNames.includes("toggle_panel"), "toggle_panel must NOT clutter main agent schemas");
    console.log("✓ Verified main agent schemas are isolated and uncluttered.");

    // 2. Verify subagent-only tools are registered and accessible via getTool
    assert.ok(hasTool("show_html_preview"), "show_html_preview must be registered");
    assert.ok(hasTool("open_browser_tab"), "open_browser_tab must be registered");
    assert.ok(hasTool("toggle_panel"), "toggle_panel must be registered");

    const htmlTool = getTool("show_html_preview");
    assert.strictEqual(htmlTool.subagentOnly, true, "show_html_preview must have subagentOnly: true");
    const previewRes = await htmlTool.handler({ html: "<h1>Hello World</h1>", title: "Test Preview" });
    assert.strictEqual(previewRes.status, "rendered");
    assert.strictEqual(previewRes.title, "Test Preview");
    console.log("✓ Verified design subtools are registered and functional.");

    // 3. Verify invoke_subagent tool definition and background execution
    const invokeTool = getTool("invoke_subagent");
    assert.ok(invokeTool, "invoke_subagent tool must be registered");

    let subagentsChanged = 0;
    const unsubscribe = onSubagentsChange((activeList) => {
        subagentsChanged++;
    });

    const bgRes = await invokeTool.handler({
        task: "Design a clean minimalist hero section",
        subagent_type: "designer",
        background: true
    }, { badgeEl: null, genState: null });

    assert.strictEqual(bgRes.status, "running");
    assert.strictEqual(bgRes.background, true);
    assert.strictEqual(bgRes.subagent_type, "designer");
    assert.ok(bgRes.subagent_id, "Must return a subagent_id");
    assert.ok(subagentsChanged > 0, "onSubagentsChange must have fired when subagent started");
    console.log("✓ Verified background subagent dispatch and active tracking.");

    // 4. Verify tool badge config and 4-dot spinner indicator
    const badgeConfig = getToolBadgeConfig("invoke_subagent", {
        task: "Design navbar",
        subagent_type: "designer"
    });
    assert.strictEqual(badgeConfig.label, "Subagent [designer]");
    assert.strictEqual(badgeConfig.isSubagent, true);
    assert.strictEqual(badgeConfig.detail, "Design navbar");
    console.log("✓ Verified subagent tool badge configuration.");

    unsubscribe();
    console.log("=== All Invoke Subagent Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
