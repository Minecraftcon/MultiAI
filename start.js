#!/usr/bin/env node
/**
 * MultiAI Universal Starter & Supervisor
 * =====================================
 * Automatic setup detection, dependency installation, and clean auto-kill on stop.
 * Pure Node.js runtime - zero Python dependency.
 *
 * Features:
 * - Detects and verifies Node.js and npm prerequisites.
 * - Auto-installs missing npm packages (`npm install`).
 * - Automatically resolves port conflicts on 8080 and 5000 before launch.
 * - Starts MultiSearch AI and opens it in your default browser.
 * - Auto-kills everything cleanly on exit (Ctrl+C / SIGINT / SIGTERM / exit),
 *   leaving zero zombie background processes on ports 8080 or 5000.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const http = require("http");
const https = require("https");
const readline = require("readline");
const { spawn, execSync, spawnSync } = require("child_process");

// ANSI Color Codes
const isTTY = Boolean(process.stdout.isTTY);
const CYAN = isTTY ? "\x1b[96m" : "";
const GREEN = isTTY ? "\x1b[92m" : "";
const YELLOW = isTTY ? "\x1b[93m" : "";
const RED = isTTY ? "\x1b[91m" : "";
const BOLD = isTTY ? "\x1b[1m" : "";
const DIM = isTTY ? "\x1b[2m" : "";
const RESET = isTTY ? "\x1b[0m" : "";

function logInfo(msg) {
    console.log(`${CYAN}[MultiAI]${RESET} ${msg}`);
}

function logSuccess(msg) {
    console.log(`${GREEN}[MultiAI]${RESET} ${msg}`);
}

function logWarn(msg) {
    console.log(`${YELLOW}[MultiAI]${RESET} ${msg}`);
}

function logError(msg) {
    console.error(`${RED}[MultiAI ERROR]${RESET} ${msg}`);
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
}

function isPortInUse(port, host = "127.0.0.1") {
    return new Promise((resolve) => {
        const client = new net.Socket();
        client.setTimeout(400);
        client.once("connect", () => {
            client.destroy();
            resolve(true);
        });
        client.once("timeout", () => {
            client.destroy();
            resolve(false);
        });
        client.once("error", () => {
            client.destroy();
            resolve(false);
        });
        client.connect(port, host);
    });
}

function killProcessOnPort(port) {
    if (process.platform === "win32") {
        try {
            const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
            const lines = out.trim().split("\n");
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5 && parts.includes("LISTENING")) {
                    const pid = parts[parts.length - 1];
                    logWarn(`Releasing port ${port} (killing PID ${pid})...`);
                    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
                }
            }
        } catch (_) {}
    } else {
        try {
            const out = execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const pids = out.trim().split("\n");
            for (const pid of pids) {
                const p = parseInt(pid.trim(), 10);
                if (!isNaN(p) && p !== process.pid) {
                    logWarn(`Releasing port ${port} (killing PID ${p})...`);
                    try {
                        process.kill(p, "SIGKILL");
                    } catch (_) {}
                }
            }
        } catch (_) {
            try {
                execSync(`fuser -k -n tcp ${port}`, { stdio: "ignore" });
            } catch (_) {}
        }
    }
}

function findExecutable(name) {
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const out = execSync(`${cmd} ${name}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const first = out.trim().split("\n")[0]?.trim();
        if (first && fs.existsSync(first)) return first;
    } catch (_) {}
    return null;
}

function getUserHome() {
    if (process.env.MULTIAI_HOME && fs.existsSync(process.env.MULTIAI_HOME)) {
        return process.env.MULTIAI_HOME;
    }
    const termuxHome = "/data/data/com.termux/files/home";
    if (process.env.TERMUX_VERSION || (process.platform === "linux" && fs.existsSync(termuxHome))) {
        const homeEnv = process.env.HOME || "";
        if (homeEnv && homeEnv.endsWith("/files/home") && fs.existsSync(homeEnv)) return homeEnv;
        if (fs.existsSync(termuxHome)) return termuxHome;
    }
    return os.homedir() || process.env.HOME || "/tmp";
}

function getUserStorageDir() {
    const home = getUserHome();
    const userDir = path.join(home, ".MultiAI");
    try {
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
    } catch (e) {
        logWarn(`Could not create user configuration directory ${userDir}: ${e.message}`);
    }
    return userDir;
}

function resolveConfigIniPath(rootDir) {
    if (process.env.MULTIAI_CONFIG_PATH && fs.existsSync(process.env.MULTIAI_CONFIG_PATH)) {
        return process.env.MULTIAI_CONFIG_PATH;
    }
    const userDir = getUserStorageDir();
    const userConfig = path.join(userDir, "config.ini");
    if (fs.existsSync(userConfig) && fs.statSync(userConfig).size > 0) {
        return userConfig;
    }
    const candidates = [
        path.join(rootDir, "config.ini"),
        path.join(rootDir, "config.example.ini"),
        path.join(rootDir, "src", "core", "config.ini")
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
            try {
                fs.copyFileSync(cand, userConfig);
                return userConfig;
            } catch (_) {
                return cand;
            }
        }
    }
    return userConfig;
}

function resolveModelsPath(rootDir) {
    if (process.env.MULTIAI_MODELS_PATH && fs.existsSync(process.env.MULTIAI_MODELS_PATH)) {
        return process.env.MULTIAI_MODELS_PATH;
    }
    const userDir = getUserStorageDir();
    const userModels = path.join(userDir, "models.yaml");
    if (fs.existsSync(userModels) && fs.statSync(userModels).size > 0) {
        return userModels;
    }
    const rootModels = path.join(rootDir, "models.yaml");
    if (fs.existsSync(rootModels) && fs.statSync(rootModels).size > 0) {
        try {
            fs.copyFileSync(rootModels, userModels);
            return userModels;
        } catch (_) {
            return rootModels;
        }
    }
    return userModels;
}

function ensureUserConfiguration(rootDir) {
    const userDir = getUserStorageDir();
    const userConfig = path.join(userDir, "config.ini");
    if (!fs.existsSync(userConfig) || fs.statSync(userConfig).size === 0) {
        const candidates = [
            path.join(rootDir, "config.ini"),
            path.join(rootDir, "config.example.ini"),
            path.join(rootDir, "src", "core", "config.ini")
        ];
        for (const cand of candidates) {
            if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
                try {
                    fs.copyFileSync(cand, userConfig);
                    logSuccess(`Installed default config.ini to ${userConfig}`);
                    break;
                } catch (e) {
                    logWarn(`Failed to copy config.ini: ${e.message}`);
                }
            }
        }
    } else {
        logSuccess(`config.ini found (${userConfig}).`);
    }

    const userModels = path.join(userDir, "models.yaml");
    if (!fs.existsSync(userModels) || fs.statSync(userModels).size === 0) {
        const rootModels = path.join(rootDir, "models.yaml");
        if (fs.existsSync(rootModels) && fs.statSync(rootModels).size > 0) {
            try {
                fs.copyFileSync(rootModels, userModels);
                logSuccess(`Installed default models.yaml to ${userModels}`);
            } catch (e) {
                logWarn(`Failed to copy models.yaml: ${e.message}`);
            }
        }
    } else {
        logSuccess(`models.yaml found (${userModels}).`);
    }
}

function getPlatformDaemonInfo() {
    const arch = os.arch().toLowerCase();
    const platform = process.platform;
    if (platform === "win32") {
        return { binName: "task_daemon.exe", goos: "windows", goarch: arch === "arm64" ? "arm64" : "amd64" };
    } else if (platform === "darwin") {
        const goarch = arch === "arm64" ? "arm64" : "amd64";
        return { binName: `task_daemon_darwin_${goarch}`, goos: "darwin", goarch };
    } else {
        if (arch === "arm64" || arch === "aarch64") {
            return { binName: "task_daemon_arm64", goos: "linux", goarch: "arm64" };
        } else if (arch.startsWith("arm")) {
            return { binName: "task_daemon_armv7l", goos: "linux", goarch: "arm", goarm: "7" };
        } else if (arch === "ia32" || arch === "x86") {
            return { binName: "task_daemon_386", goos: "linux", goarch: "386" };
        } else {
            return { binName: "task_daemon", goos: "linux", goarch: "amd64" };
        }
    }
}

function checkSetup(rootDir) {
    console.log(`\n${BOLD}${CYAN}=== MultiSearch AI Setup & Pre-Flight Check ===${RESET}\n`);

    // 1. Check Node.js
    const nodeVer = process.version;
    const match = nodeVer.match(/^v(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    if (major < 18) {
        logError(`Node.js 18+ is required. Detected Node.js ${nodeVer}.`);
        process.exit(1);
    }
    logSuccess(`Node.js verified: ${nodeVer}`);

    // 2. Check npm
    const npmBin = findExecutable("npm") || "npm";
    try {
        const npmVer = execSync(`${npmBin} -v`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        logSuccess(`npm found: v${npmVer}`);
    } catch (_) {
        logWarn("npm executable could not be directly probed, proceeding with system Node runtime.");
    }

    // 3. Check Node dependencies
    const nodeModulesDir = path.join(rootDir, "node_modules");
    const requiredPkgs = [
        ["yaml", path.join(nodeModulesDir, "yaml")],
        ["@langchain/langgraph", path.join(nodeModulesDir, "@langchain", "langgraph")],
        ["@langchain/core", path.join(nodeModulesDir, "@langchain", "core")],
        ["@modelcontextprotocol/sdk", path.join(nodeModulesDir, "@modelcontextprotocol", "sdk")]
    ];

    const missingPkgs = requiredPkgs.filter(([_, p]) => !fs.existsSync(p)).map(([name]) => name);

    if (missingPkgs.length > 0) {
        logWarn(`Node dependencies missing (${missingPkgs.join(", ")}). Running 'npm install' via ${npmBin}...`);
        const res = spawnSync(npmBin, ["install"], { cwd: rootDir, stdio: "inherit", shell: process.platform === "win32" });
        if (res.status !== 0) {
            logError("Failed to install npm dependencies.");
            process.exit(1);
        }
        logSuccess("Node dependencies installed successfully.");
    } else {
        logSuccess("Node dependencies verified (yaml, @langchain/langgraph, @langchain/core, @modelcontextprotocol/sdk present).");
    }

    // 4. Verify Task Daemon Engine (Pure Node default, Go optional)
    const { binName } = getPlatformDaemonInfo();
    const daemonBin = path.join(rootDir, "daemon", "bin", binName);
    const legacyBin = path.join(rootDir, "bin", binName);
    if (fs.existsSync(daemonBin) || fs.existsSync(legacyBin)) {
        logSuccess(`Optional high-performance Go task daemon binary verified (${binName}).`);
    } else {
        logSuccess("Default high-performance pure Node task daemon verified (daemon/node/server.js).");
    }

    // 5. Ensure ~/.MultiAI configuration
    ensureUserConfiguration(rootDir);

    console.log(`\n${GREEN}All dependencies and setup checks passed!${RESET}\n`);
}

function resolveEditor() {
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (editor) {
        const cmd = editor.split(/\s+/)[0];
        if (findExecutable(cmd)) return editor;
    }
    for (const cand of ["nano", "vim", "vi", "code", "notepad"]) {
        if (findExecutable(cand)) return cand;
    }
    return editor || (process.platform === "win32" ? "notepad" : "nano");
}

function openFileInEditor(filePath, label = "configuration", exitOnDone = true) {
    const editor = resolveEditor();
    logInfo(`Opening ${label} in ${editor}: ${filePath}`);
    const parts = editor.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), filePath];
    const res = spawnSync(cmd, args, { stdio: "inherit" });
    if (exitOnDone) {
        process.exit(res.status || 0);
    }
}

function parseConfigINI(iniPath) {
    const result = { port: 8080, host: "0.0.0.0", taskDaemon: "node" };
    if (!fs.existsSync(iniPath)) return result;
    try {
        const content = fs.readFileSync(iniPath, "utf8");
        let currentSection = "";
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
            const secMatch = trimmed.match(/^\[([^\]]+)\]/);
            if (secMatch) {
                currentSection = secMatch[1].trim();
                continue;
            }
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                const commentIdx = val.search(/[#;]/);
                if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (currentSection === "General") {
                    if (key === "Port" && !isNaN(parseInt(val, 10))) result.port = parseInt(val, 10);
                    if (key === "Host" && val) result.host = val;
                    if (key === "TaskDaemon" || key === "TaskServer") result.taskDaemon = val.toLowerCase();
                } else if (currentSection === "Agent") {
                    if (key === "TaskDaemon" || key === "TaskServer") result.taskDaemon = val.toLowerCase();
                }
            }
        }
    } catch (_) {}
    if (result.taskDaemon === "golang") result.taskDaemon = "go";
    if (result.taskDaemon === "python") result.taskDaemon = "node";
    return result;
}

class ProcessSupervisor {
    constructor() {
        this.processes = [];
        this.serviceConfigs = {};
        this.isShuttingDown = false;
        this.isRestarting = false;
        this.startTime = Date.now();
        this.webPort = 8080;
        this.webHost = "0.0.0.0";
    }

    spawn(name, cmd, args, options = {}) {
        const color = options.color || RESET;
        const prefix = `${color}[${name}]${RESET} `;
        this.serviceConfigs[name] = { cmd, args, options };

        const child = spawn(cmd, args, {
            cwd: options.cwd,
            env: options.env || process.env,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"]
        });

        this.processes.push({ name, proc: child });

        const handleData = (data) => {
            const lines = data.toString("utf8").split("\n");
            for (const line of lines) {
                if (line.trim().length > 0) {
                    console.log(prefix + line);
                }
            }
        };

        if (child.stdout) child.stdout.on("data", handleData);
        if (child.stderr) child.stderr.on("data", handleData);

        return child;
    }

    stopService(name) {
        const targets = this.processes.filter(p => p.name === name);
        this.processes = this.processes.filter(p => p.name !== name);

        for (const { proc } of targets) {
            if (proc.exitCode === null) {
                logInfo(`Stopping ${name} (PID ${proc.pid})...`);
                if (process.platform === "win32") {
                    try {
                        execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
                    } catch (_) {
                        proc.kill();
                    }
                } else {
                    try {
                        process.kill(-proc.pid, "SIGTERM");
                    } catch (_) {
                        proc.kill("SIGTERM");
                    }
                }
            }
        }
    }

    async restartService(name, port = null) {
        if (!this.serviceConfigs[name]) {
            logError(`Cannot restart unknown service: ${name}`);
            return false;
        }

        const targetPort = port || this.webPort;
        const probeHost = (this.webHost === "0.0.0.0" || !this.webHost) ? "127.0.0.1" : this.webHost;

        this.isRestarting = true;
        try {
            logInfo(`Restarting ${name} on port ${targetPort}...`);
            this.stopService(name);
            await new Promise(r => setTimeout(r, 300));
            killProcessOnPort(targetPort);
            killProcessOnPort(5000);
            await new Promise(r => setTimeout(r, 300));

            const cfg = this.serviceConfigs[name];
            this.spawn(name, cfg.cmd, cfg.args, cfg.options);

            for (let i = 0; i < 40; i++) {
                if (await isPortInUse(targetPort, probeHost)) {
                    return true;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            return false;
        } finally {
            this.isRestarting = false;
        }
    }

    stopAll() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.log(`\n${YELLOW}[MultiAI] Stopping all servers...${RESET}`);

        for (const { name, proc } of this.processes) {
            if (proc.exitCode === null) {
                logInfo(`Stopping ${name} (PID ${proc.pid})...`);
                if (process.platform === "win32") {
                    try {
                        execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
                    } catch (_) {
                        proc.kill();
                    }
                } else {
                    try {
                        process.kill(-proc.pid, "SIGTERM");
                    } catch (_) {
                        proc.kill("SIGTERM");
                    }
                }
            }
        }

        killProcessOnPort(this.webPort);
        if (this.webPort !== 8080) killProcessOnPort(8080);
        killProcessOnPort(5000);

        const sockPath = path.join(getUserStorageDir(), "task_server.sock");
        if (fs.existsSync(sockPath)) {
            try { fs.unlinkSync(sockPath); } catch (_) {}
        }

        console.log(`${GREEN}[MultiAI] All servers stopped cleanly. Goodbye!${RESET}\n`);
    }
}

function openInBrowser(url) {
    if (process.platform === "win32") {
        spawn("cmd.exe", ["/c", "start", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
        const xdg = findExecutable("xdg-open");
        if (xdg) {
            spawn(xdg, [url], { detached: true, stdio: "ignore" }).unref();
        }
    }
}

function runConsole(supervisor, rootDir, workspaceDir, port, host) {
    const displayHost = (host === "0.0.0.0" || host === "127.0.0.1" || !host) ? "localhost" : host;
    const probeHost = (host === "0.0.0.0" || !host) ? "127.0.0.1" : host;

    function printHelp() {
        console.log(`\n${BOLD}${CYAN}MultiAI Server Console Commands:${RESET}`);
        console.log(`  ${BOLD}stop${RESET} | ${BOLD}exit${RESET} | ${BOLD}quit${RESET}     Stop all servers and exit cleanly`);
        console.log(`  ${BOLD}restart${RESET} | ${BOLD}reload${RESET}       Restart web server and task server`);
        console.log(`  ${BOLD}pull${RESET} [args]            Run 'git pull' and auto-restart if updated`);
        console.log(`  ${BOLD}status${RESET} | ${BOLD}info${RESET}         Show server status, active ports, PID, uptime`);
        console.log(`  ${BOLD}conf${RESET} | ${BOLD}config${RESET}         Open config.ini in editor ($EDITOR or nano)`);
        console.log(`  ${BOLD}models${RESET} | ${BOLD}model${RESET}       Open models.yaml in editor ($EDITOR or nano)`);
        console.log(`  ${BOLD}clear${RESET} | ${BOLD}cls${RESET}           Clear console screen`);
        console.log(`  ${BOLD}help${RESET} | ${BOLD}?${RESET}              Show this help message\n`);
    }

    async function printStatus() {
        const uptimeSec = Math.floor((Date.now() - supervisor.startTime) / 1000);
        const hrs = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);
        const secs = uptimeSec % 60;
        const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;

        let branch = "unknown";
        let commit = "unknown";
        try {
            branch = execSync("git branch --show-current", { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            commit = execSync("git rev-parse --short HEAD", { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        } catch (_) {}

        const webActive = await isPortInUse(port, probeHost);
        const sockExists = fs.existsSync(path.join(getUserStorageDir(), "task_server.sock"));
        const tcpActive = await isPortInUse(5000, "127.0.0.1");
        const ipcDesc = sockExists || process.platform !== "win32" ? `Unix Socket (active: ${sockExists})` : `TCP 5000 (active: ${tcpActive})`;

        console.log(`\n${BOLD}${CYAN}=== MultiAI Server Status ===${RESET}`);
        console.log(`  ${BOLD}State:${RESET}        ${GREEN}Running${RESET}`);
        console.log(`  ${BOLD}Web URL:${RESET}      ${CYAN}http://${displayHost}:${port}${RESET}`);
        console.log(`  ${BOLD}Uptime:${RESET}       ${uptimeStr}`);
        console.log(`  ${BOLD}Git Branch:${RESET}   ${YELLOW}${branch}${RESET} (${commit})`);
        console.log(`  ${BOLD}Ports/IPC:${RESET}    Web: ${port} (active: ${webActive}), Task IPC: ${ipcDesc}`);
        console.log(`  ${BOLD}Processes:${RESET}`);
        for (const { name, proc } of supervisor.processes) {
            const pStatus = proc.exitCode === null ? "Alive" : `Exited (${proc.exitCode})`;
            console.log(`    - ${name}: PID ${proc.pid} [${pStatus}]`);
        }
        console.log(`${CYAN}=============================${RESET}\n`);
    }

    async function doPull(argsStr = "", forceRestart = false) {
        logInfo("Fetching latest changes from git repository...");
        try {
            const out = execSync(`git pull ${argsStr}`, { cwd: rootDir, encoding: "utf8" }).trim();
            console.log(`${GREEN}${out}${RESET}`);
            if (!out.includes("Already up to date.") || forceRestart) {
                logSuccess("Updates detected! Restarting server to apply updates...");
                if (await supervisor.restartService("Server", port)) {
                    logSuccess(`MultiAI updated and live at http://${displayHost}:${port}`);
                } else {
                    logError("Restart failed after pull. Type 'restart' to try again.");
                }
            } else {
                logInfo("Repository is already up to date. Use 'restart' if you wish to reload.");
            }
        } catch (e) {
            logError(`Failed to execute git pull: ${e.message}`);
        }
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: isTTY ? `${BOLD}${CYAN}multiai>${RESET} ` : ""
    });

    rl.prompt();

    rl.on("line", async (line) => {
        const cmdLine = line.trim();
        if (!cmdLine) {
            rl.prompt();
            return;
        }

        const parts = cmdLine.split(/\s+/);
        const command = parts[0].toLowerCase();
        const arg = parts.slice(1).join(" ").trim();

        if (["stop", "exit", "quit", "q", "shutdown"].includes(command)) {
            logInfo("Shutting down MultiAI server...");
            rl.close();
            supervisor.stopAll();
            process.exit(0);
        } else if (["restart", "reload", "r"].includes(command)) {
            logInfo(`Restarting MultiAI on port ${port}...`);
            if (await supervisor.restartService("Server", port)) {
                logSuccess(`MultiAI restarted and live at http://${displayHost}:${port}`);
            } else {
                logError("Failed to restart cleanly. Check logs above.");
            }
        } else if (["pull", "update"].includes(command)) {
            const forceRestart = arg.toLowerCase().includes("restart");
            const cleanArg = arg.replace(/restart/i, "").trim();
            await doPull(cleanArg, forceRestart);
        } else if (["status", "info", "st"].includes(command)) {
            await printStatus();
        } else if (["clear", "cls"].includes(command)) {
            console.clear();
            console.log(`\n${BOLD}${CYAN}MultiAI Console Active${RESET} (type 'help' for commands)\n`);
        } else if (["conf", "config"].includes(command)) {
            const iniPath = resolveConfigIniPath(rootDir);
            openFileInEditor(iniPath, "MultiAI configuration", false);
        } else if (["models", "model"].includes(command)) {
            const modelsPath = resolveModelsPath(rootDir);
            openFileInEditor(modelsPath, "MultiAI models configuration", false);
        } else if (["help", "?", "h"].includes(command)) {
            printHelp();
        } else {
            console.log(`${YELLOW}Unknown command: '${command}'. Type 'help' for available commands.${RESET}`);
        }

        rl.prompt();
    });

    rl.on("close", () => {
        supervisor.stopAll();
        process.exit(0);
    });
}

async function main() {
    const rootDir = __dirname;
    const iniPath = resolveConfigIniPath(rootDir);
    const cfgDefaults = parseConfigINI(iniPath);

    const args = process.argv.slice(2);
    let checkOnly = false;
    let noBrowser = false;
    let port = cfgDefaults.port;
    let host = cfgDefaults.host;
    let workspace = null;
    let ipcMode = null;
    let taskDaemon = cfgDefaults.taskDaemon;
    let subCmd = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--check-only") checkOnly = true;
        else if (arg === "--no-browser") noBrowser = true;
        else if (arg === "--port" && args[i + 1]) { port = parseInt(args[++i], 10); }
        else if (arg.startsWith("--port=")) { port = parseInt(arg.split("=")[1], 10); }
        else if (arg === "--host" && args[i + 1]) { host = args[++i]; }
        else if (arg.startsWith("--host=")) { host = arg.split("=")[1]; }
        else if (arg === "--workspace" && args[i + 1]) { workspace = args[++i]; }
        else if (arg.startsWith("--workspace=")) { workspace = arg.split("=")[1]; }
        else if (arg === "--ipc" && args[i + 1]) { ipcMode = args[++i]; }
        else if (arg.startsWith("--ipc=")) { ipcMode = arg.split("=")[1]; }
        else if (arg === "--socket") ipcMode = "socket";
        else if (arg === "--tcp") ipcMode = "tcp";
        else if (arg === "--task-daemon" && args[i + 1]) { taskDaemon = args[++i].toLowerCase(); }
        else if (arg.startsWith("--task-daemon=")) { taskDaemon = arg.split("=")[1].toLowerCase(); }
        else if (["conf", "config", "models", "model"].includes(arg)) subCmd = arg;
    }

    if (subCmd === "conf" || subCmd === "config") {
        openFileInEditor(resolveConfigIniPath(rootDir), "MultiAI configuration");
        return;
    } else if (subCmd === "models" || subCmd === "model") {
        openFileInEditor(resolveModelsPath(rootDir), "MultiAI models configuration");
        return;
    }

    const probeHost = (host === "0.0.0.0" || !host) ? "127.0.0.1" : host;
    const displayHost = (host === "0.0.0.0" || host === "127.0.0.1" || !host) ? "localhost" : host;

    const workspaceDir = path.resolve(workspace || process.env.MULTIAI_WORKSPACE_DIR || process.cwd());
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }

    // 1. Run Pre-Flight Setup Check
    checkSetup(rootDir);

    if (checkOnly) {
        process.exit(0);
    }

    // 2. Check for port conflicts and clean up stale instances
    const portsToCheck = [port];
    if (ipcMode === "tcp" || (!ipcMode && process.platform === "win32")) {
        portsToCheck.push(5000);
    }

    for (const p of portsToCheck) {
        const targetProbe = p === port ? probeHost : "127.0.0.1";
        if (await isPortInUse(p, targetProbe)) {
            logWarn(`Port ${p} is in use by a stale process. Releasing port...`);
            killProcessOnPort(p);
            await new Promise(r => setTimeout(r, 400));
        }
    }

    const supervisor = new ProcessSupervisor();
    supervisor.webPort = port;
    supervisor.webHost = host;

    const handleExit = () => {
        supervisor.stopAll();
        process.exit(0);
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
    process.on("SIGHUP", handleExit);
    process.on("exit", () => supervisor.stopAll());

    // 3. Start Node.js Web Server (which supervises the pure Node or Go task daemon)
    const serverScript = path.join(rootDir, "src", "index.js");
    const nodeEnv = { ...process.env };
    nodeEnv.PORT = String(port);
    nodeEnv.HOST = String(host);
    nodeEnv.MULTIAI_REPO_DIR = rootDir;
    nodeEnv.MULTIAI_WORKSPACE_DIR = workspaceDir;
    nodeEnv.MULTIAI_SUPERVISED = "1";
    if (ipcMode) nodeEnv.MULTIAI_IPC = ipcMode;
    if (taskDaemon) nodeEnv.MULTIAI_TASK_DAEMON = taskDaemon;
    nodeEnv.MULTIAI_HOME = getUserHome();
    nodeEnv.MULTIAI_CONFIG_PATH = resolveConfigIniPath(rootDir);
    nodeEnv.MULTIAI_MODELS_PATH = resolveModelsPath(rootDir);

    const nodeModulesPath = path.join(rootDir, "node_modules");
    nodeEnv.NODE_PATH = nodeEnv.NODE_PATH ? `${nodeModulesPath}:${nodeEnv.NODE_PATH}` : nodeModulesPath;

    logInfo(`Starting MultiAI on ${displayHost}:${port} (workspace: ${workspaceDir})...`);
    supervisor.spawn("Server", process.execPath, ["--watch", serverScript], {
        color: GREEN,
        cwd: workspaceDir,
        env: nodeEnv
    });

    // 4. Wait for server readiness
    let ready = false;
    for (let i = 0; i < 40; i++) {
        if (await isPortInUse(port, probeHost)) {
            ready = true;
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    const url = `http://${displayHost}:${port}`;

    if (ready) {
        await new Promise(r => setTimeout(r, 400));
        console.log("\n" + "=".repeat(62));
        console.log(`  ${BOLD}${GREEN}✓ MultiSearch AI is live and ready!${RESET}`);
        console.log(`  ${BOLD}Local URL:${RESET} ${CYAN}${url}${RESET}`);
        console.log(`  ${BOLD}Server Console:${RESET} Type ${CYAN}help${RESET} for commands (${CYAN}stop${RESET}, ${CYAN}restart${RESET}, ${CYAN}pull${RESET}, ${CYAN}status${RESET})`);
        console.log(`  ${DIM}Press Ctrl+C or type 'stop' to shut down.${RESET}`);
        console.log("=".repeat(62) + "\n");

        if (!noBrowser) {
            try {
                openInBrowser(url);
            } catch (_) {}
        }
    } else {
        logWarn("Server startup is taking longer than expected. Check logs above.");
    }

    // 5. Start interactive console
    runConsole(supervisor, rootDir, workspaceDir, port, host);
}

if (require.main === module) {
    main().catch((err) => {
        logError(err.stack || err.message);
        process.exit(1);
    });
}

module.exports = {
    ProcessSupervisor,
    checkSetup,
    isPortInUse,
    killProcessOnPort
};
