const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const {
    loadSandboxConfig,
    getResolvedProfileId,
    verifyProfileEnvironment,
    resolveCommandTemplate,
    getSandboxShieldArgs,
    getTaskServerSocketPath,
    getTaskServerIpcType,
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
 * Checks if the target task port or socket is held by an orphaned or stale process and frees it.
 */
function freePort(port) {
    try {
        const sockPath = getTaskServerSocketPath();
        if (fs.existsSync(sockPath)) {
            fs.unlinkSync(sockPath);
        }
    } catch (_) {}

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

/**
 * Resolves the configured task daemon engine ('go' or 'python').
 * Precedence:
 * 1. CLI flags: --task-daemon=go|python, --daemon=go|python, --go-daemon, --python-daemon
 * 2. Environment variable: MULTIAI_TASK_DAEMON=go|python|golang
 * 3. Sandbox config (~/.MultiAI/vm_conf.json) task_daemon property
 * 4. User configuration file (config.ini) [Agent] TaskDaemon = go|python
 * 5. Default: "python"
 */
function getTaskDaemonEngine() {
    const argv = process.argv || [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--task-daemon" && argv[i + 1]) {
            const val = argv[i + 1].trim().toLowerCase();
            return val === "golang" ? "go" : val;
        }
        if (arg.startsWith("--task-daemon=")) {
            const val = arg.split("=")[1].trim().toLowerCase();
            return val === "golang" ? "go" : val;
        }
        if (arg === "--daemon" && argv[i + 1]) {
            const val = argv[i + 1].trim().toLowerCase();
            return val === "golang" ? "go" : val;
        }
        if (arg.startsWith("--daemon=")) {
            const val = arg.split("=")[1].trim().toLowerCase();
            return val === "golang" ? "go" : val;
        }
        if (arg === "--go-daemon" || arg === "--go") {
            return "go";
        }
        if (arg === "--python-daemon" || arg === "--python") {
            return "python";
        }
    }

    if (process.env.MULTIAI_TASK_DAEMON) {
        const envVal = process.env.MULTIAI_TASK_DAEMON.trim().toLowerCase();
        if (envVal === "golang") return "go";
        return envVal;
    }

    try {
        const sbConfig = loadSandboxConfig();
        if (sbConfig && sbConfig.task_daemon) {
            const val = String(sbConfig.task_daemon).trim().toLowerCase();
            if (val === "golang") return "go";
            if (val === "go" || val === "python") return val;
        }
    } catch (_) {}

    try {
        const { getConfig } = require("../core/config_manager");
        const cfg = getConfig();
        if (cfg && cfg.Agent && cfg.Agent.TaskDaemon) {
            const cfgVal = String(cfg.Agent.TaskDaemon).trim().toLowerCase();
            if (cfgVal === "golang") return "go";
            return cfgVal;
        }
    } catch (_) {}

    return "python";
}

function restartPythonTaskServer() {
    if (respawnTimer) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
    }

    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating running task daemon (PID: ${pythonProcess.pid}) for restart...`);
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

    const repoRoot = path.join(__dirname, "../..");
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const taskScript = (process.platform === "win32" && fs.existsSync(path.join(repoRoot, "task_server_windows.py")))
        ? path.join(repoRoot, "task_server_windows.py")
        : path.join(repoRoot, "task_server.py");

    const dataDir = getStorageDir();

    const config = loadSandboxConfig();
    const resolvedId = getResolvedProfileId(config);
    activeSandboxProfileId = resolvedId;
    const profile = (config.profiles && config.profiles[resolvedId]) || DIRECT_PROFILE;
    const ipcType = getTaskServerIpcType(config);
    const socketPath = getTaskServerSocketPath();

    // Determine task daemon engine (go or python)
    let engine = getTaskDaemonEngine();
    const goBinaryName = process.platform === "win32" ? "task_daemon.exe" : "task_daemon";
    const goBinaryPath = path.join(repoRoot, "bin", goBinaryName);

    if (engine === "go") {
        if (!fs.existsSync(goBinaryPath)) {
            console.warn(`[TASK DAEMON WARNING] Go daemon binary not found at ${goBinaryPath}.`);
            console.warn(`[TASK DAEMON WARNING] Run 'npm run build:daemon' to compile it. Falling back to Python task server.`);
            engine = "python";
        }
    }

    const daemonLabel = engine === "go" ? "Go task daemon" : "Python task server";

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

    console.log(`[SANDBOX] Launching ${daemonLabel} with profile '${resolvedId}' (${profile.name || "Default"}), IPC: ${ipcType}`);

    const pyEnv = {
        ...process.env,
        MULTIAI_REPO_DIR: repoRoot,
        MULTIAI_WORKSPACE_DIR: process.cwd(),
        PYTHONPATH: repoRoot + (process.env.PYTHONPATH ? (path.delimiter + process.env.PYTHONPATH) : "")
    };

    try {
        if (profile.mode === "direct" || !config.enabled) {
            if (engine === "go") {
                const daemonArgs = [];
                if (ipcType === "socket" && process.platform !== "win32") {
                    daemonArgs.push("--socket", socketPath);
                } else {
                    daemonArgs.push("--port", String(taskPort));
                }

                pythonProcess = spawn(goBinaryPath, daemonArgs, {
                    cwd: process.cwd(),
                    env: pyEnv,
                    detached: process.platform !== "win32",
                    stdio: ["pipe", "pipe", "pipe"]
                });
            } else {
                const taskArgs = [taskScript];
                if (ipcType === "socket" && process.platform !== "win32") {
                    taskArgs.push("--socket", socketPath);
                } else {
                    taskArgs.push("--port", String(taskPort));
                }

                pythonProcess = spawn(pythonCmd, taskArgs, {
                    cwd: process.cwd(),
                    env: pyEnv,
                    detached: process.platform !== "win32",
                    stdio: ["pipe", "pipe", "pipe"]
                });
            }
        } else {
            const shieldMounts = getSandboxShieldArgs();
            let startupTemplate = profile.startup;
            if (engine === "go") {
                startupTemplate = startupTemplate
                    .replace(/python3?\s+\{TASK_SERVER_SCRIPT\}/g, goBinaryPath)
                    .replace(/python3?\s+\/workspace\/task_server\.py/g, "/workspace/bin/task_daemon");
            }

            const fullCmd = resolveCommandTemplate(startupTemplate, {
                PROJECT_PATH: process.cwd(),
                DATA_DIR: dataDir,
                TASK_PORT: taskPort,
                TASK_SOCKET: socketPath,
                IPC_TYPE: ipcType,
                TASK_SERVER_SCRIPT: engine === "go" ? goBinaryPath : taskScript,
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
        console.error(`[PROCESS ERROR] Failed to spawn task daemon: ${err.message}`);
        isStarting = false;
        return;
    }

    isStarting = false;
    console.log(`[PROCESS] Started ${daemonLabel} with PID: ${pythonProcess.pid} (engine: ${engine}, workspace: ${process.cwd()})`);

    const logPrefix = engine === "go" ? "GO DAEMON" : "PYTHON";
    pythonProcess.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[${logPrefix} STDOUT] ${text}`);
    });

    pythonProcess.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[${logPrefix} STDERR] ${text}`);
    });

    pythonProcess.on("close", (code) => {
        console.log(`[PROCESS] ${daemonLabel} exited with code ${code}`);
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
        console.error(`[PROCESS ERROR] Task daemon error: ${err.message}`);
    });
}

function cleanupAndExit(exitCode = 0) {
    isShuttingDown = true;
    if (respawnTimer) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
    }
    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating task daemon (PID: ${pythonProcess.pid})...`);
        pythonProcess.removeAllListeners("close");
        killProcessTree(pythonProcess, "SIGTERM");
        pythonProcess = null;
    }
    const taskPort = process.env.TASK_PORT || 5000;
    freePort(taskPort);
    try {
        const sock = getTaskServerSocketPath();
        if (fs.existsSync(sock)) fs.unlinkSync(sock);
    } catch (_) {}
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
    startTaskServer: startPythonTaskServer,
    restartTaskServer: restartPythonTaskServer,
    getTaskDaemonEngine,
    getActiveSandboxProfileId: () => activeSandboxProfileId,
    cleanupAndExit
};
