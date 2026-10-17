const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const {
    loadSandboxConfig,
    getResolvedProfileId,
    verifyProfileEnvironment,
    resolveCommandTemplate,
    getSandboxShieldArgs,
    getStorageDir,
    DIRECT_PROFILE
} = require("../core/sandbox_manager");

let pythonProcess = null;
let isShuttingDown = false;
let isStarting = false;
let respawnTimer = null;
let activeSandboxProfileId = null;

/**
 * Forcefully terminates a child process and its entire descendant tree (process group).
 * Essential for sandboxes (bwrap/proot/docker) spawned via /bin/sh -c so child daemons aren't orphaned.
 */
function killProcessTree(proc, signal = "SIGTERM") {
    if (!proc || !proc.pid) return;
    try {
        if (process.platform !== "win32") {
            try {
                // Negative PID targets the entire process group
                process.kill(-proc.pid, signal);
            } catch (e) {
                if (e.code !== "ESRCH") {
                    try { proc.kill(signal); } catch (_) {}
                }
            }
        } else {
            execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
        }
    } catch (_) {}
}

/**
 * Checks if the target task port is held by an orphaned or stale process and frees it.
 */
function freePort(port) {
    const p = String(port || 5000);
    if (process.platform === "win32") {
        try {
            const out = execSync(`netstat -ano | findstr :${p}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
            const lines = out.trim().split("\n");
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== "0" && pid !== String(process.pid)) {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
                }
            }
        } catch (_) {}
    } else {
        try {
            const out = execSync(`lsof -ti :${p} 2>/dev/null || fuser ${p}/tcp 2>/dev/null`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
            const pids = out.trim().split(/\s+/).filter(Boolean);
            for (const pidStr of pids) {
                const pid = parseInt(pidStr, 10);
                if (pid && pid !== process.pid) {
                    try { process.kill(pid, "SIGKILL"); } catch (_) {}
                }
            }
        } catch (_) {}
    }
}

function restartPythonTaskServer() {
    if (respawnTimer) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
    }

    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating running task_server (PID: ${pythonProcess.pid}) for sandbox reload...`);
        pythonProcess.removeAllListeners("close");
        killProcessTree(pythonProcess, "SIGTERM");
        pythonProcess = null;
    }

    // Allow process tree 250ms to exit gracefully, then clear port and start
    setTimeout(() => {
        const taskPort = process.env.TASK_PORT || 5000;
        freePort(taskPort);
        startPythonTaskServer();
    }, 250);
}

function startPythonTaskServer() {
    if (isShuttingDown || isStarting) return;
    isStarting = true;

    if (respawnTimer) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
    }

    const taskPort = process.env.TASK_PORT || 5000;
    // Ensure port is not blocked before spawning
    freePort(taskPort);

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const repoRoot = path.join(__dirname, "../..");
    const taskScript = (process.platform === "win32" && fs.existsSync(path.join(repoRoot, "task_server_windows.py")))
        ? path.join(repoRoot, "task_server_windows.py")
        : path.join(repoRoot, "task_server.py");

    const dataDir = getStorageDir();

    const config = loadSandboxConfig();
    const resolvedId = getResolvedProfileId(config);
    activeSandboxProfileId = resolvedId;
    const profile = (config.profiles && config.profiles[resolvedId]) || DIRECT_PROFILE;

    // Fail immediately if sandboxing is enabled but container or binary is missing
    if (config.enabled && profile.mode !== "direct") {
        const check = verifyProfileEnvironment(profile);
        if (!check.ok) {
            console.error("\n" + "=".repeat(64));
            console.error(`[SANDBOX ERROR] Startup aborted: Sandbox '${profile.id}' (${profile.name}) is not usable.`);
            console.error(`  • Detail: ${check.reason}`);
            if (check.help) {
                console.error(`  • Solution: ${check.help}`);
            }
            console.error("\n[ACTION REQUIRED]");
            console.error("  Sandboxing is currently ENABLED, but the container or binary is missing.");
            console.error("  MultiAI startup will NOT continue in a broken container state.");
            console.error("  To start MultiAI, either set up the container or disable sandboxing manually:");
            console.error("    1. Disable sandboxing: edit ~/.MultiAI/vm_conf.json and set \"enabled\": false");
            console.error("    2. Or start once without sandboxing: MULTIAI_SANDBOX=0 node src/index.js");
            console.error("=".repeat(64) + "\n");

            isStarting = false;
            cleanupAndExit(1);
            return;
        }
    }

    console.log(`[SANDBOX] Launching task server with profile '${resolvedId}' (${profile.name || "Default"})`);

    const pyEnv = {
        ...process.env,
        MULTIAI_REPO_DIR: repoRoot,
        MULTIAI_WORKSPACE_DIR: process.cwd(),
        PYTHONPATH: repoRoot + (process.env.PYTHONPATH ? (path.delimiter + process.env.PYTHONPATH) : "")
    };

    try {
        if (profile.mode === "direct" || !config.enabled) {
            pythonProcess = spawn(pythonCmd, [taskScript], {
                cwd: process.cwd(),
                env: pyEnv,
                detached: process.platform !== "win32",
                stdio: ["pipe", "pipe", "pipe"]
            });
        } else {
            const shieldMounts = getSandboxShieldArgs();
            const fullCmd = resolveCommandTemplate(profile.startup, {
                PROJECT_PATH: process.cwd(),
                DATA_DIR: dataDir,
                TASK_PORT: taskPort,
                TASK_SERVER_SCRIPT: taskScript,
                SHIELD_MOUNTS: shieldMounts
            });

            console.log(`[SANDBOX EXEC] ${fullCmd}`);

            pythonProcess = spawn("/bin/sh", ["-c", fullCmd], {
                cwd: process.cwd(),
                env: pyEnv,
                detached: process.platform !== "win32",
                stdio: ["pipe", "pipe", "pipe"]
            });
        }
    } catch (err) {
        console.error(`[PROCESS ERROR] Failed to spawn task server: ${err.message}`);
        isStarting = false;
        return;
    }

    isStarting = false;
    console.log(`[PROCESS] Started task server with PID: ${pythonProcess.pid} (workspace: ${process.cwd()})`);

    pythonProcess.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[PYTHON STDOUT] ${text}`);
    });

    pythonProcess.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[PYTHON STDERR] ${text}`);
    });

    pythonProcess.on("close", (code) => {
        console.log(`[PROCESS] task server exited with code ${code}`);
        pythonProcess = null;
        if (!isShuttingDown) {
            if (respawnTimer) clearTimeout(respawnTimer);
            console.log(`[PROCESS] Respawning in 1s...`);
            respawnTimer = setTimeout(() => {
                respawnTimer = null;
                startPythonTaskServer();
            }, 1000);
        }
    });

    pythonProcess.on("error", (err) => {
        console.error(`[PROCESS ERROR] Task server error: ${err.message}`);
    });
}

function cleanupAndExit(exitCode = 0) {
    isShuttingDown = true;
    if (respawnTimer) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
    }
    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating task server (PID: ${pythonProcess.pid})...`);
        pythonProcess.removeAllListeners("close");
        killProcessTree(pythonProcess, "SIGTERM");
        pythonProcess = null;
    }
    const taskPort = process.env.TASK_PORT || 5000;
    freePort(taskPort);
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
    restartPythonTaskServer,
    getActiveSandboxProfileId: () => activeSandboxProfileId,
    cleanupAndExit
};
