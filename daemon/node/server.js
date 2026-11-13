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

let ptyModule = null;
try {
    ptyModule = require("node-pty");
} catch (e) {
    console.warn("[NODE DAEMON] node-pty not available, using fallback:", e.message);
}

class PtyManager {
    constructor() {
        this.ptys = new Map();
        this.counter = 0;
    }

    generateId() {
        this.counter++;
        return `pty_${Date.now().toString(36)}_${this.counter}`;
    }

    spawnPty(options = {}) {
        const ptyId = this.generateId();
        const {
            command = "",
            shell: shellOverride = null,
            cwd = null,
            cols = 80,
            rows = 24,
            scratchDir = null,
            artifactsDir = null,
            env: customEnv = {}
        } = options;

        const targetCwd = cwd || scratchDir || process.cwd();
        const isWin = process.platform === "win32";
        const defaultShell = isWin ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "/bin/bash");
        const shell = shellOverride || defaultShell;

        const mergedEnv = {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            ...(scratchDir ? { SCRATCH: scratchDir, SCRATCH_DIR: scratchDir } : {}),
            ...(artifactsDir ? { ARTIFACTS: artifactsDir, ARTIFACTS_DIR: artifactsDir } : {}),
            ...customEnv
        };

        const targetCols = Math.max(10, Math.min(500, parseInt(cols, 10) || 80));
        const targetRows = Math.max(3, Math.min(200, parseInt(rows, 10) || 24));

        let ptyProc = null;
        let isNative = false;

        let args = [];
        if (command) {
            args = isWin ? ["/c", command] : ["-c", command];
        }

        if (ptyModule) {
            try {
                ptyProc = ptyModule.spawn(shell, args, {
                    name: "xterm-256color",
                    cols: targetCols,
                    rows: targetRows,
                    cwd: targetCwd,
                    env: mergedEnv
                });
                isNative = true;
            } catch (err) {
                console.warn(`[PTY] node-pty spawn failed: ${err.message}, falling back`);
            }
        }

        if (!ptyProc) {
            if (!isWin && fs.existsSync("/usr/bin/script")) {
                const fullCmd = command ? `${shell} -c ${JSON.stringify(command)}` : shell;
                ptyProc = spawn("/usr/bin/script", ["-qec", fullCmd, "/dev/null"], {
                    cwd: targetCwd,
                    env: mergedEnv,
                    stdio: ["pipe", "pipe", "pipe"]
                });
            } else {
                ptyProc = spawn(shell, args, {
                    cwd: targetCwd,
                    env: mergedEnv,
                    stdio: ["pipe", "pipe", "pipe"]
                });
            }
        }

        const session = {
            id: ptyId,
            proc: ptyProc,
            pid: ptyProc.pid,
            isNative,
            shell,
            command: command || shell,
            cwd: targetCwd,
            cols: targetCols,
            rows: targetRows,
            startTime: Date.now(),
            running: true,
            exitCode: null,
            ringBuffer: [],
            ringBufferSize: 0,
            maxRingBufferSize: 256 * 1024,
            listeners: new Set()
        };

        const pushData = (chunk) => {
            const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            session.ringBuffer.push(str);
            session.ringBufferSize += str.length;
            while (session.ringBufferSize > session.maxRingBufferSize && session.ringBuffer.length > 1) {
                const popped = session.ringBuffer.shift();
                session.ringBufferSize -= popped.length;
            }
            for (const l of session.listeners) {
                try { l({ type: "data", data: str }); } catch (_) {}
            }
        };

        if (isNative) {
            ptyProc.onData(data => {
                pushData(data);
            });
            ptyProc.onExit(e => {
                session.running = false;
                session.exitCode = e.exitCode !== undefined ? e.exitCode : 0;
                for (const l of session.listeners) {
                    try { l({ type: "exit", exitCode: session.exitCode }); } catch (_) {}
                }
            });
        } else {
            if (ptyProc.stdout) ptyProc.stdout.on("data", chunk => pushData(chunk));
            if (ptyProc.stderr) ptyProc.stderr.on("data", chunk => pushData(chunk));
            ptyProc.on("close", (code, signal) => {
                session.running = false;
                session.exitCode = code !== null ? code : (signal ? 128 : 0);
                for (const l of session.listeners) {
                    try { l({ type: "exit", exitCode: session.exitCode }); } catch (_) {}
                }
            });
            ptyProc.on("error", err => {
                session.running = false;
                session.exitCode = 1;
                pushData(`\n[PTY error: ${err.message}]\n`);
                for (const l of session.listeners) {
                    try { l({ type: "exit", exitCode: 1 }); } catch (_) {}
                }
            });
        }

        this.ptys.set(ptyId, session);
        return session;
    }

    writeInput(ptyId, input) {
        const session = this.ptys.get(ptyId);
        if (!session) return { error: `PTY session ${ptyId} not found` };
        if (!session.running) return { error: `PTY session ${ptyId} is not running` };

        try {
            if (session.isNative) {
                session.proc.write(input);
            } else if (session.proc.stdin && !session.proc.stdin.destroyed) {
                session.proc.stdin.write(input);
            }
            return { status: "ok", pty_id: ptyId };
        } catch (err) {
            return { error: `Failed to write to PTY: ${err.message}` };
        }
    }

    resize(ptyId, cols, rows) {
        const session = this.ptys.get(ptyId);
        if (!session) return { error: `PTY session ${ptyId} not found` };
        session.cols = Math.max(10, Math.min(500, parseInt(cols, 10) || 80));
        session.rows = Math.max(3, Math.min(200, parseInt(rows, 10) || 24));

        if (session.running && session.isNative && typeof session.proc.resize === "function") {
            try {
                session.proc.resize(session.cols, session.rows);
                return { status: "ok", cols: session.cols, rows: session.rows };
            } catch (err) {
                return { error: `Resize failed: ${err.message}` };
            }
        }
        return { status: "ok", cols: session.cols, rows: session.rows, note: "non-native pty" };
    }

    kill(ptyId, signal = "SIGTERM") {
        const session = this.ptys.get(ptyId);
        if (!session) return { error: `PTY session ${ptyId} not found` };
        if (session.running && session.proc) {
            try {
                session.proc.kill(signal);
            } catch (_) {}
            session.running = false;
        }
        return { status: "killed", pty_id: ptyId };
    }

    getHistory(ptyId) {
        const session = this.ptys.get(ptyId);
        if (!session) return "";
        return session.ringBuffer.join("");
    }

    listPtys() {
        const list = [];
        for (const [id, s] of this.ptys.entries()) {
            list.push({
                pty_id: id,
                pid: s.pid,
                running: s.running,
                exit_code: s.exitCode,
                shell: s.shell,
                command: s.command,
                cwd: s.cwd,
                cols: s.cols,
                rows: s.rows,
                is_native: s.isNative,
                uptime_seconds: Math.floor((Date.now() - s.startTime) / 1000)
            });
        }
        return list;
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

// Global Manager Instances
const manager = new TaskManager();
const ptyManager = new PtyManager();

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

        // Real PTY execution mode for run_task if requested
        if (body.pty) {
            const ptySession = ptyManager.spawnPty({
                command,
                cwd: body.cwd,
                scratchDir: body.scratch_dir,
                artifactsDir: body.artifacts_dir,
                shell: body.shell,
                cols: body.cols || 100,
                rows: body.rows || 30
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

            writeSSE({ type: "start", task_id: ptySession.id, pty: true });

            let accStdout = "";
            const listener = (event) => {
                if (event.type === "data") {
                    accStdout += event.data;
                    writeSSE({ type: "chunk", stdout: event.data, stderr: "" });
                } else if (event.type === "exit") {
                    const elapsed = ((Date.now() - ptySession.startTime) / 1000).toFixed(2);
                    writeSSE({
                        type: "done",
                        task_id: ptySession.id,
                        done: true,
                        status: `exited (code: ${event.exitCode})`,
                        running: false,
                        exit_code: event.exitCode,
                        stdout: accStdout,
                        stderr: "",
                        ran_for: elapsed,
                        pty: true
                    });
                    ptySession.listeners.delete(listener);
                    res.end();
                }
            };

            ptySession.listeners.add(listener);
            req.on("close", () => {
                ptySession.listeners.delete(listener);
            });
            return;
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

    // ==========================================
    // PTY TERMINAL SUBSYSTEM ROUTES
    // ==========================================

    // 12. PTY Spawn: POST /api/pty/spawn
    if (req.method === "POST" && pathname === "/api/pty/spawn") {
        try {
            const body = await parseJSONBody(req);
            const session = ptyManager.spawnPty(body);
            return sendJSON(res, 200, {
                pty_id: session.id,
                pid: session.pid,
                shell: session.shell,
                command: session.command,
                cwd: session.cwd,
                cols: session.cols,
                rows: session.rows,
                is_native: session.isNative,
                status: "running"
            });
        } catch (err) {
            return sendJSON(res, 500, { error: `Failed to spawn PTY: ${err.message}` });
        }
    }

    // 13. PTY Stream: GET /api/pty/stream/:ptyId
    if (req.method === "GET" && pathname.startsWith("/api/pty/stream/")) {
        const ptyId = decodeURIComponent(pathname.replace("/api/pty/stream/", "")).trim();
        const session = ptyManager.ptys.get(ptyId);
        if (!session) {
            return sendJSON(res, 404, { error: `PTY session '${ptyId}' not found` });
        }

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

        // Send initialization state and existing scrollback history
        writeSSE({
            type: "init",
            pty_id: session.id,
            pid: session.pid,
            cols: session.cols,
            rows: session.rows,
            cwd: session.cwd,
            shell: session.shell,
            is_native: session.isNative,
            running: session.running,
            exit_code: session.exitCode,
            history: ptyManager.getHistory(session.id)
        });

        if (!session.running) {
            writeSSE({ type: "exit", exit_code: session.exitCode });
            return res.end();
        }

        const listener = (event) => {
            if (event.type === "data") {
                writeSSE({ type: "data", data: event.data });
            } else if (event.type === "exit") {
                writeSSE({ type: "exit", exit_code: event.exitCode });
                session.listeners.delete(listener);
                res.end();
            }
        };

        session.listeners.add(listener);
        req.on("close", () => {
            session.listeners.delete(listener);
        });
        return;
    }

    // 14. PTY Input: POST /api/pty/input/:ptyId
    if (req.method === "POST" && pathname.startsWith("/api/pty/input/")) {
        const ptyId = decodeURIComponent(pathname.replace("/api/pty/input/", "")).trim();
        try {
            const body = await parseJSONBody(req);
            const inputData = body.input !== undefined ? body.input : (body.data !== undefined ? body.data : "");
            const result = ptyManager.writeInput(ptyId, inputData);
            return sendJSON(res, result.error ? 400 : 200, result);
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    // 15. PTY Resize: POST /api/pty/resize/:ptyId
    if (req.method === "POST" && pathname.startsWith("/api/pty/resize/")) {
        const ptyId = decodeURIComponent(pathname.replace("/api/pty/resize/", "")).trim();
        try {
            const body = await parseJSONBody(req);
            const result = ptyManager.resize(ptyId, body.cols, body.rows);
            return sendJSON(res, result.error ? 400 : 200, result);
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    // 16. PTY Kill: POST /api/pty/kill/:ptyId
    if (req.method === "POST" && pathname.startsWith("/api/pty/kill/")) {
        const ptyId = decodeURIComponent(pathname.replace("/api/pty/kill/", "")).trim();
        const result = ptyManager.kill(ptyId);
        return sendJSON(res, result.error ? 404 : 200, result);
    }

    // 17. PTY List: GET /api/pty/list
    if (req.method === "GET" && pathname === "/api/pty/list") {
        return sendJSON(res, 200, ptyManager.listPtys());
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
    for (const [pid, pty] of ptyManager.ptys.entries()) {
        if (pty.running) {
            ptyManager.kill(pid);
        }
    }
    if (socketPath && fs.existsSync(socketPath)) {
        try { fs.unlinkSync(socketPath); } catch (_) {}
    }
    process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
