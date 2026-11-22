const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const repoRoot = path.join(__dirname, "..");
const daemonScript = path.join(repoRoot, "daemon", "node", "server.js");

function requestJSON(port, method, reqPath, data) {
    return new Promise((resolve, reject) => {
        const body = data ? JSON.stringify(data) : "";
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: reqPath,
            method,
            headers: {
                "Content-Type": "application/json",
                ...(body ? { "Content-Length": Buffer.byteLength(body) } : {})
            },
            timeout: 5000
        }, res => {
            let resData = "";
            res.on("data", chunk => resData += chunk);
            res.on("end", () => {
                try {
                    const json = JSON.parse(resData || "{}");
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: resData });
                }
            });
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function runRetentionTests() {
    console.log("=== Testing Task Retention & Anti-Reaping Engine ===");
    const testPort = 5997;
    const daemonProc = spawn(process.execPath, [daemonScript, "--port", String(testPort), "--host", "127.0.0.1"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"]
    });

    await new Promise(r => setTimeout(r, 300));

    try {
        // 1. Run a background task that produces output
        console.log("1. Starting background task via /api/task/idle...");
        const idleRes = await requestJSON(testPort, "POST", "/api/task/idle", {
            command: "echo 'CRITICAL_OUTPUT_LINE_1'; echo 'CRITICAL_OUTPUT_LINE_2'"
        });
        assert.strictEqual(idleRes.status, 200);
        const taskId = idleRes.data.task_id;
        assert(taskId, "Task ID should be returned");

        // Wait for execution to finish
        await new Promise(r => setTimeout(r, 400));

        // 2. First read of task stdout
        console.log("2. Verifying first read of /api/task/stdout/:taskId...");
        const read1 = await requestJSON(testPort, "GET", `/api/task/stdout/${taskId}`);
        assert.strictEqual(read1.status, 200);
        assert.strictEqual(read1.data.running, false);
        assert.strictEqual(read1.data.exit_code, 0);
        assert(read1.data.stdout.includes("CRITICAL_OUTPUT_LINE_1"), "Stdout must include line 1");
        assert(read1.data.stdout.includes("CRITICAL_OUTPUT_LINE_2"), "Stdout must include line 2");

        // 3. Second read of task stdout (testing non-destructive read)
        console.log("3. Verifying second (repeat) read of /api/task/stdout/:taskId retains output...");
        const read2 = await requestJSON(testPort, "GET", `/api/task/stdout/${taskId}`);
        assert.strictEqual(read2.status, 200);
        assert.strictEqual(read2.data.running, false);
        assert(read2.data.stdout.includes("CRITICAL_OUTPUT_LINE_1"), "Second read must still retain accumulated output");
        assert(read2.data.stdout.includes("CRITICAL_OUTPUT_LINE_2"), "Second read must still retain accumulated output");

        // 4. Verify listTasks does not reap tasks
        console.log("4. Verifying /api/task/list retains finished tasks...");
        const listRes = await requestJSON(testPort, "GET", "/api/task/list");
        assert.strictEqual(listRes.status, 200);
        assert(listRes.data[taskId], `Task ${taskId} must be present in task list`);
        assert.strictEqual(listRes.data[taskId].running, false);

        // 5. Verify disk persistence record exists
        console.log("5. Verifying persistent disk record in ~/.MultiAI/tasks/...");
        const diskDir = path.join(process.env.HOME || "/home/shado", ".MultiAI", "tasks");
        const diskFile = path.join(diskDir, `${taskId}.json`);
        assert(fs.existsSync(diskFile), `Disk record file ${diskFile} must exist`);
        const rec = JSON.parse(fs.readFileSync(diskFile, "utf8"));
        assert.strictEqual(rec.id, taskId);
        assert(rec.stdout.includes("CRITICAL_OUTPUT_LINE_1"));

        // 6. Test synchronous /api/task/run retention
        console.log("6. Verifying /api/task/run task is retained after exit...");
        const syncRunRes = await requestJSON(testPort, "POST", "/api/task/run", {
            command: "echo 'SYNCHRONOUS_RUN_OUTPUT'",
            timer: 5
        });
        assert.strictEqual(syncRunRes.status, 200);
        const syncTaskId = syncRunRes.data.task_id;
        assert(syncTaskId);

        // Ensure sync task can be queried via /api/task/stdout/:taskId
        const syncRead = await requestJSON(testPort, "GET", `/api/task/stdout/${syncTaskId}`);
        assert.strictEqual(syncRead.status, 200);
        assert(syncRead.data.stdout.includes("SYNCHRONOUS_RUN_OUTPUT"));

        // 7. Verify badge UI configuration for manage_tasks inspection
        console.log("7. Verifying chat-tool-badges manage_tasks config...");
        const { getToolBadgeConfig } = await import("../UI/webui/src/components/chat-tool-badges.js");
        const badgeConfig = getToolBadgeConfig("manage_tasks", { action: "stdout", task_id: "t_test_sample" });
        assert.strictEqual(badgeConfig.label, "Checked task");
        assert.strictEqual(badgeConfig.runningLabel, "Checking task");
        assert.strictEqual(badgeConfig.detail, "t_test_sample");
        assert.strictEqual(badgeConfig.icon, "file-text");

        // 8. Verify PTY execution terminates cleanly and does not hang
        console.log("8. Verifying PTY task execution completes cleanly without hanging...");
        const ptyStreamRes = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: "127.0.0.1",
                port: testPort,
                path: "/api/task/stream",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                timeout: 5000
            }, res => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => resolve(data));
            });
            req.on("error", reject);
            req.write(JSON.stringify({
                command: "echo 'PTY_TEST_OUTPUT'",
                pty: true,
                timer: 5
            }));
            req.end();
        });
        assert(ptyStreamRes.includes("PTY_TEST_OUTPUT"), "PTY output should be in stream");
        assert(ptyStreamRes.includes('"type":"done"'), "PTY stream must send done event and close");

        console.log("\n All Task Retention & Anti-Reaping tests passed successfully!");
    } finally {
        daemonProc.kill("SIGTERM");
    }
}

runRetentionTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
