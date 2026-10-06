const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { McpManager, mcpManager } = require("../src/core/mcp_manager");
const { handleMcpRoute } = require("../src/server/routes/mcp");

async function runTests() {
    console.log("=== Testing Model Context Protocol (MCP) Manager & Active Tools ===");

    // 1. Test McpManager instantiation & config resolution
    console.log("Test: McpManager class and singleton");
    assert(mcpManager instanceof McpManager, "mcpManager must be instance of McpManager");
    assert(typeof mcpManager.configPath === "string", "configPath must be resolved");

    // 2. Test mock server tool discovery & schema transformation
    console.log("Test: Mock server registration, tool listing and schema transformation");
    const testManager = new McpManager();
    // Use an isolated temporary test config
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-mcp-test-"));
    const tempConfigPath = path.join(tempDir, "mcp_servers.json");
    testManager.configPath = tempConfigPath;

    testManager.saveConfig({
        "test-server": {
            command: "echo",
            args: ["mock"],
            enabled: true
        }
    });

    const loaded = testManager.loadConfig();
    assert(loaded["test-server"], "Server config must be saved and loaded");

    // Mock an active server entry with mock Client to test tool parsing without spawning external subprocesses
    const mockTools = [
        {
            name: "echo_tool",
            description: "Echoes input back",
            inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"]
            }
        },
        {
            name: "calculate",
            description: "Performs math operation",
            inputSchema: {
                type: "object",
                properties: { expr: { type: "string" } },
                required: ["expr"]
            }
        }
    ];

    const mockClient = {
        listTools: async () => ({ tools: mockTools }),
        callTool: async ({ name, arguments: args }) => {
            if (name === "echo_tool") {
                return {
                    content: [{ type: "text", text: `Echo: ${args.message}` }]
                };
            }
            if (name === "error_tool") {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Something went wrong" }]
                };
            }
            return { content: [{ type: "text", text: "ok" }] };
        },
        close: async () => {}
    };

    testManager.servers.set("test-server", {
        config: loaded["test-server"],
        client: mockClient,
        transport: null,
        status: "connected",
        error: null,
        tools: []
    });

    const discovered = await testManager.refreshServerTools("test-server");
    assert.strictEqual(discovered.length, 2, "Should discover 2 mock tools");
    assert.strictEqual(discovered[0].fullName, "mcp_test_server_echo_tool");

    const schemas = testManager.getActiveToolSchemas();
    assert.strictEqual(schemas.length, 2, "Should have 2 tool schemas");
    assert.strictEqual(schemas[0].type, "function");
    assert.strictEqual(schemas[0].function.name, "mcp_test_server_echo_tool");
    assert(schemas[0].function.description.includes("test-server"), "Description should include server name");

    // 3. Test tool call execution
    console.log("Test: Tool call execution via testManager.callTool");
    const result = await testManager.callTool("mcp_test_server_echo_tool", { message: "Hello Anthropic MCP" });
    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.output, "Echo: Hello Anthropic MCP");
    assert.strictEqual(result.server, "test-server");

    // 4. Test tool call by originalName fallback
    const result2 = await testManager.callTool("echo_tool", { message: "Direct Name" });
    assert.strictEqual(result2.status, "success");
    assert.strictEqual(result2.output, "Echo: Direct Name");

    // 5. Test unknown tool handling
    console.log("Test: Unknown tool error handling");
    let threw = false;
    try {
        await testManager.callTool("non_existent_tool", {});
    } catch (e) {
        threw = true;
        assert(e.message.includes("not found in active registry"));
    }
    assert(threw, "Calling unknown tool must throw an error");

    // 6. Test server status
    console.log("Test: getServersStatus()");
    const statuses = testManager.getServersStatus();
    assert.strictEqual(statuses.length, 1);
    assert.strictEqual(statuses[0].id, "test-server");
    assert.strictEqual(statuses[0].status, "connected");
    assert.strictEqual(statuses[0].toolCount, 2);

    // 7. Test HTTP Route Handling
    console.log("Test: handleMcpRoute HTTP endpoints");
    
    function createMockRes() {
        return {
            statusCode: 0,
            headers: {},
            body: "",
            writeHead(code, headers) {
                this.statusCode = code;
                this.headers = headers || {};
            },
            end(data) {
                this.body = data || "";
            }
        };
    }

    // Set testManager as manager in singleton temporarily or test route with singleton
    // First, test GET /api/mcp/servers
    const resServers = createMockRes();
    await handleMcpRoute({ method: "GET", url: "/api/mcp/servers" }, resServers);
    assert.strictEqual(resServers.statusCode, 200);
    const parsedServers = JSON.parse(resServers.body);
    assert.strictEqual(parsedServers.success, true);
    assert(Array.isArray(parsedServers.servers));

    // Test GET /api/mcp/tools
    const resTools = createMockRes();
    await handleMcpRoute({ method: "GET", url: "/api/mcp/tools" }, resTools);
    assert.strictEqual(resTools.statusCode, 200);
    const parsedTools = JSON.parse(resTools.body);
    assert.strictEqual(parsedTools.success, true);
    assert(Array.isArray(parsedTools.tools));

    // 8. Test chat-tool-badges for MCP tools
    console.log("Test: chat-tool-badges badge config for MCP tools");
    const badgesModule = await import("../client/src/components/chat-tool-badges.js");
    const { getToolBadgeConfig } = badgesModule;

    const mcpBadge = getToolBadgeConfig("mcp_filesystem_read_file", { path: "package.json" });
    assert.strictEqual(mcpBadge.icon, "plug");
    assert.strictEqual(mcpBadge.label, "MCP [filesystem]");
    assert(mcpBadge.detail.includes("read_file"));
    assert(mcpBadge.detail.includes("path"));

    // 9. Test client-side McpActiveTools
    console.log("Test: Client McpActiveTools & exposure in system prompt");
    const mcpClientModule = await import("../client/src/tools/mcp/index.js");
    const { McpActiveTools, McpActiveToolsManager } = mcpClientModule;
    assert(McpActiveTools instanceof McpActiveToolsManager, "McpActiveTools must be instance of McpActiveToolsManager");
    assert(typeof McpActiveTools.refresh === "function", "refresh must be a function");
    assert(typeof McpActiveTools.callTool === "function", "callTool must be a function");
    assert(typeof McpActiveTools.getSchemas === "function", "getSchemas must be a function");

    // Mock global fetch for client tools refresh test in node environment
    const prevFetch = globalThis.fetch;
    const prevWindow = globalThis.window;
    globalThis.window = {};
    globalThis.fetch = async (url, opts) => {
        if (url === "/api/mcp/tools") {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    success: true,
                    activeTools: [
                        {
                            serverId: "test_mcp",
                            originalName: "test_ping",
                            fullName: "mcp_test_mcp_test_ping",
                            description: "Test ping utility",
                            schema: {
                                type: "function",
                                function: {
                                    name: "mcp_test_mcp_test_ping",
                                    description: "[MCP: test_mcp] Test ping utility",
                                    parameters: { type: "object", properties: {} }
                                }
                            }
                        }
                    ]
                })
            };
        }
        return { ok: false, status: 404, text: async () => "{}" };
    };

    const refreshedTools = await McpActiveTools.refresh();
    assert(refreshedTools.length > 0, "McpActiveTools.refresh must populate tools");
    assert(refreshedTools.some(t => t.name === "mcp_test_mcp_test_ping"), "mcp_test_mcp_test_ping must be registered");

    const toolsModule = await import("../client/src/tools/index.js");
    const { getActiveToolSchemas } = toolsModule;
    const activeSchemas = getActiveToolSchemas();
    assert(activeSchemas.some(s => s.function?.name === "mcp_test_mcp_test_ping"), "getActiveToolSchemas must expose mcp_test_mcp_test_ping");

    const systemModule = await import("../client/src/services/system.js");
    const { buildFullSystemPrompt } = systemModule;
    const fullPrompt = buildFullSystemPrompt();
    assert(fullPrompt.includes("[EXTERNAL MODEL CONTEXT PROTOCOL (MCP) TOOLS]"), "System prompt must contain external MCP tools section");
    assert(fullPrompt.includes("mcp_test_mcp_test_ping"), "System prompt must list mcp_test_mcp_test_ping");

    // Restore fetch and window
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) {
        delete globalThis.window;
    } else {
        globalThis.window = prevWindow;
    }

    // 10. Test live example server execution end-to-end
    console.log("Test: Live example server scripts/mcp_example_server.js execution");
    const liveManager = new McpManager();
    const exampleScriptPath = path.resolve(__dirname, "../scripts/mcp_example_server.js");
    const liveEntry = await liveManager.startServer("example_test", {
        command: "node",
        args: [exampleScriptPath],
        enabled: true
    });
    assert.strictEqual(liveEntry.status, "connected");
    assert(liveEntry.tools.length >= 3, "Live example server must expose at least 3 tools");

    const timeToolRes = await liveManager.callTool("mcp_example_test_get_current_time", {});
    assert.strictEqual(timeToolRes.status, "success");
    assert(timeToolRes.output.includes("iso"));

    const mathToolRes = await liveManager.callTool("mcp_example_test_evaluate_math", { expression: "7 * 8" });
    assert.strictEqual(mathToolRes.status, "success");
    assert.strictEqual(mathToolRes.output, "Result: 56");

    await liveManager.stopAll();

    // Clean up temporary test files
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}

    console.log("✅ All MCP manager, route, and McpActiveTools tests passed successfully!");
}

runTests().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
