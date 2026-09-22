const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let pythonProcess = null;
let isShuttingDown = false;

function startPythonTaskServer() {
    if (isShuttingDown) return;
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const repoRoot = path.join(__dirname, "../..");
    const taskScript = (process.platform === "win32" && fs.existsSync(path.join(repoRoot, "task_server_windows.py")))
        ? path.join(repoRoot, "task_server_windows.py")
        : path.join(repoRoot, "task_server.py");

    const pyEnv = {
        ...process.env,
        MULTIAI_REPO_DIR: repoRoot,
        MULTIAI_WORKSPACE_DIR: process.cwd(),
        PYTHONPATH: repoRoot + (process.env.PYTHONPATH ? (path.delimiter + process.env.PYTHONPATH) : "")
    };

    pythonProcess = spawn(pythonCmd, [taskScript], {
        cwd: process.cwd(),
        env: pyEnv,
        stdio: ["pipe", "pipe", "pipe"]
    });

    console.log(`[PROCESS] Started ${taskScript} with PID: ${pythonProcess.pid} (workspace: ${process.cwd()})`);

    pythonProcess.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[PYTHON STDOUT] ${text}`);
    });

    pythonProcess.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[PYTHON STDERR] ${text}`);
    });

    pythonProcess.on("close", (code) => {
        console.log(`[PROCESS] task_server.py exited with code ${code}`);
        if (!isShuttingDown) {
            console.log(`[PROCESS] Respawning ${taskScript} in 1s...`);
            setTimeout(startPythonTaskServer, 1000);
        }
    });

    pythonProcess.on("error", (err) => {
        console.error(`[PROCESS ERROR] Failed to spawn task_server.py: ${err.message}`);
    });
}

function cleanupAndExit(exitCode = 0) {
    isShuttingDown = true;
    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating task_server.py (PID: ${pythonProcess.pid})...`);
        try {
            pythonProcess.kill("SIGTERM");
        } catch (_) {
            pythonProcess.kill("SIGKILL");
        }
    }
    process.exit(exitCode);
}

function initSupervisor() {
    startPythonTaskServer();

    process.on("SIGINT", () => {
        console.log("\n[PROCESS] Received SIGINT (Ctrl+C). Cleaning up...");
        cleanupAndExit(0);
    });

    process.on("SIGTERM", () => {
        console.log("\n[PROCESS] Received SIGTERM. Cleaning up...");
        cleanupAndExit(0);
    });

    process.on("uncaughtException", (err) => {
        console.error("[PROCESS] Uncaught exception:", err);
        cleanupAndExit(1);
    });
}

module.exports = {
    initSupervisor,
    startPythonTaskServer,
    cleanupAndExit
};
