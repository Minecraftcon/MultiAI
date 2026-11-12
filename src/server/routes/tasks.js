const fs = require("fs");
const path = require("path");
const { sendJSON } = require("../utils");
const conversationsManager = require("../../core/conversations_manager");
const { imageGenTasks } = require("./media");
const { taskManager } = require("../task_manager");
const { executePythonCode } = require("../task_tools");

async function handleTaskRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

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

    // Direct Python Execution Engine route: /api/python/run
    if (req.method === "POST" && req.url === "/api/python/run") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const result = await executePythonCode(args);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    // Native Node.js Task Execution and Management Routes
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

        const startTime = Date.now();
        let json = null;
        let extractedTaskId = "";

        if (reqUrl.startsWith("/api/task/stdout/")) {
            extractedTaskId = decodeURIComponent(reqUrl.replace("/api/task/stdout/", "")).trim();
            json = taskManager.getOutput(extractedTaskId);
        } else if (reqUrl.startsWith("/api/task/status/")) {
            extractedTaskId = decodeURIComponent(reqUrl.replace("/api/task/status/", "")).trim();
            const out = taskManager.getOutput(extractedTaskId);
            if (out.error) {
                json = out;
            } else {
                json = {
                    task_id: extractedTaskId,
                    running: out.running,
                    status: out.running ? "running" : "finished",
                    exit_code: out.exit_code
                };
            }
        } else if (reqUrl.startsWith("/api/task/input/")) {
            extractedTaskId = decodeURIComponent(reqUrl.replace("/api/task/input/", "")).trim();
            const inputString = parsedBody.field !== undefined ? parsedBody.field : (parsedBody.input_string !== undefined ? parsedBody.input_string : (parsedBody.input || ""));
            const inputType = parsedBody.type || (parsedBody.combination ? "keycode" : "text");
            const combination = parsedBody.combination || "";
            const pressEnter = parsedBody.press_enter !== undefined ? parsedBody.press_enter : true;

            json = taskManager.sendInput(extractedTaskId, {
                inputString,
                inputType,
                combination,
                pressEnter
            });
        } else if (reqUrl.startsWith("/api/task/kill/")) {
            extractedTaskId = decodeURIComponent(reqUrl.replace("/api/task/kill/", "")).trim();
            json = taskManager.killTask(extractedTaskId);
        } else if (reqUrl === "/api/task/list") {
            json = taskManager.listTasks();
            return sendJSON(res, 200, json);
        } else if (reqUrl === "/api/task/clean") {
            const cleaned = taskManager.cleanFinished();
            return sendJSON(res, 200, { cleaned });
        } else if (reqUrl === "/api/task/run" && req.method === "POST") {
            const command = parsedBody.command;
            if (!command) {
                return sendJSON(res, 400, { error: "No command provided" });
            }
            const timerVal = parsedBody.timer !== undefined ? parsedBody.timer : parsedBody.timeout;
            const timeoutSecs = Number(timerVal !== undefined ? timerVal : (parsedBody.wait_ms ? Number(parsedBody.wait_ms) / 1000 : 5.0));
            const shellOverride = parsedBody.shell;
            const cwd = parsedBody.cwd;

            const taskId = taskManager.runTask({
                command,
                shellOverride,
                scratchDir,
                artifactsDir,
                cwd
            });

            json = await taskManager.waitForTask(taskId, timeoutSecs);
        } else if (reqUrl === "/api/task/idle" && req.method === "POST") {
            const seconds = parsedBody.seconds !== undefined ? parsedBody.seconds : 5;
            const taskId = parsedBody.task_id;
            const wakeOn = parsedBody.wake_on || "exit";
            const reason = parsedBody.reason || "";

            json = await taskManager.idle({
                seconds,
                taskId,
                wakeOn,
                reason
            });
            return sendJSON(res, 200, json);
        } else {
            return sendJSON(res, 404, { error: "Task endpoint not found" });
        }

        if (json && typeof json === "object") {
            if (json.error && !json.status) {
                return sendJSON(res, 404, json);
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            json.ran_for = json.elapsed_seconds ? String(json.elapsed_seconds) : elapsed;

            const taskId = json.task_id || extractedTaskId || parsedBody.task_id || parsedBody.id || "";

            // Locate or name log file
            let logFileName = "";
            if (taskId && fs.existsSync(scratchDir)) {
                try {
                    const existing = fs.readdirSync(scratchDir).find(f => f.endsWith(`-${taskId}.log`));
                    if (existing) logFileName = existing;
                } catch (_) {}
            }
            if (!logFileName) {
                const taskName = parsedBody.task_name || parsedBody.name || "";
                const cleanName = taskName 
                    ? taskName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 30) 
                    : "task";
                logFileName = `${cleanName}-${taskId || Date.now().toString(36)}.log`;
            }
            const logFilePath = path.join(scratchDir, logFileName);
            const logRelPath = `scratch/${logFileName}`;

            // If reading via manage_tasks /api/task/stdout/:taskId and queue was empty, read historical log
            if (reqUrl.startsWith("/api/task/stdout/") && (!json.stdout || !json.stdout.trim()) && fs.existsSync(logFilePath)) {
                try {
                    const diskLog = fs.readFileSync(logFilePath, "utf8");
                    if (diskLog.trim()) {
                        json.stdout = diskLog;
                    }
                } catch (_) {}
            }

            const combinedOutput = (json.stdout || "") + (json.stderr ? "\n" + json.stderr : "");
            if (combinedOutput && combinedOutput.trim()) {
                try {
                    if (reqUrl.startsWith("/api/task/stdout/") && fs.existsSync(logFilePath)) {
                        // Already in log or read from log
                    } else if (fs.existsSync(logFilePath)) {
                        fs.appendFileSync(logFilePath, combinedOutput, "utf8");
                    } else {
                        fs.writeFileSync(logFilePath, combinedOutput, "utf8");
                    }
                } catch (err) {
                    console.warn("[TASK LOG SAVE ERROR]", err.message);
                }
            }

            json.scratch_log_path = logRelPath;

            // Enforce maximum 150 lines per turn on stdout
            const MAX_LINES = 150;
            if (json.stdout && typeof json.stdout === "string") {
                const stdoutLines = json.stdout.split("\n");
                if (stdoutLines.length > MAX_LINES) {
                    const kept = stdoutLines.slice(-MAX_LINES).join("\n");
                    json.stdout = `[Output truncated ... showing last ${MAX_LINES} lines]\n${kept}`;
                    json.is_large_output = true;
                    json.truncated_lines = kept;
                }
            }

            // Enforce maximum 150 lines per turn on stderr
            if (json.stderr && typeof json.stderr === "string") {
                const stderrLines = json.stderr.split("\n");
                if (stderrLines.length > MAX_LINES) {
                    const kept = stderrLines.slice(-MAX_LINES).join("\n");
                    json.stderr = `[Output truncated ... showing last ${MAX_LINES} lines]\n${kept}`;
                    json.is_large_output = true;
                }
            }

            return sendJSON(res, 200, json);
        }

        return sendJSON(res, 404, { error: "Endpoint not found" });
    }
}

module.exports = {
    handleTaskRoute
};
