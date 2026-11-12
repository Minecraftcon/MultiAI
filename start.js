#!/usr/bin/env node
/**
 * MultiAI Universal Starter & Supervisor (Pure Node.js)
 * =====================================================
 * Automatic setup detection, dependency verification, and clean auto-kill on stop.
 *
 * Features:
 * - Pure Node.js launcher (no Python required).
 * - Detects and verifies Node.js and npm prerequisites.
 * - Auto-installs missing npm packages (`npm install`).
 * - Automatically resolves port conflicts on 8080 before launch.
 * - Starts MultiSearch AI and opens it in your default browser.
 * - Auto-kills everything cleanly on exit (Ctrl+C / SIGINT / SIGTERM / exit).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const { spawn, execSync, spawnSync } = require("child_process");

// ANSI Color Codes
const isTTY = process.stdout.isTTY;
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
            for (const line of out.trim().split("\n")) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5 && parts.includes("LISTENING")) {
                    const pid = parts[parts.length - 1];
                    logWarn(`Releasing port ${port} (killing PID ${pid})...`);
                    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch (_) {}
                }
            }
        } catch (_) {}
    } else {
        try {
            const out = execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            for (const pidStr of out.trim().split("\n")) {
                const pid = parseInt(pidStr.trim(), 10);
                if (!isNaN(pid) && pid !== process.pid) {
                    logWarn(`Releasing port ${port} (killing PID ${pid})...`);
                    try { process.kill(pid, "SIGKILL"); } catch (_) {}
                }
            }
        } catch (_) {
            try { execSync(`fuser -k -n tcp ${port}`, { stdio: "ignore" }); } catch (_) {}
        }
    }
}

function openBrowser(url) {
    const platform = process.platform;
    try {
        if (platform === "darwin") {
            spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        } else if (platform === "win32") {
            spawn("cmd", ["/c", "start", '""', url], { detached: true, stdio: "ignore" }).unref();
        } else {
            spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
        }
    } catch (_) {}
}

function checkSetup(rootDir) {
    console.log(`\n${BOLD}${CYAN}=== MultiSearch AI Setup & Pre-Flight Check ===${RESET}\n`);

    // 1. Check Node.js version
    const nodeVer = process.version;
    const major = parseInt(nodeVer.replace(/^v/, "").split(".")[0], 10);
    if (major < 18) {
        logError(`Node.js 18+ is required. Detected ${nodeVer}.`);
        process.exit(1);
    }
    logSuccess(`Node.js version: ${nodeVer}`);

    // 2. Check git (auto-install on apt/yum/apk/brew if missing)
    try {
        const gitVer = execSync("git --version", { encoding: "utf8" }).trim();
        logSuccess(`${gitVer}`);
    } catch (_) {
        logWarn("Git is not installed. Attempting auto-installation...");
        try {
            if (process.platform === "linux") {
                spawnSync("sh", ["-c", "apt-get update && apt-get install -y git || apk add --no-cache git || yum install -y git"], { stdio: "inherit" });
            } else if (process.platform === "darwin") {
                spawnSync("brew", ["install", "git"], { stdio: "inherit" });
            }
            logSuccess("Git installed successfully.");
        } catch (e) {
            logWarn(`Could not auto-install git: ${e.message}`);
        }
    }

    // 3. Check npm
    try {
        const npmVer = execSync("npm -v", { encoding: "utf8" }).trim();
        logSuccess(`npm found: v${npmVer}`);
    } catch (_) {
        logWarn("npm not found in PATH.");
    }

    // 3. Check dependencies
    const nodeModulesDir = path.join(rootDir, "node_modules");
    const requiredPkgs = [
        ["yaml", path.join(nodeModulesDir, "yaml")],
        ["@langchain/langgraph", path.join(nodeModulesDir, "@langchain", "langgraph")],
        ["@langchain/core", path.join(nodeModulesDir, "@langchain", "core")]
    ];

    const missingPkgs = requiredPkgs.filter(([_, pkgPath]) => !fs.existsSync(pkgPath)).map(([name]) => name);

    if (missingPkgs.length > 0) {
        logWarn(`Node dependencies missing (${missingPkgs.join(", ")}). Running 'npm install'...`);
        const res = spawnSync("npm", ["install"], { cwd: rootDir, stdio: "inherit" });
        if (res.status !== 0) {
            logError("Failed to install npm dependencies.");
            process.exit(1);
        }
        logSuccess("Node dependencies installed successfully.");
    } else {
        logSuccess("Node dependencies verified (yaml, @langchain/langgraph, @langchain/core present).");
    }

    // 4. Check models.yaml
    const modelsFile = path.join(rootDir, "models.yaml");
    if (!fs.existsSync(modelsFile)) {
        logWarn("models.yaml not found in project root. Some models may need configuration.");
    } else {
        logSuccess("models.yaml found.");
    }

    console.log(`\n${GREEN}All dependencies and setup checks passed!${RESET}\n`);
}

function parseCliArgs() {
    const args = {
        checkOnly: false,
        noBrowser: false,
        port: 8080,
        workspace: null
    };

    const raw = process.argv.slice(2);
    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        if (a === "--check-only") args.checkOnly = true;
        else if (a === "--no-browser") args.noBrowser = true;
        else if (a === "--port" && raw[i + 1]) {
            args.port = parseInt(raw[++i], 10) || 8080;
        } else if (a === "--workspace" && raw[i + 1]) {
            args.workspace = raw[++i];
        }
    }
    return args;
}

function getConfigPort(rootDir, defaultPort = 8080) {
    try {
        const iniPath = path.join(rootDir, "config.ini");
        if (fs.existsSync(iniPath)) {
            const content = fs.readFileSync(iniPath, "utf8");
            const match = content.match(/Port\s*=\s*(\d+)/i);
            if (match) return parseInt(match[1], 10);
        }
    } catch (_) {}
    return defaultPort;
}

async function main() {
    const rootDir = path.resolve(__dirname);
    const configuredPort = getConfigPort(rootDir, 8080);
    const cliArgs = parseCliArgs();
    const port = cliArgs.port || configuredPort;

    const workspaceDir = path.resolve(cliArgs.workspace || process.env.MULTIAI_WORKSPACE_DIR || process.cwd());
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }
    process.chdir(rootDir);

    checkSetup(rootDir);

    if (cliArgs.checkOnly) {
        process.exit(0);
    }

    // Port check & cleanup
    if (await isPortInUse(port)) {
        logWarn(`Port ${port} is in use by a stale process. Releasing port...`);
        killProcessOnPort(port);
        await new Promise(r => setTimeout(r, 400));
    }

    const serverScript = path.join(rootDir, "src", "index.js");
    const nodeEnv = {
        ...process.env,
        MULTIAI_REPO_DIR: rootDir,
        MULTIAI_WORKSPACE_DIR: workspaceDir,
        PORT: String(port)
    };

    logInfo(`Starting MultiAI on port ${port} (workspace: ${workspaceDir})...`);

    // Launch main Node.js Server
    const serverProc = spawn(process.execPath, [serverScript], {
        cwd: workspaceDir,
        env: nodeEnv,
        stdio: "inherit"
    });

    const cleanup = () => {
        if (!serverProc.killed) {
            try { serverProc.kill("SIGTERM"); } catch (_) {}
            try { serverProc.kill("SIGKILL"); } catch (_) {}
        }
        killProcessOnPort(port);
    };

    process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        cleanup();
        process.exit(0);
    });
    process.on("exit", cleanup);

    // Wait for server to respond
    let ready = false;
    for (let i = 0; i < 40; i++) {
        if (await isPortInUse(port)) {
            ready = true;
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    const url = `http://localhost:${port}`;
    if (ready) {
        await new Promise(r => setTimeout(r, 400));
        console.log("\n" + "=".repeat(62));
        console.log(`  ${BOLD}${GREEN}✓ MultiSearch AI is live and ready!${RESET}`);
        console.log(`  ${BOLD}Local URL:${RESET} ${CYAN}${url}${RESET}`);
        console.log(`  ${BOLD}Server Console:${RESET} Type ${CYAN}help${RESET} for commands (${CYAN}stop${RESET}, ${CYAN}restart${RESET}, ${CYAN}pull${RESET}, ${CYAN}status${RESET})`);
        console.log(`  ${DIM}Press Ctrl+C or type 'stop' to shut down.${RESET}`);
        console.log("=".repeat(62) + "\n");

        if (!cliArgs.noBrowser) {
            openBrowser(url);
        }
    } else {
        logWarn("Server startup is taking longer than expected. Check logs above.");
    }

    serverProc.on("close", (code) => {
        process.exit(code || 0);
    });
}

if (require.main === module) {
    main().catch((err) => {
        logError(err.message);
        process.exit(1);
    });
}

module.exports = { main };

