const http = require("http");
const fs = require("fs");
const path = require("path");
const { getConfig } = require("./core/config_manager");
const { initSupervisor } = require("./server/supervisor");
const { routeRequest } = require("./server/router");
const { mcpManager } = require("./core/mcp_manager");
const { workspaceWatcher } = require("./core/workspace_watcher");

const { initConsole } = require("./server/console");
const { ensureVendorFiles } = require("../scripts/vendor_download");
const { initPtyWebSocket } = require("./server/routes/pty");

// Resolve workspace directory from CLI arguments or environment variable
let cliWorkspace = null;
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === "--workspace" && cliArgs[i + 1]) cliWorkspace = cliArgs[++i];
    else if (cliArgs[i].startsWith("--workspace=")) cliWorkspace = cliArgs[i].split("=")[1];
}
const targetWorkspace = cliWorkspace || process.env.MULTIAI_WORKSPACE_DIR;
if (targetWorkspace) {
    const resolvedWs = path.resolve(targetWorkspace);
    if (!fs.existsSync(resolvedWs)) {
        try { fs.mkdirSync(resolvedWs, { recursive: true }); } catch (_) {}
    }
    if (fs.existsSync(resolvedWs)) {
        try {
            process.chdir(resolvedWs);
            process.env.MULTIAI_WORKSPACE_DIR = resolvedWs;
        } catch (e) {
            console.warn("[WORKSPACE] Could not chdir to workspace directory:", e.message);
        }
    }
}

async function startServer() {
    // 1. Ensure frontend vendor libraries (marked, highlight, katex, lucide, etc.) are present
    try {
        await ensureVendorFiles();
    } catch (err) {
        console.warn("[VENDOR] Check error:", err.message);
    }

    // 2. Start task daemon child process and setup termination handlers
    initSupervisor();

    // 3. Start workspace filesystem watcher for live file tree updates
    workspaceWatcher.init();

    // 4. Initialize configured Model Context Protocol (MCP) servers
    mcpManager.init().catch(err => {
        console.warn("[MCP] Initialization error:", err.message);
    });

    const appConfig = getConfig();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (appConfig.General?.Port || 8080);
    const HOST = process.env.HOST || appConfig.General?.Host || "0.0.0.0";

    const server = http.createServer(routeRequest);
    // Disable HTTP request timeout so long-running local model generations and streaming turns never get truncated by Node.js
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    initPtyWebSocket(server);

    server.listen(PORT, HOST, () => {
        const hostDisplay = HOST === "0.0.0.0" ? "localhost" : HOST;
        console.log(`Node Server running at http://${hostDisplay}:${PORT}`);
        initConsole({ port: PORT, host: hostDisplay });
    });
}

startServer().catch(err => {
    console.error("[FATAL] Server startup failed:", err);
    process.exit(1);
});

