const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const YAML = require("yaml");
const { getConfig, saveConfig } = require("../core/config_manager");
const conversationsManager = require("../core/conversations_manager");

function getEnvKey(keyName) {
    if (!keyName) return null;
    const aliases = [keyName];
    if (keyName === "TOKENHARBOR_API_KEY") aliases.push("TOKENHARBOUR_API_KEY");
    if (keyName === "TOKENHARBOUR_API_KEY") aliases.push("TOKENHARBOR_API_KEY");
    if (keyName === "LOGFLARE_API_KEY") aliases.push("LOGFARE_API_KEY");
    if (keyName === "LOGFARE_API_KEY") aliases.push("LOGFLARE_API_KEY");

    for (const k of aliases) {
        if (process.env[k]) return process.env[k];
    }
    try {
        const bashrcPath = path.join(os.homedir(), ".bashrc");
        if (fs.existsSync(bashrcPath)) {
            const content = fs.readFileSync(bashrcPath, "utf8");
            for (const k of aliases) {
                const match = content.match(new RegExp(`export\\s+${k}=["']?([^"'\\r\\n]+)["']?`));
                if (match && match[1]) {
                    process.env[k] = match[1].trim();
                    return process.env[k];
                }
            }
        }
    } catch (_) {}
    return null;
}

function loadModelsConfig() {
    try {
        const yamlPath = path.join(__dirname, "../..", "models.yaml");
        if (fs.existsSync(yamlPath)) {
            const fileContent = fs.readFileSync(yamlPath, "utf8");
            return YAML.parse(fileContent) || { providers: {} };
        }
    } catch (e) {
        console.error("[MODELS] Error loading models.yaml:", e.message);
    }
    return { providers: {} };
}

function getModelDefaultContext(modelId, providerType) {
    const m = String(modelId || "").toLowerCase();
    const p = String(providerType || "").toLowerCase();
    if (p.includes("gemini") || m.includes("gemini")) return 1000000;
    if (m.includes("claude")) return 200000;
    if (m.includes("1m") || m.includes("1000k") || m.includes("v4.1")) return 1000000;
    if (m.includes("codestral")) return 32000;
    if (m.includes("glm-4.5")) return 55000;
    if (m.includes("glm-4") || m.includes("glm-5")) return 110000;
    if (m.includes("o1") || m.includes("o3")) return 200000;
    if (m.includes("gpt-4o") || m.includes("gpt-4") || m.includes("deepseek") || m.includes("qwen") || m.includes("llama") || m.includes("gemma") || m.includes("command-r")) return 128000;
    return 128000;
}

function getSystemInfo() {
    const platform = os.platform();
    const isTermux = Boolean(
        process.env.TERMUX_VERSION ||
        process.env.PREFIX?.includes("com.termux") ||
        (platform === "linux" && fs.existsSync("/data/data/com.termux"))
    );
    const isWindows = platform === "win32";
    const isMac = platform === "darwin";
    const isLinux = platform === "linux" && !isTermux;

    let osName = "Unknown";
    let shellName = "sh";
    let instructions = [];

    if (isWindows) {
        osName = `Windows (${os.type()} ${os.release()})`;
        shellName = "cmd.exe (Command Prompt) / PowerShell";
        instructions = [
            "Operating system is WINDOWS. Terminal executes via cmd.exe by default.",
            "Use native Windows commands instead of Unix commands:",
            "  - Directory listing: 'dir' or 'dir /b' (not 'ls')",
            "  - File viewing: 'type <filename>' (not 'cat')",
            "  - Find executable / command path: 'where <name>' (not 'which')",
            "  - Search in file text: 'findstr /s /i \"pattern\" *' (not 'grep')",
            "  - Print current directory: 'cd' with no arguments (not 'pwd')",
            "  - Copy / Move: 'copy' and 'move' (not 'cp' / 'mv')",
            "  - Delete: 'del /f /q <file>' and 'rmdir /s /q <dir>' (not 'rm -rf')",
            "  - Environment variables: '%VAR%' (e.g. %USERPROFILE%, %TEMP%, %PATH%)",
            "Command chaining with '&&' and '||' works in cmd.exe.",
            "To execute PowerShell commands, use: powershell -NoProfile -Command \"<cmd>\"",
            "File paths use backslashes '\\' or forward slashes '/'. Avoid Unix-only binaries unless installed.",
            "NOTE: Any 'com.termux' directory name in the file path is solely a folder on the Windows filesystem (an export); you are running directly on native Windows."
        ];
    } else if (isTermux) {
        osName = `Android Termux (${os.arch()})`;
        shellName = "bash / sh (Termux)";
        instructions = [
            "Operating system is ANDROID running inside a TERMUX environment.",
            "Shell is standard Bash/sh.",
            "Package management: use 'pkg install <pkg>' or 'apt install <pkg>'.",
            "Termux home is /data/data/com.termux/files/home.",
            "Storage access: /sdcard or ~/storage (if permissions granted).",
            "Use standard Unix commands: ls, cat, grep, pwd, curl, find, etc.",
            "Hardware is mobile ARM; conserve memory and avoid heavy build loops."
        ];
    } else if (isMac) {
        osName = `macOS (${os.release()}, ${os.arch()})`;
        shellName = "zsh / bash";
        instructions = [
            "Operating system is macOS (Darwin).",
            "Shell is zsh/bash. Standard BSD Unix tools available: ls, cat, grep, curl, open, etc.",
            "Package manager is typically Homebrew ('brew')."
        ];
    } else if (isLinux) {
        osName = `Linux (${os.release()}, ${os.arch()})`;
        shellName = "bash / sh";
        instructions = [
            "Operating system is Linux.",
            "Shell is Bash/sh. Use standard GNU/Linux commands: ls, cat, grep, pwd, which, curl, etc.",
            "Package manager: apt, dnf, pacman, etc. depending on distro."
        ];
    }

    return {
        platform,
        osName,
        arch: os.arch(),
        shellName,
        hostname: os.hostname(),
        username: os.userInfo ? os.userInfo().username : "user",
        homedir: os.homedir(),
        cwd: process.cwd(),
        workspaceDir: process.cwd(),
        storageRoot: conversationsManager.getStorageRoot(),
        conversationsRoot: conversationsManager.getConversationsRoot(),
        isTermux,
        isWindows,
        isMac,
        isLinux,
        instructions
    };
}

const appConfig = getConfig();
const LOG_FILE = appConfig.General?.LogFile 
    ? (path.isAbsolute(appConfig.General.LogFile) ? appConfig.General.LogFile : path.join(__dirname, "../..", appConfig.General.LogFile))
    : path.join(__dirname, "../..", "logs.txt");

try {
    fs.writeFileSync(LOG_FILE, `--- log started ${new Date().toISOString()} ---\n`);
} catch (_) {}

function logToFile(tag, data) {
    const cfg = getConfig();
    const entry = {
        ...(cfg.General?.RecordDate !== false ? { timestamp: new Date().toISOString() } : {}),
        tag,
        ...data
    };
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", (err) => {
        if (err) console.error("[LOG WRITE ERROR]", err);
    });
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getMimeType(ext) {
    const map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".avif": "image/avif",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".pdf": "application/pdf",
        ".json": "application/json",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".cjs": "text/javascript",
        ".ts": "text/typescript",
        ".tsx": "text/typescript",
        ".html": "text/html",
        ".htm": "text/html",
        ".css": "text/css",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".ogv": "video/ogg",
        ".ogg": "video/ogg",
        ".mov": "video/quicktime",
        ".m4v": "video/x-m4v",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mpg": "video/mpeg",
        ".mpeg": "video/mpeg",
        ".wmv": "video/x-ms-wmv",
        ".flv": "video/x-flv",
        ".3gp": "video/3gpp",
        ".3gpp": "video/3gpp",
        ".m2ts": "video/mp2t",
        ".mts": "video/mp2t",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".oga": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".wma": "audio/x-ms-wma",
        ".opus": "audio/opus",
        ".weba": "audio/webm"
    };
    return map[(ext || "").toLowerCase()] || "application/octet-stream";
}

function getChatScratchDir(chatId) {
    if (chatId) {
        try {
            return conversationsManager.ensureChatWorkspace(chatId).scratchDir;
        } catch (_) {}
    }
    return path.join(conversationsManager.getStorageRoot(), "scratch");
}

function getChatArtifactsDir(chatId) {
    if (chatId) {
        try {
            return conversationsManager.ensureChatWorkspace(chatId).artifactsDir;
        } catch (_) {}
    }
    return path.join(conversationsManager.getStorageRoot(), "artifacts");
}

function resolveSafePath(inputPath, chatId) {
    const raw = String(inputPath || "").trim();
    if (!raw) throw new Error("Path parameter is empty or missing");

    const isScratch = raw === "$SCRATCH" || 
                      raw === "${SCRATCH}" || 
                      raw.startsWith("$SCRATCH/") || 
                      raw.startsWith("${SCRATCH}/") ||
                      raw.startsWith("$SCRATCH\\") || 
                      raw.startsWith("${SCRATCH}\\");

    if (isScratch) {
        let rel = raw;
        if (rel.startsWith("$SCRATCH/")) rel = rel.slice(9);
        else if (rel.startsWith("${SCRATCH}/")) rel = rel.slice(10);
        else if (rel.startsWith("$SCRATCH\\")) rel = rel.slice(9);
        else if (rel.startsWith("${SCRATCH}\\")) rel = rel.slice(10);
        else if (rel === "$SCRATCH" || rel === "${SCRATCH}") rel = "";

        const scratchDir = getChatScratchDir(chatId);
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        return rel ? path.resolve(scratchDir, rel) : scratchDir;
    }

    const isArtifacts = raw === "$ARTIFACTS" || 
                        raw === "${ARTIFACTS}" || 
                        raw.startsWith("$ARTIFACTS/") || 
                        raw.startsWith("${ARTIFACTS}/") ||
                        raw.startsWith("$ARTIFACTS\\") || 
                        raw.startsWith("${ARTIFACTS}\\");

    if (isArtifacts) {
        let rel = raw;
        if (rel.startsWith("$ARTIFACTS/")) rel = rel.slice(11);
        else if (rel.startsWith("${ARTIFACTS}/")) rel = rel.slice(12);
        else if (rel.startsWith("$ARTIFACTS\\")) rel = rel.slice(11);
        else if (rel.startsWith("${ARTIFACTS}\\")) rel = rel.slice(12);
        else if (rel === "$ARTIFACTS" || rel === "${ARTIFACTS}") rel = "";

        const artifactsDir = getChatArtifactsDir(chatId);
        if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
        }
        return rel ? path.resolve(artifactsDir, rel) : artifactsDir;
    }

    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw);
}

function postJSON(port, reqPath, data, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: reqPath,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            },
            timeout: timeoutMs
        }, (res) => {
            let respBody = "";
            res.on("data", chunk => { respBody += chunk; });
            res.on("end", () => {
                try {
                    const json = JSON.parse(respBody || "{}");
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.error || `HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy(new Error("Request timed out"));
        });
        req.write(body);
        req.end();
    });
}

function sendJSON(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
}

module.exports = {
    getEnvKey,
    loadModelsConfig,
    getModelDefaultContext,
    getSystemInfo,
    logToFile,
    formatBytes,
    getMimeType,
    getChatScratchDir,
    getChatArtifactsDir,
    resolveSafePath,
    postJSON,
    sendJSON
};
