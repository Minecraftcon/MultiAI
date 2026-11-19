const fs = require("fs");
const path = require("path");

// Load local .env into process.env if present before any other modules load
try {
    const envPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                const idx = trimmed.indexOf("=");
                const k = trimmed.slice(0, idx).trim();
                const v = trimmed.slice(idx + 1).trim();
                if (!process.env[k]) process.env[k] = v;
            }
        }
    }
} catch (_) {}

const http = require("http");
const { getConfig, initCloudConfig } = require("./core/config_manager");
const { initSupervisor } = require("./server/supervisor");
const { routeRequest } = require("./server/router");
const { mcpManager } = require("./core/mcp_manager");
const supabaseStorage = require("./core/supabase_storage");
const { workspaceWatcher } = require("./core/workspace_watcher");
const { b2Storage } = require("./core/b2_storage");

const { initConsole } = require("./server/console");
const { ensureVendorFiles } = require("../scripts/vendor_download");
const { ensureRootlessTools } = require("../scripts/setup_rootless_tools");
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

    // 3.1 Start workspace filesystem watcher for live file tree updates
    workspaceWatcher.init();

    // 3.2 Initialize Backblaze B2 persistent workspace auto-sync
    try {
        if (b2Storage.isConfigured()) {
            b2Storage.startAutoSyncWorker();
            workspaceWatcher.addListener((eventType, filename, watchedDir) => {
                const wsDir = process.env.MULTIAI_WORKSPACE_DIR || "/tmp/workspace";
                if (watchedDir && watchedDir.startsWith(wsDir)) {
                    const rel = path.relative(wsDir, watchedDir);
                    const projectName = rel.split(path.sep)[0];
                    if (projectName && projectName !== ".." && projectName !== "scratch") {
                        b2Storage.markProjectDirty(projectName);
                    }
                }
            });
        }
    } catch (err) {
        console.warn("[B2] Auto-sync init warning:", err.message);
    }

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

