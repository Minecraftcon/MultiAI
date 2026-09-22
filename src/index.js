const http = require("http");
const fs = require("fs");
const { getConfig } = require("./core/config_manager");
const { initSupervisor } = require("./server/supervisor");
const { routeRequest } = require("./server/router");

// If MULTIAI_WORKSPACE_DIR is set, anchor runtime process.cwd() to it
if (process.env.MULTIAI_WORKSPACE_DIR && fs.existsSync(process.env.MULTIAI_WORKSPACE_DIR)) {
    try {
        process.chdir(process.env.MULTIAI_WORKSPACE_DIR);
    } catch (e) {
        console.warn("[WORKSPACE] Could not chdir to workspace directory:", e.message);
    }
}

// Start Python task server child process and setup termination handlers
initSupervisor();

const appConfig = getConfig();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (appConfig.General?.Port || 8080);
const HOST = process.env.HOST || appConfig.General?.Host || "0.0.0.0";

const server = http.createServer(routeRequest);

server.listen(PORT, HOST, () => {
    const hostDisplay = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`Node Server running at http://${hostDisplay}:${PORT}`);
});
