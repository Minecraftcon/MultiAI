const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");
const { spawn, exec } = require("child_process");
const YAML = require("yaml");
const { resolveProvider } = require("./providers");

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
        isTermux,
        isWindows,
        isMac,
        isLinux,
        instructions
    };
}

const PORT = 8080;
const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY;
const LOG_FILE = "./logs.txt";

if (!TINYFISH_API_KEY) {
    console.warn("[WARNING] TINYFISH_API_KEY is not set. Web search (/api/search) will be unavailable until configured.");
}

fs.writeFileSync(LOG_FILE, `--- log started ${new Date().toISOString()} ---\n`);

function logToFile(tag, data) {
    const entry = { timestamp: new Date().toISOString(), tag, ...data };
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
            const ext = filePath.split(".").pop().toLowerCase();
            const mimeTypes = {
                html: "text/html",
                js: "text/javascript",
                mjs: "text/javascript",
                css: "text/css",
                json: "application/json",
                svg: "image/svg+xml",
                png: "image/png",
                jpg: "image/jpeg",
                ico: "image/x-icon"
            };
            const type = mimeTypes[ext] || "application/octet-stream";
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

server.listen(PORT, () => {
  console.log(`Node Server running at http://localhost:${PORT}`);
  exec(`xdg-open http://localhost:${PORT}`);
});
