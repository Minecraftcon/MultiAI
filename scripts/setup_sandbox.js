#!/usr/bin/env node
/**
 * MultiAI Termux PRoot Sandbox Provisioner
 * =========================================
 * Installs and provisions the dedicated 'debian-sandbox' container
 * using proot-distro for safe, isolated task server execution in Termux.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync, execSync } = require("child_process");

const CYAN = "\x1b[96m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function log(msg) {
    console.log(`${CYAN}[MultiAI Sandbox]${RESET} ${msg}`);
}
function logSuccess(msg) {
    console.log(`${GREEN}[MultiAI Sandbox]${RESET} ${msg}`);
}
function logWarn(msg) {
    console.log(`${YELLOW}[MultiAI Sandbox]${RESET} ${msg}`);
}
function logError(msg) {
    console.error(`${RED}[MultiAI Sandbox ERROR]${RESET} ${msg}`);
}

function which(cmd) {
    try {
        const out = execSync(`command -v ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim();
        return out || null;
    } catch (_) {
        return null;
    }
}

function getPdCmd() {
    if (which("pd")) return "pd";
    if (which("proot-distro")) return "proot-distro";
    return null;
}

function isContainerInstalled(pdCmd, name = "debian-sandbox") {
    const prefix = process.env.PREFIX || "/data/data/com.termux/files/usr";
    const rootfsDir = path.join(prefix, "var", "lib", "proot-distro", "installed-rootfs", name);
    if (fs.existsSync(rootfsDir)) return true;

    const res = spawnSync(pdCmd, ["login", name, "--", "true"], { stdio: "ignore" });
    return res.status === 0;
}

function configureMultiAISandboxConfig() {
    const home = os.homedir();
    const configDir = path.join(home, ".MultiAI");
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const configFile = path.join(configDir, "vm_conf.json");

    let data = {};
    if (fs.existsSync(configFile)) {
        try {
            data = JSON.parse(fs.readFileSync(configFile, "utf8"));
        } catch (_) {
            data = {};
        }
    }

    data.enabled = true;
    data.active_profile = "proot";
    if (!data.profiles) data.profiles = {};

    data.profiles.proot = {
        id: "proot",
        name: "PRoot Distro",
        badge: "Android / Termux",
        description: "Syscall emulation sandbox for non-root containers and Termux environments.",
        icon: "smartphone",
        mode: "daemon",
        startup: "pd sh debian-sandbox --bind {PROJECT_PATH}:/workspace --bind {DATA_DIR}:/data -- node /workspace/daemon/node/server.js --port {TASK_PORT}",
        detect_cmd: "(command -v pd || command -v proot-distro) && (pd login debian-sandbox -- true 2>/dev/null || proot-distro login debian-sandbox -- true 2>/dev/null || [ -d \"${PREFIX:-/data/data/com.termux/files/usr}/var/lib/proot-distro/installed-rootfs/debian-sandbox\" ])"
    };

    fs.writeFileSync(configFile, JSON.stringify(data, null, 2), "utf8");
    logSuccess(`Updated MultiAI sandbox config at ${configFile} (enabled: true, profile: proot)`);
}

function main() {
    console.log(`${BOLD}${CYAN}==============================================================${RESET}`);
    console.log(`${BOLD} MultiAI - PRoot Sandbox Setup ('debian-sandbox') ${RESET}`);
    console.log(`${BOLD}${CYAN}==============================================================${RESET}\n`);

    const isTermux = (
        process.platform === "android"
        || Boolean(process.env.TERMUX_VERSION)
        || fs.existsSync("/data/data/com.termux")
    );

    if (!isTermux) {
        logWarn("Notice: This script is intended for Android/Termux environments.");
        logWarn("Desktop Linux typically uses Bubblewrap ('bwrap') or Docker without setup.");
    }

    const pdCmd = getPdCmd();
    if (!pdCmd) {
        logWarn("'proot-distro' is not installed in Termux.");
        log("Installing 'proot-distro' via pkg...");
        const pkgRes = spawnSync("pkg", ["install", "-y", "proot-distro"], { stdio: "inherit" });
        if (pkgRes.status !== 0) {
            logError("Failed to install proot-distro. Please run 'pkg install proot-distro' manually.");
            process.exit(1);
        }
    }

    const effectivePd = getPdCmd();
    if (!effectivePd) {
        logError("proot-distro still not found on PATH.");
        process.exit(1);
    }

    const containerName = "debian-sandbox";
    if (isContainerInstalled(effectivePd, containerName)) {
        logSuccess(`Container '${containerName}' is already installed.`);
    } else {
        log(`Installing container '${containerName}' via ${effectivePd}...`);
        const instRes = spawnSync(effectivePd, ["install", "--override-alias", containerName, "debian"], { stdio: "inherit" });
        if (instRes.status !== 0) {
            logError(`Failed to install container '${containerName}'.`);
            process.exit(1);
        }
        logSuccess(`Container '${containerName}' installed successfully.`);
    }

    configureMultiAISandboxConfig();
    console.log(`\n${BOLD}${GREEN}Setup complete! Sandbox is ready.${RESET}`);
}

main();
