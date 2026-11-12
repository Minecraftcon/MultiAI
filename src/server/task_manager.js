/**
 * Node.js Native TaskManager
 * ==========================
 * Replaces Python task_server backends with zero-dependency Node.js child_process.
 * Supports cross-platform shell execution, input sending (text & keycode combinations),
 * process tree signal routing, output queuing, and idle waiting.
 */

const { spawn, execSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const KEY_MAP = {
    "ctrl+c": { bytes: Buffer.from("\x03"), sigint: true, sigtstp: false, sigquit: false },
    "ctrl-c": { bytes: Buffer.from("\x03"), sigint: true, sigtstp: false, sigquit: false },
    "ctrl+d": { bytes: Buffer.from("\x04"), sigint: false, sigtstp: false, sigquit: false },
    "ctrl-d": { bytes: Buffer.from("\x04"), sigint: false, sigtstp: false, sigquit: false },
    "ctrl+z": { bytes: Buffer.from("\x1a"), sigint: false, sigtstp: true, sigquit: false },
    "ctrl-z": { bytes: Buffer.from("\x1a"), sigint: false, sigtstp: true, sigquit: false },
    "ctrl+\\": { bytes: Buffer.from("\x1c"), sigint: false, sigtstp: false, sigquit: true },
    "ctrl-\\": { bytes: Buffer.from("\x1c"), sigint: false, sigtstp: false, sigquit: true },
    "enter": { bytes: Buffer.from("\n"), sigint: false, sigtstp: false, sigquit: false },
    "return": { bytes: Buffer.from("\n"), sigint: false, sigtstp: false, sigquit: false },
    "\n": { bytes: Buffer.from("\n"), sigint: false, sigtstp: false, sigquit: false },
    "tab": { bytes: Buffer.from("\t"), sigint: false, sigtstp: false, sigquit: false },
    "\t": { bytes: Buffer.from("\t"), sigint: false, sigtstp: false, sigquit: false },
    "space": { bytes: Buffer.from(" "), sigint: false, sigtstp: false, sigquit: false },
    "esc": { bytes: Buffer.from("\x1b"), sigint: false, sigtstp: false, sigquit: false },
    "escape": { bytes: Buffer.from("\x1b"), sigint: false, sigtstp: false, sigquit: false },
    "backspace": { bytes: Buffer.from("\x7f"), sigint: false, sigtstp: false, sigquit: false },
    "bs": { bytes: Buffer.from("\x7f"), sigint: false, sigtstp: false, sigquit: false },
    "delete": { bytes: Buffer.from("\x1b[3~"), sigint: false, sigtstp: false, sigquit: false },
    "del": { bytes: Buffer.from("\x1b[3~"), sigint: false, sigtstp: false, sigquit: false },
    "up": { bytes: Buffer.from("\x1b[A"), sigint: false, sigtstp: false, sigquit: false },
    "arrowup": { bytes: Buffer.from("\x1b[A"), sigint: false, sigtstp: false, sigquit: false },
    "down": { bytes: Buffer.from("\x1b[B"), sigint: false, sigtstp: false, sigquit: false },
    "arrowdown": { bytes: Buffer.from("\x1b[B"), sigint: false, sigtstp: false, sigquit: false },
    "right": { bytes: Buffer.from("\x1b[C"), sigint: false, sigtstp: false, sigquit: false },
    "arrowright": { bytes: Buffer.from("\x1b[C"), sigint: false, sigtstp: false, sigquit: false },
    "left": { bytes: Buffer.from("\x1b[D"), sigint: false, sigtstp: false, sigquit: false },
    "arrowleft": { bytes: Buffer.from("\x1b[D"), sigint: false, sigtstp: false, sigquit: false },
    "home": { bytes: Buffer.from("\x1b[H"), sigint: false, sigtstp: false, sigquit: false },
    "end": { bytes: Buffer.from("\x1b[F"), sigint: false, sigtstp: false, sigquit: false },
    "pageup": { bytes: Buffer.from("\x1b[5~"), sigint: false, sigtstp: false, sigquit: false },
    "pgup": { bytes: Buffer.from("\x1b[5~"), sigint: false, sigtstp: false, sigquit: false },
    "pagedown": { bytes: Buffer.from("\x1b[6~"), sigint: false, sigtstp: false, sigquit: false },
    "pgdn": { bytes: Buffer.from("\x1b[6~"), sigint: false, sigtstp: false, sigquit: false }
};

class TaskManager {
    constructor() {
        this.tasks = new Map();
    }

    _resolveCombination(combo) {
        const c = (combo || "").trim().toLowerCase().replace(/control/g, "ctrl").replace(/\s+/g, "");
        if (KEY_MAP[c]) {
            return KEY_MAP[c];
        }

        // Dynamic Ctrl+<letter> (ctrl+a through ctrl+z)
        if ((c.startsWith("ctrl+") || c.startsWith("ctrl-")) && c.length === 6) {
            const ch = c[5];
            if (ch >= "a" && ch <= "z") {
                const code = Buffer.from([ch.charCodeAt(0) - "a".charCodeAt(0) + 1]);
                return {
                    bytes: code,
                    sigint: ch === "c",
                    sigtstp: ch === "z",
                    sigquit: false
                };
            }
        }

        // Dynamic Alt+<letter>
        if ((c.startsWith("alt+") || c.startsWith("alt-")) && c.length === 5) {
            const ch = c[4];
            return {
                bytes: Buffer.concat([Buffer.from("\x1b"), Buffer.from(ch, "utf-8")]),
                sigint: false,
                sigtstp: false,
                sigquit: false
            };
        }

        return {
            bytes: Buffer.from(combo, "utf-8"),
            sigint: false,
            sigtstp: false,
            sigquit: false
        };
    }

    runTask({ command, shellOverride, scratchDir, artifactsDir, cwd }) {
        const taskId = crypto.randomBytes(4).toString("hex");

        const env = { ...process.env };
        env.TERM = "xterm-256color";
        if (scratchDir) {
            env.SCRATCH = scratchDir;
            env.SCRATCH_DIR = scratchDir;
        }
        if (artifactsDir) {
            env.ARTIFACTS = artifactsDir;
            env.ARTIFACTS_DIR = artifactsDir;
        }

        // Automatic Git Pre-Authentication
        if (process.env.GITHUB_TOKEN) {
            env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
            env.GH_TOKEN = process.env.GITHUB_TOKEN;
            // Configure git to automatically authenticate with GitHub over HTTPS without prompt
            const ghToken = process.env.GITHUB_TOKEN;
            const ghUser = process.env.GITHUB_USERNAME || "Minecraftcon";
            env.GIT_ASKPASS = "";
            env.GIT_CONFIG_COUNT = "1";
            env.GIT_CONFIG_KEY_0 = "url.https://" + ghUser + ":" + ghToken + "@github.com/.insteadOf";
            env.GIT_CONFIG_VALUE_0 = "https://github.com/";
        }

        let targetCwd = cwd || process.env.MULTIAI_WORKSPACE_DIR || process.cwd();
        if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) {
            targetCwd = process.cwd();
        }

        const isWin = process.platform === "win32";
        let child;

        if (isWin) {
            const defaultShell = (process.env.TASK_SERVER_SHELL || "cmd").toLowerCase();
            const selectedShell = (shellOverride || defaultShell).toLowerCase();

            if (selectedShell === "powershell" || selectedShell === "pwsh") {
                const psBin = selectedShell === "pwsh" ? "pwsh" : "powershell";
                child = spawn(psBin, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
                    cwd: targetCwd,
                    env,
                    windowsHide: true,
                    stdio: ["pipe", "pipe", "pipe"]
                });
            } else {
                child = spawn(command, {
                    shell: true,
                    cwd: targetCwd,
                    env,
                    windowsHide: true,
                    stdio: ["pipe", "pipe", "pipe"]
                });
            }
        } else {
            // POSIX: Spawn with detached: true so child is group leader (setsid equivalent)
            const shellCmd = shellOverride || process.env.SHELL || "/bin/sh";
            child = spawn(shellCmd, ["-c", command], {
                cwd: targetCwd,
                env,
                detached: true,
                stdio: ["pipe", "pipe", "pipe"]
            });
        }

        const taskRecord = {
            process: child,
            command,
            startTime: Date.now(),
            queue: [], // Array of { stream: 'stdout'|'stderr', data: string }
            running: true,
            exitCode: null
        };

        if (child.stdout) {
            child.stdout.on("data", (data) => {
                taskRecord.queue.push({ stream: "stdout", data: data.toString("utf-8") });
            });
        }

        if (child.stderr) {
            child.stderr.on("data", (data) => {
                taskRecord.queue.push({ stream: "stderr", data: data.toString("utf-8") });
            });
        }

        child.on("close", (code) => {
            taskRecord.running = false;
            taskRecord.exitCode = code;
        });

        child.on("error", (err) => {
            taskRecord.running = false;
            taskRecord.queue.push({ stream: "stderr", data: `Process spawn error: ${err.message}\n` });
            taskRecord.exitCode = 1;
        });

        this.tasks.set(taskId, taskRecord);
        return taskId;
    }

    getOutput(taskId) {
        if (!this.tasks.has(taskId)) {
            return { error: `Task ${taskId} not found.` };
        }

        const task = this.tasks.get(taskId);
        const stdoutChunks = [];
        const stderrChunks = [];

        // Drain queue
        while (task.queue.length > 0) {
            const item = task.queue.shift();
            if (item.stream === "stdout") {
                stdoutChunks.push(item.data);
            } else {
                stderrChunks.push(item.data);
            }
        }

        return {
            task_id: taskId,
            running: task.running,
            exit_code: task.running ? null : task.exitCode,
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join("")
        };
    }

    listTasks() {
        const result = {};
        for (const [tid, task] of this.tasks.entries()) {
            result[tid] = {
                running: task.running,
                exit_code: task.running ? null : task.exitCode,
                command: task.command,
                start_time: task.startTime / 1000
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

    sendInput(taskId, { inputString = "", inputType = "text", combination = "", pressEnter = true } = {}) {
        if (!this.tasks.has(taskId)) {
            return { error: `Task ${taskId} not found.` };
        }

        const task = this.tasks.get(taskId);
        if (!task.running) {
            const out = this.getOutput(taskId);
            const code = task.exitCode;
            const stdOut = out.stdout || "";
            const stdErr = out.stderr || "";
            let msg = `Task ${taskId} is no longer running (already exited with code ${code}).`;
            if (stdOut) msg += `\nstdout: ${stdOut.trim()}`;
            if (stdErr) msg += `\nstderr: ${stdErr.trim()}`;

            return {
                error: `Task ${taskId} is no longer running.`,
                status: `exited (code: ${code})`,
                running: false,
                exit_code: code,
                stdout: stdOut,
                stderr: stdErr,
                output: msg
            };
        }

        const type = (inputType || "text").toLowerCase().trim();
        const comboStr = combination || (type === "keycode" ? inputString : "");

        if (type === "keycode" || comboStr) {
            const { bytes, sigint, sigtstp, sigquit } = this._resolveCombination(comboStr);

            // Process group signal dispatch on POSIX
            if (process.platform !== "win32" && task.process.pid) {
                try {
                    if (sigint) process.kill(-task.process.pid, "SIGINT");
                    else if (sigtstp) process.kill(-task.process.pid, "SIGTSTP");
                    else if (sigquit) process.kill(-task.process.pid, "SIGQUIT");
                } catch (_) {}
            }

            // Write keycode bytes into stdin
            if (bytes && bytes.length > 0 && task.process.stdin && !task.process.stdin.destroyed) {
                try {
                    task.process.stdin.write(bytes);
                } catch (_) {}
            }
        } else {
            // Text mode
            try {
                let val = inputString !== undefined && inputString !== null ? String(inputString) : "";
                if (pressEnter && !val.endsWith("\n")) {
                    val += "\n";
                }
                if (task.process.stdin && !task.process.stdin.destroyed) {
                    task.process.stdin.write(val);
                }
            } catch (e) {
                return { error: `Failed to send input: ${e.message}` };
            }
        }

        // Give process a small tick to process input
        const out = this.getOutput(taskId);
        const isRunning = task.running;
        const statusText = isRunning ? "running" : `exited (code: ${task.exitCode})`;
        const inputDesc = (type === "keycode" || comboStr) ? comboStr : inputString;
        const stdErr = out.stderr || "";
        const stdOut = out.stdout || "";

        let formattedOutput = `input: (${inputDesc}), sent successfully\nStatus: ${statusText}\nstderr: ${stdErr}`;
        if (stdOut) {
            formattedOutput += `\nstdout: ${stdOut}`;
        }

        return {
            task_id: taskId,
            status: statusText,
            running: isRunning,
            exit_code: isRunning ? null : task.exitCode,
            input: inputDesc,
            type: (type === "keycode" || comboStr) ? "keycode" : "text",
            stderr: stdErr,
            stdout: stdOut,
            output: formattedOutput
        };
    }

    killTask(taskId) {
        if (!this.tasks.has(taskId)) {
            return { error: `Task ${taskId} not found.` };
        }

        const task = this.tasks.get(taskId);
        if (task.running && task.process) {
            const isWin = process.platform === "win32";
            if (isWin) {
                try {
                    execSync(`taskkill /F /T /PID ${task.process.pid}`, { stdio: "ignore" });
                } catch (_) {
                    try { task.process.kill("SIGKILL"); } catch (_) {}
                }
            } else {
                try {
                    process.kill(-task.process.pid, "SIGKILL");
                } catch (_) {
                    try { task.process.kill("SIGKILL"); } catch (_) {}
                }
            }
            task.running = false;
            return { status: `Task ${taskId} terminated.` };
        }
        return { status: `Task ${taskId} was already finished.` };
    }

    async waitForTask(taskId, timeoutSecs = 1.0) {
        if (!this.tasks.has(taskId)) {
            return { error: `Task ${taskId} not found.` };
        }

        const cooldown = Math.max(0.05, Number(timeoutSecs) || 1.0);
        const endTime = Date.now() + cooldown * 1000;
        const task = this.tasks.get(taskId);

        while (Date.now() < endTime) {
            if (!task.running) {
                await new Promise(r => setTimeout(r, 20));
                break;
            }
            await new Promise(r => setTimeout(r, 30));
        }

        return this.getOutput(taskId);
    }

    async idle({ seconds = 5.0, taskId = null, wakeOn = "exit", reason = "" } = {}) {
        const sec = Math.max(0.1, Math.min(300.0, Number(seconds) || 5.0));
        const startTime = Date.now();
        const endTime = startTime + sec * 1000;

        if (taskId && this.tasks.has(taskId)) {
            const task = this.tasks.get(taskId);

            while (Date.now() < endTime) {
                if ((wakeOn === "exit" || wakeOn === "any") && !task.running) {
                    await new Promise(r => setTimeout(r, 20));
                    const output = this.getOutput(taskId);
                    output.status = "task_completed";
                    output.elapsed_seconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
                    output.reason = reason;
                    return output;
                }

                if ((wakeOn === "output" || wakeOn === "any") && task.queue.length > 0) {
                    await new Promise(r => setTimeout(r, 20));
                    const output = this.getOutput(taskId);
                    output.status = "task_output";
                    output.elapsed_seconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
                    output.reason = reason;
                    return output;
                }

                await new Promise(r => setTimeout(r, 40));
            }

            const output = this.getOutput(taskId);
            output.status = "timer_expired";
            output.elapsed_seconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
            output.reason = reason;
            return output;
        } else {
            await new Promise(r => setTimeout(r, sec * 1000));
            return {
                status: "timer_expired",
                elapsed_seconds: Number(((Date.now() - startTime) / 1000).toFixed(2)),
                reason
            };
        }
    }
}

// Global singleton instance
const taskManager = new TaskManager();

module.exports = {
    TaskManager,
    taskManager
};

