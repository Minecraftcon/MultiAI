const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
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

async function runTests() {
    console.log("=== Testing Pure Node.js Task Daemon ===");
    const testPort = 5998;
    const daemonProc = spawn(process.execPath, [daemonScript, "--port", String(testPort), "--host", "127.0.0.1"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"]
    });

    daemonProc.stdout.on("data", d => process.stdout.write(`[DAEMON OUT] ${d}`));
    daemonProc.stderr.on("data", d => process.stderr.write(`[DAEMON ERR] ${d}`));

    // Wait 250ms for startup
    await new Promise(r => setTimeout(r, 250));

    try {
        // 1. Health check
        console.log("1. Testing GET /health...");
        const health = await requestJSON(testPort, "GET", "/health");
        console.log("Health response:", health.data);
        assert.strictEqual(health.status, 200);
        assert.strictEqual(health.data.status, "ok");
        assert.strictEqual(health.data.engine, "node");

        // 2. Run task
        console.log("2. Testing POST /api/task/run...");
        const runRes = await requestJSON(testPort, "POST", "/api/task/run", {
            command: "echo 'hello from pure node task daemon'",
            timer: 5
        });
        console.log("Run response:", runRes.data);
        assert.strictEqual(runRes.status, 200);
        assert(runRes.data.task_id);
        assert(runRes.data.stdout.includes("hello from pure node task daemon"));
        assert.strictEqual(runRes.data.running, false);
        assert.strictEqual(runRes.data.exit_code, 0);

        // 3. Code grep
        console.log("3. Testing POST /api/code/grep...");
        const grepRes = await requestJSON(testPort, "POST", "/api/code/grep", {
            query: "MultiAI",
            path: ".",
            max_results: 5
        });
        console.log("Grep matches count:", grepRes.data.matches?.length);
        assert.strictEqual(grepRes.status, 200);
        assert(grepRes.data.matches.length > 0);
        assert.strictEqual(grepRes.data.engine_used, "node_fast_scan");

        // 4. Code execution
        console.log("4. Testing POST /api/code/run...");
        const codeRes = await requestJSON(testPort, "POST", "/api/code/run", {
            code: "console.log('computed in node'); 21 * 2;"
        });
        console.log("Code run response:", codeRes.data);
        assert.strictEqual(codeRes.status, 200);
        assert.strictEqual(codeRes.data.success, true);
        assert.strictEqual(codeRes.data.return_value, 42);
        assert(codeRes.data.stdout.includes("computed in node"));

        // 5. Idle task and stdout
        console.log("5. Testing POST /api/task/idle and GET /api/task/stdout/:taskId...");
        const idleRes = await requestJSON(testPort, "POST", "/api/task/idle", {
            command: "echo 'background task test'"
        });
        assert.strictEqual(idleRes.status, 200);
        const taskId = idleRes.data.task_id;
        assert(taskId);

        // Allow 200ms to finish
        await new Promise(r => setTimeout(r, 200));
        const outRes = await requestJSON(testPort, "GET", `/api/task/stdout/${taskId}`);
        console.log("Output response:", outRes.data);
        assert.strictEqual(outRes.status, 200);
        assert(outRes.data.stdout.includes("background task test"));

        // 6. Kill task
        console.log("6. Testing POST /api/task/kill/:taskId...");
        const killRes = await requestJSON(testPort, "POST", `/api/task/kill/${taskId}`);
        console.log("Kill response:", killRes.data);
        assert.strictEqual(killRes.status, 200);

        // 7. List and clean
        console.log("7. Testing GET /api/task/list and POST /api/task/clean...");
        const listRes = await requestJSON(testPort, "GET", "/api/task/list");
        assert.strictEqual(listRes.status, 200);
        assert(Object.keys(listRes.data).includes(taskId));

        const cleanRes = await requestJSON(testPort, "POST", "/api/task/clean");
        assert.strictEqual(cleanRes.status, 200);
        assert.strictEqual(cleanRes.data.cleaned >= 1, true);

        console.log("\nAll Node Task Daemon tests passed successfully!");
    } finally {
        daemonProc.kill("SIGTERM");
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
