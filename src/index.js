const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");
const { spawn, exec, execFile } = require("child_process");
const YAML = require("yaml");
const { resolveProvider, resolveImageProvider } = require("./providers");
const { getConfig, saveConfig } = require("./core/config_manager");
const conversationsManager = require("./core/conversations_manager");
const { createAgentGraph } = require("./core/agent_graph");
const { handleCodeGrep, handleSearchAndReplace, handleWriteFile } = require("./tools/filesystem/code_tools");
const deepSearchManager = require("./services/deepsearch/manager");
const { runDeepSearchWorkflow } = require("./services/deepsearch/graph");

// If MULTIAI_WORKSPACE_DIR is set, anchor runtime process.cwd() to it
if (process.env.MULTIAI_WORKSPACE_DIR && fs.existsSync(process.env.MULTIAI_WORKSPACE_DIR)) {
    try {
        process.chdir(process.env.MULTIAI_WORKSPACE_DIR);
    } catch (e) {
        console.warn("[WORKSPACE] Could not chdir to workspace directory:", e.message);
    }
}

// In-memory registry for background image generation tasks
const imageGenTasks = new Map();

// Periodically evict completed/failed tasks older than 30min, running tasks older than 2h
setInterval(() => {
    const now = Date.now();
    for (const [id, task] of imageGenTasks.entries()) {
        const age = now - (task.created_at || 0);
        if ((task.status === "completed" || task.status === "failed") && age > 30 * 60 * 1000) {
            imageGenTasks.delete(id);
        } else if (task.status === "running" && age > 2 * 60 * 60 * 1000) {
            // Stale zombie task — server restart or crash mid-generation
            imageGenTasks.delete(id);
        }
    }
}, 60 * 60 * 1000); // Run hourly

// In-memory KoboldCPP session cache — cleared on server restart (by design)
let koboldBaseUrl = null;

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
    } catch (e) {
        // ignore
    }
    return null;
}

function loadModelsConfig() {
    try {
        const yamlPath = path.join(__dirname, "..", "models.yaml");
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

// ---------------------------------------------------------
// Universal Chat Message Normalization Layer
// ---------------------------------------------------------
const { normalizeMessage, normalizeMessages, formatAssistantResponse } = require("./core/messages");



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
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (appConfig.General?.Port || 8080);
const HOST = process.env.HOST || appConfig.General?.Host || "0.0.0.0";
const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY;
const LOG_FILE = appConfig.General?.LogFile 
    ? (path.isAbsolute(appConfig.General.LogFile) ? appConfig.General.LogFile : path.join(__dirname, "..", appConfig.General.LogFile))
    : path.join(__dirname, "..", "logs.txt");

if (!TINYFISH_API_KEY) {
    console.warn("[WARNING] TINYFISH_API_KEY is not set. Web search (/api/search) will be unavailable until configured.");
}

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

// ---------------------------------------------------------
// Python Task Server Process Supervisor
// ---------------------------------------------------------
let pythonProcess = null;
let isShuttingDown = false;

function startPythonTaskServer() {
    if (isShuttingDown) return;
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const taskScript = (process.platform === "win32" && fs.existsSync(path.join(__dirname, "..", "task_server_windows.py")))
        ? path.join(__dirname, "..", "task_server_windows.py")
        : path.join(__dirname, "..", "task_server.py");

    const pyEnv = {
        ...process.env,
        MULTIAI_REPO_DIR: path.join(__dirname, ".."),
        MULTIAI_WORKSPACE_DIR: process.cwd(),
        PYTHONPATH: path.join(__dirname, "..") + (process.env.PYTHONPATH ? (path.delimiter + process.env.PYTHONPATH) : "")
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

startPythonTaskServer();

// Clean termination helper
function cleanupAndExit(exitCode = 0) {
    isShuttingDown = true;
    if (pythonProcess && !pythonProcess.killed) {
        console.log(`[PROCESS] Terminating task_server.py (PID: ${pythonProcess.pid})...`);
        try {
            pythonProcess.kill("SIGTERM");
        } catch (e) {
            pythonProcess.kill("SIGKILL");
        }
    }
    process.exit(exitCode);
}

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

// ---------------------------------------------------------
// HTTP API & Routing
// ---------------------------------------------------------
async function tinyfishSearch(args) {
    if (!TINYFISH_API_KEY) {
        throw new Error("TINYFISH_API_KEY is not set in the server environment. Web search is unavailable.");
    }
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Search query is empty");
    const url = new URL("https://api.search.tinyfish.ai");
    url.searchParams.set("query", query);
    if (args.location) url.searchParams.set("location", args.location);
    if (args.language) url.searchParams.set("language", args.language);
    if (args.page !== undefined) url.searchParams.set("page", String(args.page));

    const response = await fetch(url, { headers: { "X-API-Key": TINYFISH_API_KEY } });
    const text = await response.text();
    if (!response.ok) throw new Error(`TinyFish HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
}

async function tinyfishFetch(args) {
    if (!TINYFISH_API_KEY) {
        throw new Error("TINYFISH_API_KEY is not set in the server environment. Web fetch is unavailable.");
    }
    let urls = [];
    if (Array.isArray(args.urls)) {
        urls = args.urls.map(u => String(u || "").trim()).filter(Boolean);
    } else if (typeof args.url === "string" && args.url.trim()) {
        urls = [args.url.trim()];
    }
    if (urls.length === 0) throw new Error("No URL(s) provided to fetch");
    if (urls.length > 10) urls = urls.slice(0, 10);

    const format = (args.format === "html" || args.format === "json") ? args.format : "markdown";
    const response = await fetch("https://api.fetch.tinyfish.ai", {
        method: "POST",
        headers: {
            "X-API-Key": TINYFISH_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ urls, format })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TinyFish Fetch HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
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
        ".ts": "text/typescript",   // TypeScript source (NOT video transport stream)
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
        ".m2ts": "video/mp2t",      // MPEG-2 transport stream (explicit)
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

    // Check if path is targeted at scratch directory via $SCRATCH
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

    // Check if path is targeted at artifacts directory via $ARTIFACTS
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

async function handleFileRead(args, chatId) {
    const targetPath = resolveSafePath(args.path, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File or directory not found: ${args.path}`);
    }

    const stat = await fs.promises.stat(targetPath);
    const action = args.action || "read";

    if (action === "info") {
        if (stat.isDirectory()) {
            const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
            return {
                path: args.path,
                resolved_path: targetPath,
                exists: true,
                is_dir: true,
                is_file: false,
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                entry_count: entries.length,
                entries: entries.slice(0, 100).map(e => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" })),
                modified_time: stat.mtime
            };
        }
        let lineCount = 0;
        try {
            const raw = await fs.promises.readFile(targetPath, "utf-8");
            lineCount = raw.split("\n").length;
        } catch {
            lineCount = null;
        }
        return {
            path: args.path,
            resolved_path: targetPath,
            exists: true,
            is_dir: false,
            is_file: true,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            line_count: lineCount,
            mime_type: getMimeType(path.extname(targetPath)),
            modified_time: stat.mtime
        };
    }

    if (action === "view") {
        const ext = path.extname(targetPath).toLowerCase();
        const isImg = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".ico", ".avif"].includes(ext);
        if (isImg) {
            const buf = await fs.promises.readFile(targetPath);
            const mime = getMimeType(ext);
            if (stat.size <= 4 * 1024 * 1024) {
                const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
                return {
                    path: args.path,
                    resolved_path: targetPath,
                    action: "view",
                    type: "image",
                    mime,
                    size_bytes: stat.size,
                    human_size: formatBytes(stat.size),
                    data_url: dataUrl,
                    markdown: `![${path.basename(targetPath)}](${dataUrl})`
                };
            } else {
                return {
                    path: args.path,
                    resolved_path: targetPath,
                    action: "view",
                    type: "image",
                    mime,
                    size_bytes: stat.size,
                    human_size: formatBytes(stat.size),
                    message: "Image exceeds 4MB inline viewing limit"
                };
            }
        }
        if (ext === ".pdf") {
            return {
                path: args.path,
                resolved_path: targetPath,
                action: "view",
                type: "pdf",
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                message: `PDF Document (${formatBytes(stat.size)})`
            };
        }
    }

    // Default: action === "read"
    if (stat.isDirectory()) {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        return {
            path: args.path,
            resolved_path: targetPath,
            is_dir: true,
            entry_count: entries.length,
            content: entries.map(e => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`).join("\n")
        };
    }

    // Guard: detect binary files before reading as UTF-8 to prevent context corruption
    const BINARY_EXTS = new Set([
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".tiff", ".tif",
        ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".mpg", ".mpeg", ".flv", ".3gp",
        ".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wma",
        ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
        ".wasm", ".pyc", ".class", ".o", ".obj", ".pdb",
        ".ttf", ".otf", ".woff", ".woff2", ".eot",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".sqlite", ".db"
    ]);
    const fileExt = path.extname(targetPath).toLowerCase();
    if (BINARY_EXTS.has(fileExt)) {
        const mime = getMimeType(fileExt);
        const viewable = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".pdf"].includes(fileExt);
        return {
            path: args.path,
            resolved_path: targetPath,
            is_binary: true,
            mime_type: mime,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            message: `Binary file (${mime}, ${formatBytes(stat.size)}). Cannot read as text.${viewable ? ' Use action: "view" to render as embedded preview.' : ' Use action: "info" for metadata only.'}`
        };
    }

    const raw = await fs.promises.readFile(targetPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const startLine = Math.max(1, parseInt(args.start_line, 10) || 1);
    const endLine = args.end_line ? Math.min(totalLines, Math.max(startLine, parseInt(args.end_line, 10))) : Math.min(totalLines, startLine + 400 - 1);
    const isNumbered = args.numbered !== false;

    const sliced = lines.slice(startLine - 1, endLine);
    const content = sliced.map((line, idx) => isNumbered ? `${String(startLine + idx).padStart(5, " ")} | ${line}` : line).join("\n");

    return {
        path: args.path,
        resolved_path: targetPath,
        content,
        start_line: startLine,
        end_line: endLine,
        total_lines: totalLines,
        is_truncated: (startLine > 1 || endLine < totalLines)
    };
}

async function handleFileWrite(args, chatId) {
    return await handleWriteFile(args, chatId, { resolveSafePath });
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

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        return res.end();
    }

    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/system-info") {
        if (req.method === "HEAD") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end();
        }
        return sendJSON(res, 200, getSystemInfo());
    }

    // -------------------------------------------------------------
    // Local Media Bridge (/api/media?path=...)
    // Safely stream local Linux images/files to the browser
    // -------------------------------------------------------------
    if ((req.method === "GET" || req.method === "HEAD") && req.url.startsWith("/api/media")) {
        try {
            const parsedUrl = new URL(req.url, "http://localhost");
            let rawPath = parsedUrl.searchParams.get("path") || "";
            if (!rawPath) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                return res.end("Path parameter is required");
            }

            if (rawPath.includes("%")) {
                try {
                    rawPath = decodeURIComponent(rawPath);
                } catch (e) {}
            }

            // Clean leading/trailing quotes, backticks, angle brackets, and whitespace
            rawPath = rawPath.trim().replace(/^["'`<]+|["'`>]+$/g, "").trim();

            // Handle file:// URI scheme
            if (rawPath.startsWith("file://")) {
                try {
                    rawPath = url.fileURLToPath(rawPath);
                } catch {
                    rawPath = rawPath.replace(/^file:\/\//, "");
                }
            }

            // Handle home directory ~
            if (rawPath.startsWith("~/") || rawPath === "~") {
                rawPath = path.join(os.homedir(), rawPath.slice(1));
            }

            // Candidate search paths:
            const candidates = [];
            if (path.isAbsolute(rawPath)) {
                candidates.push(path.normalize(rawPath));
                candidates.push(path.join(process.cwd(), rawPath.replace(/^\/+/, "")));
                candidates.push(path.join(__dirname, "../client", rawPath.replace(/^\/+/, "")));
                candidates.push(path.join(process.cwd(), "../client", rawPath.replace(/^\/+/, "")));
            } else {
                candidates.push(path.resolve(process.cwd(), rawPath));
                candidates.push(path.resolve(__dirname, "../client", rawPath));
                candidates.push(path.resolve(process.cwd(), "../client", rawPath));
                candidates.push(path.resolve(process.cwd(), "generated_images", rawPath));
                candidates.push(path.resolve(os.homedir(), rawPath));
                candidates.push(path.resolve(os.homedir(), "Videos", rawPath));
                candidates.push(path.resolve(os.homedir(), "Pictures", rawPath));
                candidates.push(path.resolve(os.homedir(), "Downloads", rawPath));
                candidates.push(path.resolve(os.homedir(), "Documents", rawPath));
            }

            let targetPath = null;
            for (const cand of candidates) {
                try {
                    if (fs.existsSync(cand) && !fs.statSync(cand).isDirectory()) {
                        targetPath = cand;
                        break;
                    }
                    // Case-insensitive fallback in same directory
                    const dir = path.dirname(cand);
                    const base = path.basename(cand).toLowerCase();
                    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                        const files = fs.readdirSync(dir);
                        const match = files.find(f => f.toLowerCase() === base);
                        if (match) {
                            const found = path.join(dir, match);
                            if (fs.existsSync(found) && !fs.statSync(found).isDirectory()) {
                                targetPath = found;
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }

            if (!targetPath) {
                console.warn(`[MEDIA 404] File not found: ${rawPath}`);
                res.writeHead(404, { 
                    "Content-Type": "text/plain",
                    "Access-Control-Allow-Origin": "*"
                });
                return res.end(`Media not found: ${path.basename(rawPath)}`);
            }

            const stat = fs.statSync(targetPath);
            const ext = path.extname(targetPath).toLowerCase();
            let mimeType = getMimeType(ext);

            // Support HTTP Range requests (crucial for video/audio seeking and buffering)
            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

                if (start >= stat.size || end >= stat.size || start > end) {
                    res.writeHead(416, {
                        "Content-Range": `bytes */${stat.size}`,
                        "Access-Control-Allow-Origin": "*"
                    });
                    return res.end();
                }

                const chunksize = (end - start) + 1;
                res.writeHead(206, {
                    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": chunksize,
                    "Content-Type": mimeType,
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Range, Content-Type",
                    "Cache-Control": "public, max-age=3600"
                });

                if (req.method === "HEAD") {
                    return res.end();
                }

                const stream = fs.createReadStream(targetPath, { start, end });
                stream.on("error", (err) => {
                    if (!res.headersSent) {
                        res.writeHead(500, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
                    }
                    res.end("Error streaming media: " + err.message);
                });
                stream.pipe(res);
                return;
            }

            res.writeHead(200, {
                "Content-Type": mimeType,
                "Content-Length": stat.size,
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Range, Content-Type",
                "Cache-Control": "public, max-age=3600"
            });

            if (req.method === "HEAD") {
                return res.end();
            }

            const stream = fs.createReadStream(targetPath);
            stream.on("error", (err) => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "text/plain" });
                }
                res.end("Error streaming file: " + err.message);
            });
            stream.pipe(res);
            return;
        } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            return res.end("Server error: " + err.message);
        }
    }

    // -------------------------------------------------------------
    // Persistent Chat & Workspace Endpoints ($HOME/.MuktiAI)
    // -------------------------------------------------------------
    if (req.method === "GET" && req.url === "/api/chats") {
        try {
            const chats = conversationsManager.listChats();
            return sendJSON(res, 200, { success: true, chats });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "GET" && req.url.startsWith("/api/chats/")) {
        const chatId = req.url.slice("/api/chats/".length).split("?")[0];
        if (!chatId) {
            return sendJSON(res, 400, { error: "Chat ID is required." });
        }
        try {
            const data = conversationsManager.getChat(chatId);
            if (!data) {
                return sendJSON(res, 404, { error: `Chat '${chatId}' not found.` });
            }
            return sendJSON(res, 200, { success: true, ...data });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/chats/session") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, date } = data;
            if (!chatId) {
                return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
            }
            const workspace = conversationsManager.ensureChatWorkspace(chatId, date);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/chats/save") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const chatSession = JSON.parse(body || "{}");
            if (!chatSession || !chatSession.id) {
                return sendJSON(res, 400, { error: "Valid chat session with 'id' is required." });
            }
            const workspace = conversationsManager.saveChat(chatSession);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/chats/append") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, message } = data;
            if (!chatId || !message) {
                return sendJSON(res, 400, { error: "Parameters 'chatId' and 'message' are required." });
            }
            const workspace = conversationsManager.appendChatMessage(chatId, message);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && req.url === "/api/chats") {
        try {
            const deleted = conversationsManager.deleteAllChats();
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/chats/")) {
        const chatId = req.url.slice("/api/chats/".length).split("?")[0];
        if (!chatId) {
            return sendJSON(res, 400, { error: "Chat ID is required." });
        }
        try {
            const deleted = conversationsManager.deleteChat(chatId);
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    // -------------------------------------------------------------
    // Build Mode: Projects & Nested Chats Endpoints ($HOME/.MultiAI/build/)
    // -------------------------------------------------------------
    if (req.method === "GET" && req.url === "/api/build/projects") {
        try {
            // Auto-register current workspace if valid directory and not home root
            if (process.cwd() && fs.existsSync(process.cwd()) && process.cwd() !== os.homedir()) {
                try {
                    conversationsManager.addProject(process.cwd());
                } catch (_) {}
            }
            const projects = conversationsManager.listProjects();
            return sendJSON(res, 200, { success: true, projects });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/build/projects") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            if (!data.path) {
                return sendJSON(res, 400, { error: "Directory path is required." });
            }
            const project = conversationsManager.addProject(data.path, data.name);
            return sendJSON(res, 200, { success: true, project });
        } catch (err) {
            return sendJSON(res, 400, { error: err.message });
        }
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/build/projects/") && !req.url.includes("/chats/")) {
        const projectId = req.url.slice("/api/build/projects/".length).split("?")[0];
        try {
            const deleted = conversationsManager.removeProject(projectId);
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "GET" && req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats$/)) {
        const match = req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats$/);
        const projectId = match[1];
        try {
            const chats = conversationsManager.listProjectChats(projectId);
            return sendJSON(res, 200, { success: true, chats });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "GET" && req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/([^/?]+)/)) {
        const match = req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/([^/?]+)/);
        const projectId = match[1];
        const chatId = match[2];
        try {
            const data = conversationsManager.getProjectChat(projectId, chatId);
            if (!data) {
                return sendJSON(res, 404, { error: `Chat '${chatId}' in project '${projectId}' not found.` });
            }
            return sendJSON(res, 200, { success: true, ...data });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/save$/)) {
        const match = req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/save$/);
        const projectId = match[1];
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const chatSession = JSON.parse(body || "{}");
            if (!chatSession || !chatSession.id) {
                return sendJSON(res, 400, { error: "Valid chat session with 'id' is required." });
            }
            const workspace = conversationsManager.saveProjectChat(projectId, chatSession);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/session$/)) {
        const match = req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/session$/);
        const projectId = match[1];
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const chatId = data.chatId;
            if (!chatId) {
                return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
            }
            const workspace = conversationsManager.ensureProjectChatWorkspace(projectId, chatId);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/([^/?]+)/)) {
        const match = req.url.match(/^\/api\/build\/projects\/([^/]+)\/chats\/([^/?]+)/);
        const projectId = match[1];
        const chatId = match[2];
        try {
            const deleted = conversationsManager.deleteProjectChat(projectId, chatId);
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    // Directory Validator Helper for Choosing Projects
    if (req.method === "GET" && req.url.startsWith("/api/fs/validate-dir")) {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
            const inputPath = parsedUrl.searchParams.get("path") || "";
            if (!inputPath.trim()) {
                const homeDir = os.homedir();
                const suggestions = [process.cwd(), homeDir];
                const docsDir = path.join(homeDir, "Documents");
                if (fs.existsSync(docsDir)) suggestions.push(docsDir);
                return sendJSON(res, 200, { valid: false, suggestions });
            }

            const resolved = conversationsManager.resolveHome(inputPath.trim());
            if (!fs.existsSync(resolved)) {
                return sendJSON(res, 200, { valid: false, error: "Directory does not exist." });
            }
            const stat = fs.statSync(resolved);
            if (!stat.isDirectory()) {
                return sendJSON(res, 200, { valid: false, error: "Path exists but is a file, not a directory." });
            }

            return sendJSON(res, 200, {
                valid: true,
                resolvedPath: resolved,
                name: path.basename(resolved) || "Project"
            });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/log") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            logToFile(data.tag || "CLIENT", data);
            return sendJSON(res, 200, { ok: true });
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    // Intercept image generation background tasks if queried via task APIs
    if (req.url.startsWith("/api/task/stdout/")) {
        const taskId = decodeURIComponent(req.url.replace("/api/task/stdout/", "")).trim();
        if (taskId.startsWith("gen_") && imageGenTasks.has(taskId)) {
            const task = imageGenTasks.get(taskId);
            if (task.status === "completed") {
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "completed",
                    done: true,
                    output: task.result?.markdown || `![${task.prompt}](${task.result?.url})`,
                    url: task.result?.url,
                    result: task.result
                });
            } else if (task.status === "failed") {
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "failed",
                    done: true,
                    error: task.error,
                    output: `Image generation failed: ${task.error}`
                });
            } else {
                const elapsed = ((Date.now() - task.created_at) / 1000).toFixed(1);
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "running",
                    done: false,
                    output: `Image generation in progress in background (${elapsed}s elapsed)...`
                });
            }
        }
    }

    if (req.url.startsWith("/api/task/status/")) {
        const taskId = decodeURIComponent(req.url.replace("/api/task/status/", "")).trim();
        if (taskId.startsWith("gen_") && imageGenTasks.has(taskId)) {
            const task = imageGenTasks.get(taskId);
            return sendJSON(res, 200, {
                task_id: taskId,
                status: task.status,
                running: task.status === "running",
                created_at: task.created_at,
                result: task.result,
                error: task.error
            });
        }
    }

    // Proxy terminal tasks to the supervised Python backend with large-output scratch logging
    if (req.url.startsWith("/api/task/")) {
        let reqBody = "";
        try {
            for await (const chunk of req) reqBody += chunk;
        } catch (_) {}

        let parsedBody = {};
        try {
            parsedBody = reqBody ? JSON.parse(reqBody) : {};
        } catch (_) {}

        const chatId = req.headers["x-chat-id"] || parsedBody.chatId || parsedBody.chat_id || "";
        let scratchDir = "";
        let artifactsDir = "";
        if (chatId) {
            try {
                const ws = conversationsManager.ensureChatWorkspace(chatId);
                scratchDir = ws.scratchDir;
                artifactsDir = ws.artifactsDir;
            } catch (_) {}
        }
        if (!scratchDir) {
            scratchDir = path.join(conversationsManager.getStorageRoot(), "scratch");
        }
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        if (!artifactsDir) {
            artifactsDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
        }
        if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
        }

        if (parsedBody && typeof parsedBody === "object") {
            parsedBody.scratch_dir = scratchDir;
            parsedBody.artifacts_dir = artifactsDir;
            reqBody = JSON.stringify(parsedBody);
        }

        const headers = { ...req.headers };
        if (reqBody) {
            headers["content-length"] = Buffer.byteLength(reqBody);
        }

        const options = {
            hostname: "127.0.0.1",
            port: 5000,
            path: req.url,
            method: req.method,
            headers
        };

        const startTime = Date.now();
        const proxyReq = http.request(options, (proxyRes) => {
            let resData = "";
            proxyRes.on("data", (chunk) => { resData += chunk; });
            proxyRes.on("end", () => {
                let json;
                try {
                    json = JSON.parse(resData);
                } catch (_) {}

                if (json && typeof json === "object") {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    json.ran_for = json.elapsed_seconds ? String(json.elapsed_seconds) : elapsed;

                    const combinedOutput = (json.stdout || "") + (json.stderr ? "\n" + json.stderr : "");
                    const lines = combinedOutput.split("\n");
                    const isLarge = lines.length > 100 || Buffer.byteLength(combinedOutput) > 2048;

                    if (isLarge) {
                        try {
                            const chatId = req.headers["x-chat-id"] || parsedBody.chatId || "";
                            let scratchDir = "";
                            if (chatId) {
                                try {
                                    scratchDir = conversationsManager.ensureChatWorkspace(chatId).scratchDir;
                                } catch (_) {}
                            }
                            if (!scratchDir) {
                                scratchDir = path.join(conversationsManager.getStorageRoot(), "scratch");
                            }
                            if (!fs.existsSync(scratchDir)) {
                                fs.mkdirSync(scratchDir, { recursive: true });
                            }

                            const taskName = parsedBody.task_name || parsedBody.name || "";
                            const cleanName = taskName 
                                ? taskName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 30) 
                                : "task";
                            const logFileName = `${cleanName}-${json.task_id || Date.now().toString(36)}.log`;
                            const logFilePath = path.join(scratchDir, logFileName);

                            fs.writeFileSync(logFilePath, combinedOutput, "utf8");

                            json.is_large_output = true;
                            json.scratch_log_path = `scratch/${logFileName}`;
                            json.truncated_lines = lines.slice(-100).join("\n");
                        } catch (err) {
                            console.warn("[TASK LOG SAVE ERROR]", err.message);
                        }
                    }
                    return sendJSON(res, proxyRes.statusCode, json);
                }

                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(resData);
            });
        });

        proxyReq.on("error", (e) => {
            console.error(`[PROXY ERROR] Python server unreachable: ${e.message}`);
            sendJSON(res, 500, { error: "Python backend is not responding." });
        });

        if (reqBody) {
            proxyReq.write(reqBody);
        }
        proxyReq.end();
        return;
    }

    if (req.method === "POST" && req.url === "/api/search") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const result = await tinyfishSearch(args);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/fetch") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const result = await tinyfishFetch(args);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/file/read") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const chatId = req.headers["x-chat-id"] || args.chatId || args.chat_id || "";
            const result = await handleFileRead(args, chatId);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/file/write") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const chatId = req.headers["x-chat-id"] || args.chatId || args.chat_id || "";
            const result = await handleFileWrite(args, chatId);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/file/search-replace") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const chatId = req.headers["x-chat-id"] || args.chatId || args.chat_id || "";
            const result = await handleSearchAndReplace(args, chatId, { resolveSafePath });
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

        if (req.method === "POST" && req.url === "/api/python/run") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const result = await postJSON(5000, "/api/python/run", args, 35000);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

if (req.method === "POST" && req.url === "/api/code/grep") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const chatId = req.headers["x-chat-id"] || args.chatId || args.chat_id || "";
            const result = await handleCodeGrep(args, chatId, { resolveSafePath, postJSON });
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "GET" && req.url.startsWith("/api/image/status/")) {
        const taskId = decodeURIComponent(req.url.replace("/api/image/status/", "")).trim();
        const task = imageGenTasks.get(taskId);
        if (!task) {
            return sendJSON(res, 404, { error: `Image task '${taskId}' not found` });
        }
        return sendJSON(res, 200, task);
    }

    if (req.method === "POST" && req.url === "/api/image/generate") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { prompt, model, provider, aspect_ratio, width, height, seed, negative_prompt, background } = data;

            if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
                return sendJSON(res, 400, { error: "Parameter 'prompt' is required for image generation." });
            }

            const logflareKey = getEnvKey("LOGFLARE_API_KEY") || getEnvKey("LOGFARE_API_KEY");
            const openaiKey = getEnvKey("OPENAI_API_KEY") || getEnvKey("OPENAI_KEY");

            const defaultImageProvider = getConfig().General?.DefaultImageProvider || "pollinations";
            let targetProviderKey = provider || model || defaultImageProvider;
            const { resolveImageProvider: getImgProvider } = require("./providers");

            let apiKey = null;
            if (targetProviderKey.toLowerCase().includes("openai") || targetProviderKey.toLowerCase().includes("dall")) {
                apiKey = openaiKey;
                if (!apiKey) {
                    console.warn("[IMAGE API] OpenAI API key not found. Falling back to Pollinations AI...");
                    targetProviderKey = "pollinations";
                }
            } else if (targetProviderKey.toLowerCase().includes("logf") || targetProviderKey.toLowerCase().includes("sdxl")) {
                apiKey = logflareKey;
                if (!apiKey) {
                    console.warn("[IMAGE API] Logflare API key not found. Falling back to Pollinations AI...");
                    targetProviderKey = "pollinations";
                }
            }

            let imageHandler = getImgProvider(targetProviderKey);
            if (!imageHandler) {
                targetProviderKey = "pollinations";
                imageHandler = getImgProvider("pollinations");
            }

            const activeChatId = data.chatId || data.chat_id;
            const genTaskId = "gen_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
            const chosenModel = model || (targetProviderKey.includes("logf") ? "sdxl-lightning" : "turbo");

            const taskRecord = {
                task_id: genTaskId,
                prompt: prompt.trim(),
                provider: targetProviderKey,
                model: chosenModel,
                status: "running",
                created_at: Date.now(),
                chat_id: activeChatId,
                result: null,
                error: null
            };
            imageGenTasks.set(genTaskId, taskRecord);

            const genPromise = (async () => {
                try {
                    let result;
                    try {
                        result = await imageHandler.generateImage({
                            prompt: prompt.trim(),
                            model: chosenModel,
                            aspectRatio: aspect_ratio || "1:1",
                            width,
                            height,
                            apiKey,
                            options: { seed, negative_prompt }
                        });
                    } catch (primaryErr) {
                        if (targetProviderKey !== "pollinations") {
                            console.warn(`[IMAGE API] ${targetProviderKey} generation failed (${primaryErr.message}). Falling back to Pollinations AI...`);
                            const fallbackHandler = getImgProvider("pollinations");
                            result = await fallbackHandler.generateImage({
                                prompt: prompt.trim(),
                                model: "turbo",
                                aspectRatio: aspect_ratio || "1:1",
                                width,
                                height,
                                options: { seed, negative_prompt }
                            });
                        } else {
                            throw primaryErr;
                        }
                    }

                    if (activeChatId && result.url && result.url.startsWith("/generated_images/")) {
                        try {
                            const localImgPath = path.join(process.cwd(), result.url.slice(1));
                            if (fs.existsSync(localImgPath)) {
                                const filename = path.basename(localImgPath);
                                const ws = conversationsManager.ensureChatWorkspace(activeChatId);
                                fs.copyFileSync(localImgPath, path.join(ws.imagesDir, filename));
                                result.chatImagePath = path.join(ws.imagesDir, filename);
                            }
                        } catch (e) {
                            console.warn(`[IMAGE API] Failed to copy image to chat ${activeChatId}:`, e.message);
                        }
                    }

                    taskRecord.status = "completed";
                    taskRecord.result = result;
                    taskRecord.completed_at = Date.now();
                    return result;
                } catch (err) {
                    console.error(`[IMAGE API] Task ${genTaskId} error:`, err.message);
                    taskRecord.status = "failed";
                    taskRecord.error = err.message;
                    taskRecord.completed_at = Date.now();
                    throw err;
                }
            })();

            // If background execution requested explicitly:
            if (background === true) {
                return sendJSON(res, 200, {
                    status: "in_progress",
                    background: true,
                    task_id: genTaskId,
                    prompt: `Image generation is running in the background (task_id: ${genTaskId}). The model can continue with other tasks now without waiting.`,
                    message: `Image generation started in background with task_id: ${genTaskId}`
                });
            }

            // Otherwise wait up to 15 seconds:
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve({ __timedOut: true }), 15000);
            });

            try {
                const outcome = await Promise.race([genPromise, timeoutPromise]);
                if (outcome && outcome.__timedOut) {
                    // Exceeded 15s - background it and let model continue!
                    return sendJSON(res, 200, {
                        status: "in_progress",
                        background: true,
                        task_id: genTaskId,
                        prompt: `Image generation is taking longer than 15s and is running in the background (task_id: ${genTaskId}). The model may continue other tasks without waiting. When complete, the image will be saved to the conversation images.`,
                        message: `Image generation backgrounded with task_id: ${genTaskId}`
                    });
                }

                return sendJSON(res, 200, {
                    ...outcome,
                    task_id: genTaskId
                });
            } catch (err) {
                // Return exact error without wired-up fallback
                return sendJSON(res, 500, {
                    task_id: genTaskId,
                    error: err.message
                });
            }
        } catch (error) {
            console.error("[IMAGE API ERROR]", error);
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/models") {
        if (req.method === "HEAD") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end();
        }
        const config = loadModelsConfig();
        const resultProviders = [];
        for (const [providerId, provider] of Object.entries(config.providers || {})) {
            const key = provider.api_key_env ? getEnvKey(provider.api_key_env) : null;
            const isAvailable = !provider.api_key_env || Boolean(key);
            const entry = {
                id: providerId,
                name: provider.name || providerId,
                type: provider.type,
                available: isAvailable,
                has_key: Boolean(key),
                models: (provider.models || []).map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    default: Boolean(m.default),
                    supports_tools: m.supports_tools !== false,
                    supports_vision: Boolean(m.supports_vision),
                    max_context_tokens: m.max_context_tokens || provider.max_context_tokens || getModelDefaultContext(m.id, provider.type || providerId),
                    provider: providerId
                }))
            };
            // Pass rolling flag so the frontend knows to show URL-prompt instead of model list
            if (provider.rolling) {
                entry.rolling = true;
                // Inject live-discovered model if probe was called this session
                if (providerId === "koboldcpp" && koboldBaseUrl) {
                    entry.connected_base_url = koboldBaseUrl;
                }
            }
            resultProviders.push(entry);
        }
        return sendJSON(res, 200, { providers: resultProviders });
    }

    // ----------------------------------------------------------------
    // KoboldCPP rolling connection — probe & base_url cache
    // ----------------------------------------------------------------
    if (req.method === "GET" && req.url === "/api/kobold/base_url") {
        return sendJSON(res, 200, { base_url: koboldBaseUrl || null });
    }

    if (req.method === "POST" && req.url === "/api/kobold/probe") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const { base_url } = JSON.parse(body || "{}");
            if (!base_url || typeof base_url !== "string") {
                return sendJSON(res, 400, { error: "base_url is required" });
            }

            const cleanUrl = base_url.replace(/\/+$/, "");

            // Probe 1: get loaded model name
            const modelRes = await fetch(`${cleanUrl}/api/v1/model`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!modelRes.ok) {
                return sendJSON(res, 502, { error: `KoboldCPP at ${cleanUrl} returned HTTP ${modelRes.status} on /api/v1/model` });
            }
            const modelData = await modelRes.json();
            const modelName = modelData.result || modelData.model || "koboldcpp-model";

            // Probe 2: get context length (graceful fallback)
            let contextSize = 4096;
            try {
                const ctxRes = await fetch(`${cleanUrl}/api/extra/true_max_context_length`, {
                    signal: AbortSignal.timeout(3000)
                });
                if (ctxRes.ok) {
                    const ctxData = await ctxRes.json();
                    contextSize = ctxData.value || ctxData.max_context_length || 4096;
                }
            } catch (_) { /* non-critical — use fallback */ }

            // Store in session memory (resets on server restart)
            koboldBaseUrl = cleanUrl;

            console.log(`[KOBOLD] Connected to ${cleanUrl} — model: ${modelName}, ctx: ${contextSize}`);
            return sendJSON(res, 200, {
                success: true,
                base_url: cleanUrl,
                model_name: modelName,
                model_id: `koboldcpp:${modelName}`,
                context_size: contextSize,
                supports_tools: true,
                supports_vision: false
            });
        } catch (err) {
            if (err.name === "TimeoutError") {
                return sendJSON(res, 504, { error: "Connection timed out — is KoboldCPP running at that URL?" });
            }
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/config") {
        if (req.method === "HEAD") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end();
        }
        return sendJSON(res, 200, getConfig());
    }

    if (req.method === "POST" && req.url === "/api/config") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const updates = JSON.parse(body || "{}");
            const updated = saveConfig(updates);
            return sendJSON(res, 200, { success: true, config: updated });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/chat") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { model, messages, tools, tool_choice } = data;
            let providerId = data.provider;

            const config = loadModelsConfig();
            if (!providerId) {
                for (const [pId, pData] of Object.entries(config.providers || {})) {
                    if ((pData.models || []).some(m => m.id === model)) {
                        providerId = pId;
                        break;
                    }
                }
            }

            const provider = config.providers?.[providerId];
            if (!provider) {
                return sendJSON(res, 400, { error: `Unknown provider or model '${model}'` });
            }

            const apiKey = provider.api_key_env ? getEnvKey(provider.api_key_env) : null;
            if (provider.api_key_env && !apiKey) {
                return sendJSON(res, 400, { error: `API key for provider '${provider.name}' (${provider.api_key_env}) is not set.` });
            }

            const providerKey = providerId || provider.name || provider.type;
            const providerHandler = resolveProvider(providerKey);

            // For rolling providers (e.g. KoboldCPP), inject the session base_url
            const effectiveProviderConfig = { ...provider };
            if (providerKey === "koboldcpp" && koboldBaseUrl) {
                effectiveProviderConfig.base_url = koboldBaseUrl;
            }

            const chatResult = await providerHandler.handleChat({
                model,
                apiKey,
                providerConfig: effectiveProviderConfig,
                messages,
                tools,
                tool_choice
            });

            if (chatResult.status !== 200) {
                return sendJSON(res, chatResult.status || 500, { error: chatResult.error || "Provider error" });
            }

            return sendJSON(res, 200, {
                message: chatResult.message
            });
        } catch (error) {
            console.error("[CHAT API ERROR]", error);
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/agent/stream") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { model, messages, tools, chatId, todos } = data;

            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*"
            });

            const graph = createAgentGraph();
            const stream = await graph.stream({
                messages: messages || [],
                model: model || "gemini-2.5-flash",
                chatId: chatId || "",
                todos: todos || []
            }, {
                configurable: {
                    thread_id: chatId || "default_thread",
                    tools: tools || [],
                    modelsConfig: loadModelsConfig(),
                    getApiKey: getEnvKey
                },
                streamMode: "updates"
            });

            for await (const update of stream) {
                res.write(`data: ${JSON.stringify(update)}\n\n`);
            }

            res.write("data: [DONE]\n\n");
            return res.end();
        } catch (err) {
            console.error("[AGENT STREAM ERROR]", err);
            if (!res.headersSent) {
                return sendJSON(res, 500, { error: err.message });
            }
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.write("data: [DONE]\n\n");
            return res.end();
        }
    }

    // ---------------------------------------------------------
    // DeepSearch Endpoints
    // ---------------------------------------------------------
    if (req.method === "POST" && req.url === "/api/deepsearch/start") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, topic, plan, model } = data;

            if (!topic) {
                return sendJSON(res, 400, { error: "Topic is required for DeepSearch" });
            }

            let artifactDir;
            if (chatId) {
                try {
                    const ws = conversationsManager.ensureChatWorkspace(chatId);
                    artifactDir = ws.artifactsDir;
                } catch (e) {
                    artifactDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
                }
            } else {
                artifactDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
            }

            const job = deepSearchManager.createJob({
                chatId: chatId || "default",
                topic,
                plan: plan || "",
                model: model || configManager.get("General", "DefaultStartupLLM") || "glm-4.5-flash",
                artifactDir
            });

            // Fire autonomous LangGraph background job without blocking response
            setImmediate(async () => {
                try {
                    await runDeepSearchWorkflow(job, {
                        configurable: {
                            modelsConfig: loadModelsConfig(),
                            getApiKey: getEnvKey
                        }
                    });
                } catch (e) {
                    console.error("[DeepSearch Background Error]", e);
                }
            });

            return sendJSON(res, 200, { status: "started", job });
        } catch (error) {
            console.error("[DEEPSEARCH START ERROR]", error);
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "GET" && req.url.startsWith("/api/deepsearch/status/")) {
        const jobId = decodeURIComponent(req.url.replace("/api/deepsearch/status/", "")).split("?")[0].trim();
        const job = deepSearchManager.getJob(jobId);
        if (!job) {
            return sendJSON(res, 404, { error: `Job ${jobId} not found` });
        }
        return sendJSON(res, 200, { job });
    }

    if (req.method === "GET" && req.url.startsWith("/api/deepsearch/chat/")) {
        const chatId = decodeURIComponent(req.url.replace("/api/deepsearch/chat/", "")).split("?")[0].trim();
        const job = deepSearchManager.getJobByChatId(chatId);
        return sendJSON(res, 200, { job });
    }

    if (req.method === "GET" || req.method === "HEAD") {
        let reqPath = req.url.split("?")[0];
        if (reqPath.startsWith("/../client")) {
            reqPath = reqPath.slice("/../client".length);
            if (!reqPath.startsWith("/")) reqPath = "/" + reqPath;
        }
        if (reqPath.includes("..")) {
            res.writeHead(400);
            return res.end("Bad request");
        }

        const webRoot = path.join(__dirname, "../client");
        let filePath = "";
        if (reqPath === "/" || reqPath === "/index.html" || reqPath === "/modular") {
            filePath = path.join(webRoot, "index.html");
        } else if (reqPath.startsWith("/styles/") || reqPath.startsWith("/src/")) {
            filePath = path.join(webRoot, reqPath);
        } else if (fs.existsSync(path.join(webRoot, reqPath)) && !fs.statSync(path.join(webRoot, reqPath)).isDirectory()) {
            filePath = path.join(webRoot, reqPath);
        } else if (fs.existsSync(path.join(process.cwd(), reqPath)) && !fs.statSync(path.join(process.cwd(), reqPath)).isDirectory()) {
            filePath = path.join(process.cwd(), reqPath);
        } else if (fs.existsSync(path.join(__dirname, "..", reqPath)) && !fs.statSync(path.join(__dirname, "..", reqPath)).isDirectory()) {
            filePath = path.join(__dirname, "..", reqPath);
        } else {
            filePath = path.join(webRoot, "index.html");
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end("Not found");
            }
            const ext = path.extname(filePath).toLowerCase();
            const type = getMimeType(ext);
            res.writeHead(200, { 
                "Content-Type": type,
                "Content-Length": Buffer.byteLength(data),
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            });
            if (req.method === "HEAD") {
                return res.end();
            }
            res.end(data);
        });
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, HOST, () => {
  const hostDisplay = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Node Server running at http://${hostDisplay}:${PORT}`);
});
