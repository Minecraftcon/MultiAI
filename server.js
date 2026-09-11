const http = require("http");
const fs = require("fs");
const path = require("url");
const { spawn } = require("child_process");

const PORT = 8080;
const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY;
const LOG_FILE = "./logs.txt";

if (!TINYFISH_API_KEY) {
    console.error("ERROR: TINYFISH_API_KEY is not set.");
    process.exit(1);
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
const pythonProcess = spawn(pythonCmd, ["./task_server.py"], {
    stdio: ["pipe", "pipe", "pipe"]
});

console.log(`[PROCESS] Started task_server.py with PID: ${pythonProcess.pid}`);

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

    if (req.method === "GET") {
        let file = req.url === "/" ? "/index.html" : req.url;
        if (file.includes("..")) {
            res.writeHead(400);
            return res.end("Bad request");
        }
        fs.readFile("." + file, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end("Not found");
            }
            const type = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
            res.writeHead(200, { "Content-Type": type });
            res.end(data);
        });
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Node Server running at http://localhost:${PORT}`);
});
