// Sandbox / VM Configuration Manager for MultiAI
// Supports PRoot, Bubblewrap (bwrap), Docker, and Direct Host execution
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const DEFAULT_SANDBOX_CONFIG = {
    enabled: false,
    active_profile: "bwrap", // "bwrap" | "proot" | "docker"
    ipc_type: process.platform === "win32" ? "tcp" : "socket", // "socket" (default Unix sox) | "tcp"
    profiles: {
        bwrap: {
            id: "bwrap",
            name: "Bubblewrap",
            badge: "Linux",
            description: "Unprivileged user namespaces with read-only root and workspace binding.",
            icon: "shield",
            mode: "daemon",
            startup: 'bwrap --ro-bind / / {SHIELD_MOUNTS} --bind {PROJECT_PATH} {PROJECT_PATH} --bind {DATA_DIR} {DATA_DIR} --tmpfs /tmp --proc /proc --dev /dev -- python3 {TASK_SERVER_SCRIPT} {IPC_ARGS}',
            detect_cmd: "command -v bwrap"
        },
        proot: {
            id: "proot",
            name: "PRoot Distro",
            badge: "Android / Termux",
            description: "Syscall emulation sandbox for non-root containers and Termux environments.",
            icon: "smartphone",
            mode: "daemon",
            startup: 'pd sh debian-sandbox --bind {PROJECT_PATH}:/workspace --bind {DATA_DIR}:/data -- python3 /workspace/task_server.py {IPC_ARGS}',
            detect_cmd: '(command -v pd || command -v proot-distro) && (pd login debian-sandbox -- true 2>/dev/null || proot-distro login debian-sandbox -- true 2>/dev/null || [ -d "${PREFIX:-/data/data/com.termux/files/usr}/var/lib/proot-distro/installed-rootfs/debian-sandbox" ])'
        },
        docker: {
            id: "docker",
            name: "Docker / Podman",
            badge: "Container",
            description: "Hardware-isolated OCI container daemon with volume and port binding.",
            icon: "box",
            mode: "daemon",
            startup: 'docker run --rm -p {TASK_PORT}:5000 -v {PROJECT_PATH}:/workspace -v {DATA_DIR}:/data multiai-sandbox:latest',
            detect_cmd: "command -v docker || command -v podman"
        }
    }
};

const DIRECT_PROFILE = {
    id: "direct",
    name: "Direct Host",
    badge: "Host",
    description: "Executes directly on host operating system without any sandbox container boundaries.",
    icon: "terminal",
    mode: "direct",
    startup: 'python3 {TASK_SERVER_SCRIPT} {IPC_ARGS}',
    detect_cmd: "true"
};

function getStorageDir() {
    const home = os.homedir();
    const multiaiDir = path.join(home, ".MultiAI");
    if (!fs.existsSync(multiaiDir)) {
        try {
            fs.mkdirSync(multiaiDir, { recursive: true });
        } catch (_) {}
    }
    return multiaiDir;
}

function getSandboxConfigPath() {
    return path.join(getStorageDir(), "vm_conf.json");
}

function loadSandboxConfig() {
    const configPath = getSandboxConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, "utf8");
            const parsed = JSON.parse(raw);
            const profiles = {
                ...DEFAULT_SANDBOX_CONFIG.profiles,
                ...(parsed.profiles || {})
            };
            delete profiles.auto;
            delete profiles.direct;

            if (profiles.proot) {
                if (profiles.proot.startup && (profiles.proot.startup.includes("/workspace/task_server/server.py") || profiles.proot.startup.includes("pd sh debian "))) {
                    profiles.proot.startup = 'pd sh debian-sandbox --bind {PROJECT_PATH}:/workspace --bind {DATA_DIR}:/data -- python3 /workspace/task_server.py --port {TASK_PORT}';
                }
                profiles.proot.detect_cmd = DEFAULT_SANDBOX_CONFIG.profiles.proot.detect_cmd;
            }

            if (profiles.bwrap && profiles.bwrap.startup) {
                if (!profiles.bwrap.startup.includes("{SHIELD_MOUNTS}")) {
                    profiles.bwrap.startup = profiles.bwrap.startup.replace(
                        "--ro-bind / /",
                        "--ro-bind / / {SHIELD_MOUNTS}"
                    );
                }
            }

            // Migrate legacy templates to use {IPC_ARGS}
            for (const p of Object.values(profiles)) {
                if (p.startup && p.id !== "docker" && p.startup.includes("--port {TASK_PORT}")) {
                    p.startup = p.startup.replace("--port {TASK_PORT}", "{IPC_ARGS}");
                }
            }

            let active = parsed.active_profile;
            if (!active || active === "auto" || !profiles[active]) {
                active = detectPlatformDefault();
            }

            let isEnabled = parsed.enabled !== undefined ? Boolean(parsed.enabled) : DEFAULT_SANDBOX_CONFIG.enabled;
            if (process.env.MULTIAI_SANDBOX === "0" || (process.argv && process.argv.includes("--no-sandbox"))) {
                isEnabled = false;
            }

            // IPC Type Resolution: CLI args override env var, which overrides config, defaulting to Unix socket on POSIX
            let ipcType = parsed.ipc_type;
            const argv = process.argv || [];
            if (argv.includes("--tcp") || process.env.MULTIAI_IPC === "tcp") {
                ipcType = "tcp";
            } else if (argv.includes("--socket") || argv.includes("--unix") || process.env.MULTIAI_IPC === "socket" || process.env.MULTIAI_IPC === "unix") {
                ipcType = "socket";
            } else {
                for (let i = 0; i < argv.length - 1; i++) {
                    if (argv[i] === "--ipc") {
                        ipcType = argv[i + 1] === "tcp" ? "tcp" : "socket";
                        break;
                    }
                }
            }

            if (!ipcType) {
                ipcType = process.platform === "win32" ? "tcp" : "socket";
            }

            const cfg = {
                enabled: isEnabled,
                active_profile: active,
                ipc_type: ipcType,
                profiles
            };
            return cfg;
        }
    } catch (e) {
        console.warn(`[SANDBOX] Failed to load ${configPath}, using defaults:`, e.message);
    }

    let defaultIpc = DEFAULT_SANDBOX_CONFIG.ipc_type;
    const argv = process.argv || [];
    if (argv.includes("--tcp") || process.env.MULTIAI_IPC === "tcp") {
        defaultIpc = "tcp";
    } else if (argv.includes("--socket") || argv.includes("--unix") || process.env.MULTIAI_IPC === "socket" || process.env.MULTIAI_IPC === "unix") {
        defaultIpc = "socket";
    }

    const defaultCfg = {
        enabled: (process.env.MULTIAI_SANDBOX === "0" || (process.argv && process.argv.includes("--no-sandbox")))
            ? false
            : DEFAULT_SANDBOX_CONFIG.enabled,
        active_profile: detectPlatformDefault(),
        ipc_type: defaultIpc,
        profiles: { ...DEFAULT_SANDBOX_CONFIG.profiles }
    };
    saveSandboxConfig(defaultCfg);
    return defaultCfg;
}

function saveSandboxConfig(config) {
    const configPath = getSandboxConfigPath();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
        return true;
    } catch (e) {
        console.error(`[SANDBOX] Failed to save ${configPath}:`, e.message);
        return false;
    }
}

function isCommandAvailable(cmd) {
    if (!cmd || cmd === "true") return true;
    try {
        execSync(cmd, { stdio: "ignore", timeout: 1500, shell: "/bin/sh" });
        return true;
    } catch (_) {
        return false;
    }
}

function hasBinary(bin) {
    try {
        execSync(`command -v ${bin}`, { stdio: "ignore", timeout: 1500, shell: "/bin/sh" });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Validates whether the given profile's binary AND container environment are truly installed and usable.
 * @param {Object} profile 
 * @returns {{ ok: boolean, reason?: string, help?: string }}
 */
function verifyProfileEnvironment(profile) {
    if (!profile || profile.mode === "direct" || profile.id === "direct") {
        return { ok: true };
    }

    if (profile.id === "proot") {
        const hasPd = hasBinary("pd") || hasBinary("proot-distro");
        if (!hasPd) {
            return {
                ok: false,
                reason: "PRoot Distro package ('proot-distro' or 'pd') is not installed in Termux.",
                help: "Run: pkg install proot-distro"
            };
        }

        // Check if debian-sandbox container directory or instance actually exists
        const pdCmd = hasBinary("pd") ? "pd" : "proot-distro";
        const prefixDir = process.env.PREFIX || "/data/data/com.termux/files/usr";
        const rootfsDir = path.join(prefixDir, "var/lib/proot-distro/installed-rootfs/debian-sandbox");

        let containerExists = false;
        try {
            if (fs.existsSync(rootfsDir)) {
                containerExists = true;
            }
        } catch (_) {}

        if (!containerExists) {
            try {
                execSync(`${pdCmd} login debian-sandbox -- true`, { stdio: "ignore", timeout: 2500, shell: "/bin/sh" });
                containerExists = true;
            } catch (_) {}
        }

        if (!containerExists) {
            return {
                ok: false,
                reason: "PRoot container 'debian-sandbox' does not exist or is not installed.",
                help: "Create the container in Termux by running:\n    pd install debian --name debian-sandbox"
            };
        }

        return { ok: true };
    }

    if (profile.id === "bwrap") {
        if (!hasBinary("bwrap")) {
            return {
                ok: false,
                reason: "Bubblewrap ('bwrap') binary is not installed on this system.",
                help: "Install bubblewrap using your Linux package manager (e.g. sudo apt install bubblewrap)."
            };
        }
        return { ok: true };
    }

    if (profile.id === "docker") {
        const hasDocker = hasBinary("docker") || hasBinary("podman");
        if (!hasDocker) {
            return {
                ok: false,
                reason: "Docker/Podman binary is not installed or available on PATH.",
                help: "Ensure Docker or Podman is installed and running."
            };
        }
        return { ok: true };
    }

    // Generic command fallback
    if (profile.detect_cmd && !isCommandAvailable(profile.detect_cmd)) {
        return {
            ok: false,
            reason: `Prerequisite command check failed for profile '${profile.id}'.`,
            help: `Ensure '${profile.detect_cmd}' succeeds.`
        };
    }

    return { ok: true };
}

function detectPlatformDefault() {
    // Check if running on Android / Termux
    const isAndroid = process.platform === "android" || Boolean(process.env.TERMUX_VERSION) || fs.existsSync("/data/data/com.termux");
    if (isAndroid) {
        if (hasBinary("pd") || hasBinary("proot-distro")) {
            return "proot";
        }
    }

    // Check if Linux Desktop with bwrap
    if (process.platform === "linux") {
        if (hasBinary("bwrap")) {
            return "bwrap";
        }
    }

    // Check if Docker available
    if (hasBinary("docker")) {
        return "docker";
    }

    return isAndroid ? "proot" : "bwrap";
}

function getResolvedProfileId(config) {
    if (!config.enabled) return "direct";
    if (config.active_profile && config.profiles && config.profiles[config.active_profile]) {
        return config.active_profile;
    }
    return detectPlatformDefault();
}

function getProfilesWithStatus() {
    const config = loadSandboxConfig();
    const resolvedId = getResolvedProfileId(config);

    const profilesList = Object.values(config.profiles)
        .filter(p => p.id !== "auto" && p.id !== "direct")
        .map(profile => {
            const check = verifyProfileEnvironment(profile);
            return {
                ...profile,
                isInstalled: check.ok,
                missingReason: check.reason || null,
                missingHelp: check.help || null,
                isActive: profile.id === config.active_profile,
                isResolvedActive: profile.id === resolvedId
            };
        });

    return {
        enabled: Boolean(config.enabled),
        active_profile: config.active_profile,
        resolved_profile: resolvedId,
        ipc_type: config.ipc_type,
        profiles: profilesList
    };
}

function getTaskServerSocketPath() {
    return path.join(getStorageDir(), "task_server.sock");
}

function getTaskServerIpcType(config) {
    // 1. Check CLI flags passed to process (e.g. --ipc socket|tcp, --socket, --tcp)
    const args = process.argv || [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--ipc" && args[i + 1]) {
            const val = args[i + 1].trim().toLowerCase();
            if (val === "socket" || val === "tcp") return val;
        } else if (arg.startsWith("--ipc=")) {
            const val = arg.split("=")[1].trim().toLowerCase();
            if (val === "socket" || val === "tcp") return val;
        } else if (arg === "--socket") {
            return "socket";
        } else if (arg === "--tcp") {
            return "tcp";
        }
    }

    // 2. Check environment variable override
    if (process.env.MULTIAI_IPC) {
        const envVal = process.env.MULTIAI_IPC.trim().toLowerCase();
        if (envVal === "socket" || envVal === "tcp") return envVal;
    }

    // 3. User config in ~/.MultiAI/vm_conf.json
    const cfg = config || loadSandboxConfig();
    if (cfg && (cfg.ipc_type === "socket" || cfg.ipc_type === "tcp")) {
        return cfg.ipc_type;
    }

    // 4. Default: Unix domain socket on POSIX, TCP on Windows
    return process.platform === "win32" ? "tcp" : "socket";
}

function getTaskServerTarget(config) {
    const ipcType = getTaskServerIpcType(config);
    if (ipcType === "socket" && process.platform !== "win32") {
        return { socketPath: getTaskServerSocketPath() };
    }
    const port = parseInt(process.env.TASK_PORT || 5000, 10);
    return { hostname: "127.0.0.1", port };
}

function resolveCommandTemplate(template, vars = {}) {
    let result = template;
    const ipcType = vars.IPC_TYPE || getTaskServerIpcType();
    const taskPort = vars.TASK_PORT || process.env.TASK_PORT || 5000;
    const socketPath = vars.TASK_SOCKET || getTaskServerSocketPath();

    let ipcArgs = `--port ${taskPort}`;
    if (ipcType === "socket" && process.platform !== "win32") {
        // In PRoot container, {DATA_DIR} is mounted to /data
        if (vars.IS_PROOT || template.includes("pd sh")) {
            ipcArgs = `--socket /data/task_server.sock`;
        } else {
            ipcArgs = `--socket ${socketPath}`;
        }
    }

    const allVars = {
        IPC_ARGS: ipcArgs,
        TASK_SOCKET: socketPath,
        TASK_PORT: taskPort,
        ...vars
    };

    for (const [key, val] of Object.entries(allVars)) {
        result = result.split(`{${key}}`).join(String(val || ""));
    }

    return result;
}

/**
 * Discovers existing sensitive host directories (SSH, GPG, AWS/cloud tokens, GitHub CLI auth)
 * and generates --tmpfs mount arguments for Bubblewrap so the sandbox
 * cannot read or exfiltrate private user keys.
 * @returns {string} Space-separated --tmpfs mount arguments
 */
function getSandboxShieldArgs() {
    const home = os.homedir();
    const sensitiveDirs = [
        ".ssh",
        ".gnupg",
        ".aws",
        ".config/gh",
        ".config/gcloud",
        ".azure",
        ".kube",
        ".docker"
    ];

    const mounts = [];
    for (const rel of sensitiveDirs) {
        const full = path.join(home, rel);
        try {
            if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
                mounts.push(`--tmpfs ${full}`);
            }
        } catch (_) {}
    }

    return mounts.join(" ");
}

module.exports = {
    loadSandboxConfig,
    saveSandboxConfig,
    getProfilesWithStatus,
    getResolvedProfileId,
    verifyProfileEnvironment,
    resolveCommandTemplate,
    getSandboxShieldArgs,
    getTaskServerSocketPath,
    getTaskServerIpcType,
    getTaskServerTarget,
    getStorageDir,
    DIRECT_PROFILE
};
