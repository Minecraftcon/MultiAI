const http = require("http");
const fs = require("fs");
const { getConfig, initCloudConfig } = require("./core/config_manager");
const { initSupervisor } = require("./server/supervisor");
const { routeRequest } = require("./server/router");
const { mcpManager } = require("./core/mcp_manager");
const supabaseStorage = require("./core/supabase_storage");

const { initConsole } = require("./server/console");
const { ensureVendorFiles } = require("../scripts/vendor_download");
const { ensureRootlessTools } = require("../scripts/setup_rootless_tools");
const { initPtyWebSocket } = require("./server/routes/pty");

// If MULTIAI_WORKSPACE_DIR is set, anchor runtime process.cwd() to it
if (process.env.MULTIAI_WORKSPACE_DIR && fs.existsSync(process.env.MULTIAI_WORKSPACE_DIR)) {
    try {
        process.chdir(process.env.MULTIAI_WORKSPACE_DIR);
    } catch (e) {
        console.warn("[WORKSPACE] Could not chdir to workspace directory:", e.message);
    }
}

async function startServer() {
    // 1. Load cloud secrets from Supabase into process.env before servicing any requests
    try {
        await supabaseStorage.loadSecretsIntoEnv();
    } catch (err) {
        console.warn("[SECRETS] Error loading cloud secrets:", err.message);
    }

    // 1.1 Synchronize cloud configuration from Supabase into config manager
    try {
        await initCloudConfig();
    } catch (err) {
        console.warn("[CONFIG] Error initializing cloud config:", err.message);
    }

    // 2. Ensure frontend vendor libraries (marked, highlight, katex, lucide, etc.) are present
    try {
        await ensureVendorFiles();
    } catch (err) {
        console.warn("[VENDOR] Check error:", err.message);
    }

    // 2.1 Ensure rootless package managers (micromamba + pkgx) are provisioned
    ensureRootlessTools().catch(err => {
        console.warn("[TOOLS] Rootless tools provisioning warning:", err.message);
    });

    // 3. Start task server child process and setup termination handlers
    initSupervisor();

    // 4. Initialize configured Model Context Protocol (MCP) servers
    mcpManager.init().catch(err => {
        console.warn("[MCP] Initialization error:", err.message);
    });

    const appConfig = getConfig();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (appConfig.General?.Port || 8080);
    const HOST = process.env.HOST || appConfig.General?.Host || "0.0.0.0";

    const server = http.createServer(routeRequest);
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

