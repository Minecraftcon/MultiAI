const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");
const { spawn, exec } = require("child_process");
const YAML = require("yaml");
const { resolveProvider, resolveImageProvider } = require("./providers");
const { getConfig, saveConfig } = require("./config_manager");
const conversationsManager = require("./conversations_manager");

function getEnvKey(keyName) {
    if (!keyName) return null;
    if (process.env[keyName]) return process.env[keyName];
    try {
        const bashrcPath = path.join(os.homedir(), ".bashrc");
        if (fs.existsSync(bashrcPath)) {
            const content = fs.readFileSync(bashrcPath, "utf8");
            const match = content.match(new RegExp(`export\\s+${keyName}=["']?([^"'\\r\\n]+)["']?`));
            if (match && match[1]) {
                process.env[keyName] = match[1].trim();
                return process.env[keyName];
            }
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function loadModelsConfig() {
    try {
        const yamlPath = path.join(__dirname, "models.yaml");
        if (fs.existsSync(yamlPath)) {
            const fileContent = fs.readFileSync(yamlPath, "utf8");
            return YAML.parse(fileContent) || { providers: {} };
        }
    } catch (e) {
        console.error("[MODELS] Error loading models.yaml:", e.message);
    }
    return { providers: {} };
}

// ---------------------------------------------------------
// Universal Chat Message Normalization Layer
// ---------------------------------------------------------
function normalizeMessage(msg, supportsTools = true, supportsVision = true) {
    if (!msg || typeof msg !== "object") return null;
    const role = msg.role;

    if (role === "system") {
        return {
            role: "system",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "user") {
        if (Array.isArray(msg.content)) {
            if (supportsVision) {
                const parts = [];
                for (const part of msg.content) {
                    if (part.type === "text") {
                        parts.push({ type: "text", text: String(part.text || "") });
                    } else if (part.type === "image_url" && part.image_url?.url) {
                        parts.push({
                            type: "image_url",
                            image_url: { url: String(part.image_url.url) }
                        });
                    }
                }
                return { role: "user", content: parts };
            } else {
                let text = "";
                let imgCount = 0;
                for (const part of msg.content) {
                    if (part.type === "text") text += (part.text || "") + " ";
                    if (part.type === "image_url") imgCount++;
                }
                if (imgCount > 0) {
                    text += `\n[Note: ${imgCount} image(s) attached, but model is text-only]`;
                }
                return { role: "user", content: text.trim() };
            }
        }
        return {
            role: "user",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "assistant") {
        const hasToolCalls = msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
        if (hasToolCalls) {
            if (supportsTools) {
                return {
                    role: "assistant",
                    content: typeof msg.content === "string" ? msg.content : null,
                    tool_calls: msg.tool_calls.map(tc => ({
                        id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                        type: "function",
                        function: {
                            name: String(tc.function?.name || ""),
                            arguments: typeof tc.function?.arguments === "string"
                                ? tc.function.arguments
                                : JSON.stringify(tc.function?.arguments || {})
                        }
                    }))
                };
            } else {
                const toolNames = msg.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(", ");
                return {
                    role: "assistant",
                    content: msg.content || (toolNames ? `[Action taken: ${toolNames}]` : "[Action taken]")
                };
            }
        }
        return {
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "tool") {
        if (supportsTools) {
            return {
                role: "tool",
                name: msg.name ? String(msg.name) : undefined,
                tool_call_id: String(msg.tool_call_id || ""),
                content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
            };
        } else {
            return {
                role: "user",
                content: `[Tool Result]: ${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`
            };
        }
    }

    return {
        role: "user",
        content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
    };
}

function normalizeMessages(messages, supportsTools = true, supportsVision = true) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => normalizeMessage(m, supportsTools, supportsVision)).filter(Boolean);
}

function formatAssistantResponse(rawMessage) {
    if (!rawMessage || typeof rawMessage !== "object") {
        return { role: "assistant", content: "" };
    }
    const clean = {
        role: "assistant",
        content: typeof rawMessage.content === "string"
            ? rawMessage.content
            : (Array.isArray(rawMessage.content) ? rawMessage.content.map(c => c.text || "").join("") : (rawMessage.content || ""))
    };
    if (rawMessage.tool_calls && Array.isArray(rawMessage.tool_calls) && rawMessage.tool_calls.length > 0) {
        clean.tool_calls = rawMessage.tool_calls.map(tc => ({
            id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
            type: "function",
            function: {
                name: String(tc.function?.name || ""),
                arguments: typeof tc.function?.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {})
            }
        }));
    }
    return clean;
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
const LOG_FILE = appConfig.General?.LogFile || "./logs.txt";

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
const pythonCmd = process.platform === "win32" ? "python" : "python3";
const taskScript = (process.platform === "win32" && fs.existsSync("./task_server_windows.py"))
    ? "./task_server_windows.py"
    : "./task_server.py";
const pythonProcess = spawn(pythonCmd, [taskScript], {
    stdio: ["pipe", "pipe", "pipe"]
});

console.log(`[PROCESS] Started ${taskScript} with PID: ${pythonProcess.pid}`);

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
});

pythonProcess.on("error", (err) => {
    console.error(`[PROCESS ERROR] Failed to spawn task_server.py: ${err.message}`);
});

// Clean termination helper
function cleanupAndExit(exitCode = 0) {
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
        ".ts": "text/typescript",
        ".html": "text/html",
        ".css": "text/css",
        ".avif": "image/avif",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
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
        ".ts": "video/mp2t",
        ".m2ts": "video/mp2t",
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

function resolveSafePath(inputPath) {
    const raw = String(inputPath || "").trim();
    if (!raw) throw new Error("Path parameter is empty or missing");
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw);
}

async function handleFileRead(args) {
    const targetPath = resolveSafePath(args.path);
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

async function handleFileWrite(args) {
    const targetPath = resolveSafePath(args.path);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    let action = args.action;
    if (!action) {
        if (Array.isArray(args.operations)) action = "batch";
        else if (args.target !== undefined) action = "replace";
        else if (args.line !== undefined) action = "inject";
        else action = "write";
    }

    const writeAtomic = async (filePath, text) => {
        const tmpPath = filePath + ".tmp." + Math.random().toString(36).substring(2, 9);
        await fs.promises.writeFile(tmpPath, text, "utf-8");
        await fs.promises.rename(tmpPath, filePath);
    };

    if (action === "write") {
        if (fs.existsSync(targetPath) && args.overwrite === false) {
            throw new Error(`File already exists: ${args.path} and overwrite is false`);
        }
        const textToWrite = args.content ?? "";
        await writeAtomic(targetPath, textToWrite);
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "write",
            bytes_written: Buffer.byteLength(textToWrite),
            status: "success",
            message: `Successfully wrote file: ${args.path}`
        };
    }

    if (action === "replace") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for replacement: ${args.path}`);
        }
        const current = await fs.promises.readFile(targetPath, "utf-8");
        const target = args.target;
        if (target === undefined || target === null) {
            throw new Error("Missing 'target' string to replace");
        }
        const replacement = args.replacement ?? "";

        // If line constraints are provided
        if (args.start_line || args.end_line) {
            const lines = current.split("\n");
            const s = Math.max(1, parseInt(args.start_line, 10) || 1) - 1;
            const e = args.end_line ? Math.min(lines.length, parseInt(args.end_line, 10)) : lines.length;
            const chunk = lines.slice(s, e).join("\n");
            const count = chunk.split(target).length - 1;
            if (count === 0) {
                throw new Error(`Target string not found within lines ${s + 1}-${e} of ${args.path}.`);
            }
            if (count > 1 && !args.all) {
                throw new Error(`Found ${count} occurrences of target string within lines ${s + 1}-${e} of ${args.path}. Specify 'all: true' or provide more context.`);
            }
            const replacedChunk = args.all ? chunk.replaceAll(target, replacement) : chunk.replace(target, replacement);
            const newContent = [lines.slice(0, s).join("\n"), replacedChunk, lines.slice(e).join("\n")].filter(Boolean).join("\n");
            await writeAtomic(targetPath, newContent);
            return {
                success: true,
                path: args.path,
                resolved_path: targetPath,
                action: "replace",
                matches: count,
                occurrences_replaced: args.all ? count : 1,
                status: "success",
                message: `Successfully replaced text in ${args.path} (lines ${s + 1}-${e})`
            };
        } else {
            const count = current.split(target).length - 1;
            if (count === 0) {
                throw new Error(`Target string not found in ${args.path}. Please verify the exact text to replace.`);
            }
            if (count > 1 && !args.all) {
                throw new Error(`Found ${count} occurrences of target string in ${args.path}. Specify 'all: true' or provide more surrounding context to make the match unique.`);
            }
            const newContent = args.all ? current.replaceAll(target, replacement) : current.replace(target, replacement);
            await writeAtomic(targetPath, newContent);
            return {
                success: true,
                path: args.path,
                resolved_path: targetPath,
                action: "replace",
                matches: count,
                occurrences_replaced: args.all ? count : 1,
                status: "success",
                message: `Successfully replaced ${args.all ? count : 1} occurrence(s) in ${args.path}`
            };
        }
    }

    if (action === "inject") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for line injection: ${args.path}`);
        }
        const current = await fs.promises.readFile(targetPath, "utf-8");
        const lines = current.split("\n");
        const targetLine = parseInt(args.line, 10);
        const injectContent = String(args.content ?? "");

        if (isNaN(targetLine) || targetLine < 0 || targetLine >= lines.length) {
            lines.push(injectContent);
        } else if (targetLine <= 1) {
            lines.unshift(injectContent);
        } else {
            lines.splice(targetLine, 0, injectContent);
        }
        await writeAtomic(targetPath, lines.join("\n"));
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "inject",
            line_injected: targetLine,
            status: "success",
            message: `Successfully injected content at line ${targetLine} in ${args.path}`
        };
    }

    if (action === "batch") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for batch operations: ${args.path}`);
        }
        const ops = Array.isArray(args.operations) ? args.operations : [];
        if (ops.length === 0) {
            throw new Error("No operations provided for batch action");
        }
        let current = await fs.promises.readFile(targetPath, "utf-8");

        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const opAction = op.action || (op.target !== undefined ? "replace" : (op.line !== undefined ? "inject" : "write"));

            if (opAction === "replace") {
                const target = op.target;
                if (target === undefined || target === null) throw new Error(`Batch operation #${i + 1}: Missing 'target' string`);
                const replacement = op.replacement ?? "";
                const count = current.split(target).length - 1;
                if (count === 0) throw new Error(`Batch operation #${i + 1}: Target string not found in ${args.path}`);
                if (count > 1 && !op.all) throw new Error(`Batch operation #${i + 1}: Found ${count} occurrences of target string in ${args.path}. Specify 'all: true' or provide more surrounding context.`);
                current = op.all ? current.replaceAll(target, replacement) : current.replace(target, replacement);
            } else if (opAction === "inject") {
                const lines = current.split("\n");
                const targetLine = parseInt(op.line, 10);
                const injectContent = String(op.content ?? "");
                if (isNaN(targetLine) || targetLine < 0 || targetLine >= lines.length) {
                    lines.push(injectContent);
                } else if (targetLine <= 1) {
                    lines.unshift(injectContent);
                } else {
                    lines.splice(targetLine, 0, injectContent);
                }
                current = lines.join("\n");
            } else if (opAction === "write") {
                current = op.content ?? "";
            } else {
                throw new Error(`Batch operation #${i + 1}: Unsupported action '${opAction}'`);
            }
        }

        await writeAtomic(targetPath, current);
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "batch",
            operations_applied: ops.length,
            status: "success",
            message: `Successfully applied ${ops.length} batch operations to ${args.path}`
        };
    }

    throw new Error(`Unknown action: '${action}' for write_file`);
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
                candidates.push(path.join(process.cwd(), "MultiAI-MODular", rawPath.replace(/^\/+/, "")));
            } else {
                candidates.push(path.resolve(process.cwd(), rawPath));
                candidates.push(path.resolve(process.cwd(), "MultiAI-MODular", rawPath));
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

    // Proxy terminal tasks to the supervised Python backend
    if (req.url.startsWith("/api/task/")) {
        const options = {
            hostname: "127.0.0.1",
            port: 5000,
            path: req.url,
            method: req.method,
            headers: req.headers
        };
        const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
        });
        req.pipe(proxyReq, { end: true });
        proxyReq.on("error", (e) => {
            console.error(`[PROXY ERROR] Python server unreachable: ${e.message}`);
            sendJSON(res, 500, { error: "Python backend is not responding." });
        });
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
            const result = await handleFileRead(args);
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
            const result = await handleFileWrite(args);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "POST" && req.url === "/api/image/generate") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { prompt, model, provider, aspect_ratio, width, height, seed, negative_prompt } = data;

            if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
                return sendJSON(res, 400, { error: "Parameter 'prompt' is required for image generation." });
            }

            const defaultImageProvider = getConfig().General?.DefaultImageProvider || "pollinations";
            const targetProviderKey = provider || model || defaultImageProvider;
            const { resolveImageProvider: getImgProvider } = require("./providers");
            const imageHandler = getImgProvider(targetProviderKey);

            let apiKey = null;
            if (targetProviderKey.toLowerCase().includes("openai") || targetProviderKey.toLowerCase().includes("dall")) {
                apiKey = getEnvKey("OPENAI_API_KEY") || getEnvKey("OPENAI_KEY");
                if (!apiKey) {
                    console.warn("[IMAGE API] OpenAI API key not found for DALL-E. Falling back to Pollinations AI...");
                    const fallbackHandler = getImgProvider("pollinations");
                    const result = await fallbackHandler.generateImage({
                        prompt: prompt.trim(),
                        model: "flux",
                        aspectRatio: aspect_ratio || "1:1",
                        width,
                        height,
                        options: { seed, negative_prompt }
                    });
                    return sendJSON(res, 200, result);
                }
            }

            const result = await imageHandler.generateImage({
                prompt: prompt.trim(),
                model,
                aspectRatio: aspect_ratio || "1:1",
                width,
                height,
                apiKey,
                options: { seed, negative_prompt }
            });

            const activeChatId = data.chatId || data.chat_id;
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

            return sendJSON(res, 200, result);
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
            resultProviders.push({
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
                    provider: providerId
                }))
            });
        }
        return sendJSON(res, 200, { providers: resultProviders });
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

            const chatResult = await providerHandler.handleChat({
                model,
                apiKey,
                providerConfig: provider,
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


    if (req.method === "GET" || req.method === "HEAD") {
        let reqPath = req.url.split("?")[0];
        if (reqPath.startsWith("/MultiAI-MODular")) {
            reqPath = reqPath.slice("/MultiAI-MODular".length);
            if (!reqPath.startsWith("/")) reqPath = "/" + reqPath;
        }
        if (reqPath.includes("..")) {
            res.writeHead(400);
            return res.end("Bad request");
        }

        let filePath = "";
        if (reqPath === "/" || reqPath === "/index.html" || reqPath === "/modular") {
            filePath = "./MultiAI-MODular/index.html";
        } else if (reqPath.startsWith("/styles/") || reqPath.startsWith("/src/")) {
            filePath = "./MultiAI-MODular" + reqPath;
        } else if (fs.existsSync("." + reqPath) && !fs.statSync("." + reqPath).isDirectory()) {
            filePath = "." + reqPath;
        } else if (fs.existsSync("./MultiAI-MODular" + reqPath) && !fs.statSync("./MultiAI-MODular" + reqPath).isDirectory()) {
            filePath = "./MultiAI-MODular" + reqPath;
        } else {
            filePath = "./MultiAI-MODular/index.html";
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
