/**
 * MultiAI Rootless Tools Provisioner
 * ==================================
 * Automatically provisions micromamba (75,000+ Conda-Forge packages)
 * and pkgx (2,500+ on-demand CLI binaries) into user space (~/.local/bin)
 * without requiring sudo or root access.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

function getUserHome() {
    return os.homedir() || process.env.HOME || "/tmp";
}

function getBinDir() {
    const homeBin = path.join(getUserHome(), ".local", "bin");
    try {
        if (!fs.existsSync(homeBin)) {
            fs.mkdirSync(homeBin, { recursive: true });
        }
        return homeBin;
    } catch (_) {
        const tmpBin = "/tmp/bin";
        if (!fs.existsSync(tmpBin)) {
            fs.mkdirSync(tmpBin, { recursive: true });
        }
        return tmpBin;
    }
}

function isExecutable(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch (_) {
        return false;
    }
}

function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || error.message}`));
            }
            resolve(stdout);
        });
    });
}

function getEnhancedEnv(baseEnv = process.env) {
    const binDir = getBinDir();
    const home = getUserHome();
    const pkgxBin = path.join(home, ".pkgx", "bin");
    const existingPath = baseEnv.PATH || process.env.PATH || "";

    const pathParts = [binDir, pkgxBin, "/tmp/bin"];
    const filteredParts = pathParts.filter(p => !existingPath.split(":").includes(p));
    const newPath = [...filteredParts, existingPath].filter(Boolean).join(":");

    return {
        ...baseEnv,
        PATH: newPath,
        MAMBA_ROOT_PREFIX: path.join(home, ".micromamba"),
        PKGX_DIR: path.join(home, ".pkgx")
    };
}

async function ensureMicromamba(binDir) {
    const mambaPath = path.join(binDir, "micromamba");
    if (isExecutable(mambaPath)) {
        return mambaPath;
    }

    console.log("[TOOLS] Provisioning micromamba (Conda-Forge rootless package manager)...");
    const arch = os.arch() === "arm64" ? "aarch64" : "64";
    const downloadUrl = `https://micro.mamba.pm/api/micromamba/linux-${arch}/latest`;

    try {
        // Fetch and extract bin/micromamba
        await runCommand("sh", [
            "-c",
            `curl -fsSL "${downloadUrl}" | tar -xj -C "${binDir}" --strip-components=1 bin/micromamba`
        ]);
        if (fs.existsSync(mambaPath)) {
            fs.chmodSync(mambaPath, 0o755);
            console.log(`[TOOLS] micromamba ready at ${mambaPath}`);
            return mambaPath;
        }
    } catch (err) {
        console.warn("[TOOLS] Failed to provision micromamba via micro.mamba.pm:", err.message);
    }
    return null;
}

async function ensurePkgx(binDir) {
    const pkgxPath = path.join(binDir, "pkgx");
    if (isExecutable(pkgxPath)) {
        return pkgxPath;
    }

    console.log("[TOOLS] Provisioning pkgx (on-demand developer CLI binary runner)...");
    const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
    const downloadUrl = `https://pkgx.sh/Linux/${arch}.tgz`;

    try {
        // Fetch and extract pkgx binary
        await runCommand("sh", [
            "-c",
            `curl -fsSL "${downloadUrl}" | tar -xz -C "${binDir}"`
        ]);
        if (fs.existsSync(pkgxPath)) {
            fs.chmodSync(pkgxPath, 0o755);
            console.log(`[TOOLS] pkgx ready at ${pkgxPath}`);
            return pkgxPath;
        }
    } catch (err) {
        console.warn("[TOOLS] Failed to provision pkgx via pkgx.sh:", err.message);
    }
    return null;
}

async function ensureRootlessTools() {
    if (process.platform !== "linux") {
        return { supported: false, reason: "Non-Linux platform" };
    }

    const binDir = getBinDir();
    const home = getUserHome();

    // Ensure state directories exist
    const mambaRoot = path.join(home, ".micromamba");
    if (!fs.existsSync(mambaRoot)) {
        try { fs.mkdirSync(mambaRoot, { recursive: true }); } catch (_) {}
    }
    const pkgxRoot = path.join(home, ".pkgx");
    if (!fs.existsSync(pkgxRoot)) {
        try { fs.mkdirSync(pkgxRoot, { recursive: true }); } catch (_) {}
    }

    const [mamba, pkgx] = await Promise.allSettled([
        ensureMicromamba(binDir),
        ensurePkgx(binDir)
    ]);

    const enhanced = getEnhancedEnv();
    process.env.PATH = enhanced.PATH;
    process.env.MAMBA_ROOT_PREFIX = enhanced.MAMBA_ROOT_PREFIX;
    process.env.PKGX_DIR = enhanced.PKGX_DIR;

    return {
        binDir,
        micromamba: mamba.status === "fulfilled" ? mamba.value : null,
        pkgx: pkgx.status === "fulfilled" ? pkgx.value : null
    };
}

if (require.main === module) {
    ensureRootlessTools().then((res) => {
        console.log("[TOOLS] Rootless tools provisioning complete:", res);
        process.exit(0);
    }).catch((err) => {
        console.error("[TOOLS] Rootless tools provisioning failed:", err);
        process.exit(1);
    });
}

module.exports = {
    ensureRootlessTools,
    getEnhancedEnv,
    getBinDir
};
