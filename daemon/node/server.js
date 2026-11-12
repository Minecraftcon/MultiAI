#!/usr/bin/env node
/**
 * MultiAI Pure Node.js Task Daemon
 * ================================
 * High-performance, zero-external-dependency task execution, streaming,
 * process management, grep searching, and code execution engine.
 * Fully replaces the legacy Python Flask task server.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");
const vm = require("vm");

const DEFAULT_PORT = 5000;
const DEFAULT_HOST = "127.0.0.1";

// Keycode and terminal combination mapping
const KEY_MAP = {
    "ctrl+c": { bytes: Buffer.from("\x03"), sigint: true },
    "ctrl-c": { bytes: Buffer.from("\x03"), sigint: true },
    "ctrl+d": { bytes: Buffer.from("\x04") },
    "ctrl-d": { bytes: Buffer.from("\x04") },
    "ctrl+z": { bytes: Buffer.from("\x1a"), sigtstp: true },
    "ctrl-z": { bytes: Buffer.from("\x1a"), sigtstp: true },
    "ctrl+\\": { bytes: Buffer.from("\x1c"), sigquit: true },
    "ctrl-\\": { bytes: Buffer.from("\x1c"), sigquit: true },
    "enter": { bytes: Buffer.from("\n") },
    "return": { bytes: Buffer.from("\n") },
    "\n": { bytes: Buffer.from("\n") },
    "tab": { bytes: Buffer.from("\t") },
    "\t": { bytes: Buffer.from("\t") },
    "space": { bytes: Buffer.from(" ") },
    "esc": { bytes: Buffer.from("\x1b") },
    "escape": { bytes: Buffer.from("\x1b") },
    "backspace": { bytes: Buffer.from("\x7f") },
    "bs": { bytes: Buffer.from("\x7f") },
    "delete": { bytes: Buffer.from("\x1b[3~") },
    "del": { bytes: Buffer.from("\x1b[3~") },
    "up": { bytes: Buffer.from("\x1b[A") },
    "arrowup": { bytes: Buffer.from("\x1b[A") },
    "down": { bytes: Buffer.from("\x1b[B") },
    "arrowdown": { bytes: Buffer.from("\x1b[B") },
    "right": { bytes: Buffer.from("\x1b[C") },
    "arrowright": { bytes: Buffer.from("\x1b[C") },
    "left": { bytes: Buffer.from("\x1b[D") },
    "arrowleft": { bytes: Buffer.from("\x1b[D") },
    "home": { bytes: Buffer.from("\x1b[H") },
    "end": { bytes: Buffer.from("\x1b[F") },
    "pageup": { bytes: Buffer.from("\x1b[5~") },
    "pgup": { bytes: Buffer.from("\x1b[5~") },
    "pagedown": { bytes: Buffer.from("\x1b[6~") },
    "pgdn": { bytes: Buffer.from("\x1b[6~") }
};

function resolveKeyCombination(combo) {
    const c = (combo || "").trim().toLowerCase().replace("control", "ctrl").replace(/\s+/g, "");
    if (KEY_MAP[c]) return KEY_MAP[c];

    if ((c.startsWith("ctrl+") || c.startsWith("ctrl-")) && c.length === 6) {
        const ch = c[5];
        if (ch >= "a" && ch <= "z") {
            const code = Buffer.from([ch.charCodeAt(0) - "a".charCodeAt(0) + 1]);
            return { bytes: code, sigint: ch === "c", sigtstp: ch === "z" };
        }
    }

    if ((c.startsWith("alt+") || c.startsWith("alt-")) && c.length === 5) {
        const ch = c[4];
        return { bytes: Buffer.concat([Buffer.from("\x1b"), Buffer.from(ch, "utf8")]) };
    }

    return { bytes: Buffer.from(combo, "utf8") };
}

class TaskManager {
    constructor() {
        this.tasks = new Map();
        this.counter = 0;
    }

    generateId() {
        this.counter++;
        return `t_${Date.now().toString(36)}_${this.counter}`;
    }

    spawnProcess(command, options = {}) {
        const { cwd, scratchDir, artifactsDir, shellOverride } = options;
        const targetCwd = cwd || scratchDir || process.cwd();

        const env = {
            ...process.env,
            ...(scratchDir ? { SCRATCH: scratchDir, SCRATCH_DIR: scratchDir } : {}),
            ...(artifactsDir ? { ARTIFACTS: artifactsDir, ARTIFACTS_DIR: artifactsDir } : {})
        };

        const isWin = process.platform === "win32";
        let shellCmd;
        let shellArgs;

        if (shellOverride) {
            shellCmd = shellOverride;
            shellArgs = ["-c", command];
        } else if (isWin) {
            shellCmd = process.env.COMSPEC || "cmd.exe";
            shellArgs = ["/c", command];
        } else {
            shellCmd = process.env.SHELL || "/bin/sh";
            shellArgs = ["-c", command];
        }

        const proc = spawn(shellCmd, shellArgs, {
            cwd: targetCwd,
            env,
            detached: !isWin,
            stdio: ["pipe", "pipe", "pipe"]
        });

        return proc;
    }

    createTask(command, options = {}) {
        const taskId = this.generateId();
        const proc = this.spawnProcess(command, options);
        const startTime = Date.now();

        const task = {
            id: taskId,
            command,
            process: proc,
            pid: proc.pid,
            startTime,
            running: true,
            exitCode: null,
            accumulatedStdout: "",
            accumulatedStderr: "",
            unreadStdout: "",
            unreadStderr: "",
            listeners: new Set()
        };

        proc.stdout.on("data", chunk => {
            const str = chunk.toString("utf8");
            task.accumulatedStdout += str;
            task.unreadStdout += str;
            for (const l of task.listeners) {
                try { l({ type: "stdout", text: str }); } catch (_) {}
            }
        });

        proc.stderr.on("data", chunk => {
            const str = chunk.toString("utf8");
            task.accumulatedStderr += str;
            task.unreadStderr += str;
            for (const l of task.listeners) {
                try { l({ type: "stderr", text: str }); } catch (_) {}
            }
        });

        proc.on("close", (code, signal) => {
            task.running = false;
            task.exitCode = code !== null ? code : (signal ? 128 : 0);
            for (const l of task.listeners) {
                try { l({ type: "close", exitCode: task.exitCode }); } catch (_) {}
            }
        });

        proc.on("error", err => {
            task.running = false;
            task.exitCode = 1;
            task.accumulatedStderr += `\nProcess error: ${err.message}`;
            for (const l of task.listeners) {
                try { l({ type: "close", exitCode: 1 }); } catch (_) {}
            }
        });

        this.tasks.set(taskId, task);
        return task;
    }

    getOutput(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return { error: `Task ${taskId} not found.` };

        const out = task.unreadStdout;
        const err = task.unreadStderr;
        task.unreadStdout = "";
        task.unreadStderr = "";

        return {
            task_id: taskId,
            running: task.running,
            exit_code: task.exitCode,
            stdout: out,
            stderr: err
        };
    }

    sendInput(taskId, options = {}) {
        const task = this.tasks.get(taskId);
        if (!task) return { error: `Task ${taskId} not found.` };
        if (!task.running || !task.process.stdin || task.process.stdin.destroyed) {
            return { error: `Task ${taskId} is not running.` };
        }

        const {
            input_string = "",
            input_type = "text",
            combination = "",
            press_enter = true
        } = options;

        if (input_type === "combination" || combination) {
            const resolved = resolveKeyCombination(combination || input_string);
            try {
                task.process.stdin.write(resolved.bytes);
            } catch (_) {}

            if (resolved.sigint && process.platform !== "win32") {
                try { process.kill(-task.pid, "SIGINT"); } catch (_) {}
            }
            if (resolved.sigtstp && process.platform !== "win32") {
                try { process.kill(-task.pid, "SIGTSTP"); } catch (_) {}
            }
            return { status: "sent", task_id: taskId };
        }

        let payload = input_string;
        if (press_enter && !payload.endsWith("\n")) {
            payload += "\n";
        }

        try {
            task.process.stdin.write(payload, "utf8");
            return { status: "sent", task_id: taskId };
        } catch (err) {
            return { error: `Failed to write input: ${err.message}` };
        }
    }

    killTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return { error: `Task ${taskId} not found.` };

        if (task.running && task.process) {
            try {
                if (process.platform !== "win32") {
                    try {
                        process.kill(-task.pid, "SIGTERM");
                    } catch (e) {
                        if (e.code !== "ESRCH") {
                            try { task.process.kill("SIGTERM"); } catch (_) {}
                        }
                    }
                    setTimeout(() => {
                        if (task.running) {
                            try { process.kill(-task.pid, "SIGKILL"); } catch (_) {}
                        }
                    }, 500);
                } else {
                    execSync(`taskkill /PID ${task.pid} /T /F`, { stdio: "ignore" });
                }
            } catch (_) {}
        }

        return { status: "killed", task_id: taskId };
    }

    listTasks() {
        const result = {};
        for (const [tid, task] of this.tasks.entries()) {
            result[tid] = {
                running: task.running,
                exit_code: task.exitCode,
                command: task.command,
                start_time: task.startTime
            };
        }
        return result;
    }

    cleanFinished() {
        let count = 0;
        for (const [tid, task] of this.tasks.entries()) {
            if (!task.running) {
                this.tasks.delete(tid);
                count++;
            }
        }
        return count;
    }
}

/**
 * High-performance file grep scanner
 */
function executeCodeGrep(options = {}) {
    const {
        query = "",
        search_path = ".",
        is_regex = false,
        case_sensitive = false,
        include_glob = null,
        files_only = false,
        max_results = 50
    } = options;

    const queryStr = String(query || "").trim();
    if (!queryStr) throw new Error("Parameter 'query' is required");

    const resolvedPath = path.resolve(search_path.replace(/^~(?=$|\/|\\)/, os.homedir()));
    if (!fs.existsSync(resolvedPath)) throw new Error(`Path not found: ${search_path}`);

    const maxLim = Math.min(100, Math.max(1, parseInt(max_results, 10) || 50));
    const flags = case_sensitive ? "g" : "gi";
    const pattern = is_regex
        ? new RegExp(queryStr, flags)
        : new RegExp(queryStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

    const ignoreDirs = new Set([".git", "node_modules", "dist", ".venv", "venv", "__pycache__", ".mitm", ".idea", ".vscode"]);
    const matches = [];
    const filesMatched = [];
    let totalScanned = 0;
    const startTime = Date.now();

    function checkFile(filePath) {
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return;
            totalScanned++;

            const fd = fs.openSync(filePath, "r");
            const buf = Buffer.alloc(1024);
            const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
            fs.closeSync(fd);

            // Skip binary
            for (let i = 0; i < bytesRead; i++) {
                if (buf[i] === 0) return;
            }

            const content = fs.readFileSync(filePath, "utf8");
            const relFile = path.relative(resolvedPath, filePath) || path.basename(filePath);

            if (files_only) {
                pattern.lastIndex = 0;
                if (pattern.test(content)) {
                    filesMatched.push(relFile);
                }
                return;
            }

            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    const truncated = line.length > 500 ? line.slice(0, 500) + "…" : line;
                    matches.push({
                        file: relFile,
                        line_number: i + 1,
                        line_content: truncated
                    });
                    if (matches.length >= maxLim) return;
                }
            }
        } catch (_) {}
    }

    function walkDir(dir) {
        if (files_only && filesMatched.length >= maxLim) return;
        if (!files_only && matches.length >= maxLim) return;

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            if (files_only && filesMatched.length >= maxLim) break;
            if (!files_only && matches.length >= maxLim) break;

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
                    walkDir(fullPath);
                }
            } else if (entry.isFile()) {
                if (!entry.name.startsWith(".") || entry.name === ".gitignore") {
                    checkFile(fullPath);
                }
            }
        }
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isFile()) {
        checkFile(resolvedPath);
    } else {
        walkDir(resolvedPath);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return {
        matches,
        files_matched: filesMatched,
        total_scanned: totalScanned,
        elapsed_seconds: parseFloat(elapsed),
        engine_used: "node_fast_scan"
    };
}

/**
 * Sandboxed Node/JS Code Execution Engine
 */
function executeNodeCode(code, options = {}) {
    const rawCode = String(code || "").trim();
    if (!rawCode) {
        return {
            success: false,
            exit_code: 1,
            stdout: "",
            stderr: "Error: Provided code snippet is empty.",
            return_value: null,
            elapsed_seconds: 0
        };
    }

    const timeoutSec = Math.min(300, Math.max(1, parseInt(options.timeout, 10) || 30));
    const startTime = Date.now();

    const outputLogs = [];
    const errorLogs = [];

    const sandbox = {
        console: {
            log: (...args) => outputLogs.push(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")),
            info: (...args) => outputLogs.push(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")),
            warn: (...args) => errorLogs.push(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")),
            error: (...args) => errorLogs.push(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "))
        },
        process: {
            env: {
                ...process.env,
                ...(options.scratch_dir ? { SCRATCH: options.scratch_dir, SCRATCH_DIR: options.scratch_dir } : {}),
                ...(options.artifacts_dir ? { ARTIFACTS: options.artifacts_dir, ARTIFACTS_DIR: options.artifacts_dir } : {})
            },
            cwd: () => options.cwd || options.scratch_dir || process.cwd()
        },
        require,
        Buffer,
        setTimeout,
        clearTimeout,
        URL,
        Math,
        Date,
        JSON
    };

    let result = null;
    let exitCode = 0;
    try {
        const script = new vm.Script(rawCode, { filename: "<multi_ai_eval>" });
        const context = vm.createContext(sandbox);
        result = script.runInContext(context, { timeout: timeoutSec * 1000 });
    } catch (err) {
        exitCode = 1;
        errorLogs.push(err.stack || err.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return {
        success: exitCode === 0,
        exit_code: exitCode,
        stdout: outputLogs.join("\n"),
        stderr: errorLogs.join("\n"),
        return_value: result !== undefined ? result : null,
        elapsed_seconds: parseFloat(elapsed)
    };
}

// Global Manager Instance
const manager = new TaskManager();

function sendJSON(res, status, data) {
    const json = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(json),
        "Access-Control-Allow-Origin": "*"
    });
    res.end(json);
}

function parseJSONBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch (e) {
                resolve({});
            }
        });
        req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Enable CORS preflight
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*"
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, "http://localhost");
    const pathname = parsedUrl.pathname;

    // 1. Health check
    if (req.method === "GET" && pathname === "/health") {
        return sendJSON(res, 200, { status: "ok", engine: "node", pid: process.pid });
    }

    // 2. Task streaming: POST /api/task/stream
    if (req.method === "POST" && pathname === "/api/task/stream") {
        const body = await parseJSONBody(req);
        const command = body.command;
        if (!command) {
            return sendJSON(res, 400, { error: "No command provided" });
        }

        const task = manager.createTask(command, {
            cwd: body.cwd,
            scratchDir: body.scratch_dir,
            artifactsDir: body.artifacts_dir,
            shellOverride: body.shell
        });

        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no"
        });
        if (res.socket) res.socket.setNoDelay(true);

        const writeSSE = (dataObj) => {
            res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
            if (typeof res.flush === "function") res.flush();
        };

        writeSSE({ type: "start", task_id: task.id });

        const listener = (event) => {
            if (event.type === "stdout") {
                writeSSE({ type: "chunk", stdout: event.text, stderr: "" });
            } else if (event.type === "stderr") {
                writeSSE({ type: "chunk", stdout: "", stderr: event.text });
            } else if (event.type === "close") {
                const elapsed = ((Date.now() - task.startTime) / 1000).toFixed(2);
                writeSSE({
                    type: "done",
                    task_id: task.id,
                    done: true,
                    status: `exited (code: ${event.exitCode})`,
                    running: false,
                    exit_code: event.exitCode,
                    stdout: task.accumulatedStdout,
                    stderr: task.accumulatedStderr,
                    ran_for: elapsed
                });
                task.listeners.delete(listener);
                res.end();
            }
        };

        task.listeners.add(listener);

        req.on("close", () => {
            task.listeners.delete(listener);
        });
        return;
    }

    // 3. Task synchronous run: POST /api/task/run
    if (req.method === "POST" && pathname === "/api/task/run") {
        const body = await parseJSONBody(req);
        const command = body.command;
        if (!command) {
            return sendJSON(res, 400, { error: "No command provided" });
        }

        const task = manager.createTask(command, {
            cwd: body.cwd,
            scratchDir: body.scratch_dir,
            artifactsDir: body.artifacts_dir,
            shellOverride: body.shell
        });

        const timeoutSec = Math.min(300, Math.max(1, parseFloat(body.timer || body.timeout || 30)));
        const timer = setTimeout(() => {
            manager.killTask(task.id);
        }, timeoutSec * 1000);

        const listener = (event) => {
            if (event.type === "close") {
                clearTimeout(timer);
                task.listeners.delete(listener);
                const elapsed = ((Date.now() - task.startTime) / 1000).toFixed(2);
                sendJSON(res, 200, {
                    status: "completed",
                    task_id: task.id,
                    exit_code: event.exitCode,
                    stdout: task.accumulatedStdout,
                    stderr: task.accumulatedStderr,
                    running: false,
                    elapsed_seconds: parseFloat(elapsed)
                });
            }
        };

        task.listeners.add(listener);
        return;
    }

    // 4. Idle background task: POST /api/task/idle
    if (req.method === "POST" && pathname === "/api/task/idle") {
        const body = await parseJSONBody(req);
        const command = body.command;
        if (!command) {
            return sendJSON(res, 400, { error: "No command provided" });
        }

        const task = manager.createTask(command, {
            cwd: body.cwd,
            scratchDir: body.scratch_dir,
            artifactsDir: body.artifacts_dir,
            shellOverride: body.shell
        });

        return sendJSON(res, 200, {
            task_id: task.id,
            pid: task.pid,
            status: "running"
        });
    }

    // 5. Read stdout: GET /api/task/stdout/:taskId
    if (req.method === "GET" && pathname.startsWith("/api/task/stdout/")) {
        const taskId = decodeURIComponent(pathname.replace("/api/task/stdout/", "")).trim();
        const output = manager.getOutput(taskId);
        if (output.error) {
            return sendJSON(res, 404, output);
        }
        return sendJSON(res, 200, output);
    }

    // 6. Send input: POST /api/task/input/:taskId
    if (req.method === "POST" && pathname.startsWith("/api/task/input/")) {
        const taskId = decodeURIComponent(pathname.replace("/api/task/input/", "")).trim();
        const body = await parseJSONBody(req);
        const result = manager.sendInput(taskId, body);
        return sendJSON(res, result.error ? 400 : 200, result);
    }

    // 7. Kill task: POST /api/task/kill/:taskId
    if (req.method === "POST" && pathname.startsWith("/api/task/kill/")) {
        const taskId = decodeURIComponent(pathname.replace("/api/task/kill/", "")).trim();
        const result = manager.killTask(taskId);
        return sendJSON(res, result.error ? 404 : 200, result);
    }

    // 8. List tasks: GET /api/task/list
    if (req.method === "GET" && pathname === "/api/task/list") {
        return sendJSON(res, 200, manager.listTasks());
    }

    // 9. Clean finished: POST /api/task/clean
    if (req.method === "POST" && pathname === "/api/task/clean") {
        const count = manager.cleanFinished();
        return sendJSON(res, 200, { cleaned: count });
    }

    // 10. Code grep: POST /api/code/grep
    if (req.method === "POST" && pathname === "/api/code/grep") {
        try {
            const body = await parseJSONBody(req);
            const result = executeCodeGrep(body);
            return sendJSON(res, 200, result);
        } catch (err) {
            return sendJSON(res, 400, { error: err.message });
        }
    }

    // 11. Code execution: POST /api/code/run or POST /api/python/run (backward-compatible alias)
    if (req.method === "POST" && (pathname === "/api/code/run" || pathname === "/api/python/run")) {
        try {
            const body = await parseJSONBody(req);
            const result = executeNodeCode(body.code, body);
            return sendJSON(res, 200, result);
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    return sendJSON(res, 404, { error: `Not found: ${req.method} ${pathname}` });
});

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let port = DEFAULT_PORT;
    let host = DEFAULT_HOST;
    let socketPath = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--port" && args[i + 1]) {
            port = parseInt(args[++i], 10);
        } else if (arg.startsWith("--port=")) {
            port = parseInt(arg.split("=")[1], 10);
        } else if (arg === "--host" && args[i + 1]) {
            host = args[++i];
        } else if (arg.startsWith("--host=")) {
            host = arg.split("=")[1];
        } else if (arg === "--socket" && args[i + 1]) {
            socketPath = args[++i];
        } else if (arg.startsWith("--socket=")) {
            socketPath = arg.split("=")[1];
        }
    }

    if (process.env.TASK_PORT) {
        port = parseInt(process.env.TASK_PORT, 10);
    }
    if (process.env.TASK_HOST) {
        host = process.env.TASK_HOST;
    }
    if (process.env.TASK_SOCKET) {
        socketPath = process.env.TASK_SOCKET;
    }

    return { port, host, socketPath };
}

const { port, host, socketPath } = parseArgs();

if (socketPath && process.platform !== "win32") {
    try {
        if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }
    } catch (_) {}

    server.listen(socketPath, () => {
        try {
            fs.chmodSync(socketPath, 0o777);
        } catch (_) {}
        console.log(`[NODE DAEMON] Listening on Unix socket: ${socketPath} (PID: ${process.pid})`);
    });
} else {
    server.listen(port, host, () => {
        console.log(`[NODE DAEMON] Listening on http://${host}:${port} (PID: ${process.pid})`);
    });
}

function handleShutdown() {
    console.log(`[NODE DAEMON] Shutting down (PID: ${process.pid})...`);
    for (const [tid, task] of manager.tasks.entries()) {
        if (task.running) {
            manager.killTask(tid);
        }
    }
    if (socketPath && fs.existsSync(socketPath)) {
        try { fs.unlinkSync(socketPath); } catch (_) {}
    }
    process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
