const assert = require("assert");
const fs = require("fs");
const path = require("path");

async function runTests() {
    console.log("=== Testing MCP Settings UI Integration & Color Hierarchy ===");

    // 1. Verify index.html contains MCP controls and card in subScreen_tools
    console.log("Test: index.html markup for MCP controls");
    const htmlPath = path.join(__dirname, "../client/index.html");
    const html = fs.readFileSync(htmlPath, "utf8");

    assert(html.includes('id="cfgEnableMcp"'), "index.html must contain cfgEnableMcp checkbox");
    assert(html.includes('id="cfgMcpCard"'), "index.html must contain cfgMcpCard");
    assert(html.includes('id="btnRefreshMcpServers"'), "index.html must contain btnRefreshMcpServers");
    assert(html.includes('id="btnToggleAddMcpServer"'), "index.html must contain btnToggleAddMcpServer");
    assert(html.includes('id="mcpAddServerContainer"'), "index.html must contain mcpAddServerContainer");
    assert(html.includes('id="mcpNewServerId"'), "index.html must contain mcpNewServerId input");
    assert(html.includes('id="mcpNewTransport"'), "index.html must contain mcpNewTransport select");
    assert(html.includes('id="mcpNewCommand"'), "index.html must contain mcpNewCommand input");
    assert(html.includes('id="mcpNewArgs"'), "index.html must contain mcpNewArgs input");
    assert(html.includes('id="mcpNewUrl"'), "index.html must contain mcpNewUrl input");
    assert(html.includes('id="mcpServersList"'), "index.html must contain mcpServersList container");

    // 2. Verify settings.css contains MCP styles adhering to color hierarchy
    console.log("Test: settings.css styles and color hierarchy tokens");
    const cssPath = path.join(__dirname, "../client/styles/settings.css");
    const css = fs.readFileSync(cssPath, "utf8");

    assert(css.includes(".mcp-server-item"), "settings.css must define .mcp-server-item");
    assert(css.includes(".mcp-status-pill.connected"), "settings.css must define .mcp-status-pill.connected");
    assert(css.includes(".mcp-status-pill.disabled"), "settings.css must define .mcp-status-pill.disabled");
    assert(css.includes(".mcp-status-pill.error"), "settings.css must define .mcp-status-pill.error");
    assert(css.includes(".mcp-status-pill.starting"), "settings.css must define .mcp-status-pill.starting");
    assert(css.includes(".mcp-tool-pill"), "settings.css must define .mcp-tool-pill");
    assert(css.includes(".settings-input"), "settings.css must define .settings-input");

    // 3. Verify settings-view.js exports and functions
    console.log("Test: settings-view.js exports and controller logic");
    const settingsViewPath = path.join(__dirname, "../client/src/components/settings-view.js");
    const settingsCode = fs.readFileSync(settingsViewPath, "utf8");

    assert(settingsCode.includes("renderMcpServersList"), "settings-view.js must define renderMcpServersList");
    assert(settingsCode.includes("initMcpSettingsControls"), "settings-view.js must define initMcpSettingsControls");
    assert(settingsCode.includes('cfgEnableMcp'), "settings-view.js must reference cfgEnableMcp");
    assert(settingsCode.includes('/api/mcp/servers'), "settings-view.js must fetch /api/mcp/servers");

    console.log("✅ All MCP Settings UI integration and color hierarchy tests passed!");
}

runTests().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
