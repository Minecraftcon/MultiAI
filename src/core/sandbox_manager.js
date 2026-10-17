// Sandbox / VM Configuration Manager for MultiAI
// Supports PRoot, Bubblewrap (bwrap), Docker, and Direct Host execution
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const DEFAULT_SANDBOX_CONFIG = {
    enabled: false,
    active_profile: "bwrap", // "bwrap" | "proot" | "docker"
    profiles: {
        bwrap: {
            id: "bwrap",
            name: "Bubblewrap",
            badge: "Linux",
            description: "Unprivileged user namespaces with read-only root and workspace binding.",
            icon: "shield",
            mode: "daemon",
            startup: 'bwrap --ro-bind / / --bind {PROJECT_PATH} {PROJECT_PATH} --bind {DATA_DIR} {DATA_DIR} --tmpfs /tmp --proc /proc --dev /dev -- python3 {TASK_SERVER_SCRIPT} --port {TASK_PORT}',
            detect_cmd: "command -v bwrap"
        },
        proot: {
            id: "proot",
            name: "PRoot Distro",
            badge: "Android / Termux",
            description: "Syscall emulation sandbox for non-root containers and Termux environments.",
            icon: "smartphone",
            mode: "daemon",
            startup: 'pd sh debian --bind {PROJECT_PATH}:/workspace --bind {DATA_DIR}:/data -- python3 /workspace/task_server.py --port {TASK_PORT}',
            detect_cmd: "command -v pd || command -v proot-distro"
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
    startup: 'python3 {TASK_SERVER_SCRIPT} --port {TASK_PORT}',
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

            if (profiles.proot && profiles.proot.startup && profiles.proot.startup.includes("/workspace/task_server/server.py")) {
                profiles.proot.startup = profiles.proot.startup.replace("/workspace/task_server/server.py", "/workspace/task_server.py");
            }

            let active = parsed.active_profile;
            if (!active || active === "auto" || !profiles[active]) {
                active = detectPlatformDefault();
            }

            const cfg = {
                enabled: parsed.enabled !== undefined ? parsed.enabled : DEFAULT_SANDBOX_CONFIG.enabled,
                active_profile: active,
                profiles
            };
            return cfg;
        }
    } catch (e) {
        console.warn(`[SANDBOX] Failed to load ${configPath}, using defaults:`, e.message);
    }
    const defaultCfg = {
        enabled: DEFAULT_SANDBOX_CONFIG.enabled,
        active_profile: detectPlatformDefault(),
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
            const isInstalled = isCommandAvailable(profile.detect_cmd);
            return {
                ...profile,
                isInstalled,
                isActive: profile.id === config.active_profile,
                isResolvedActive: profile.id === resolvedId
            };
        });

    return {
        enabled: Boolean(config.enabled),
        active_profile: config.active_profile,
        resolved_profile: resolvedId,
        profiles: profilesList
    };
}

function resolveCommandTemplate(template, vars) {
    let result = template;
    for (const [key, val] of Object.entries(vars)) {
        result = result.split(`{${key}}`).join(String(val || ""));
    }
    return result;
}

module.exports = {
    loadSandboxConfig,
    saveSandboxConfig,
    getProfilesWithStatus,
    getResolvedProfileId,
    resolveCommandTemplate,
    getStorageDir,
    DIRECT_PROFILE
};
