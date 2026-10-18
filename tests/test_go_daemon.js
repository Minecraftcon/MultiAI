const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const repoRoot = path.join(__dirname, "..");
const daemonBin = path.join(repoRoot, "bin/task_daemon");

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
    console.log("=== Testing Go Task Daemon ===");
    const testPort = 5999;
    const daemonProc = spawn(daemonBin, ["--port", String(testPort), "--host", "127.0.0.1"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"]
    });

    daemonProc.stdout.on("data", d => process.stdout.write(`[DAEMON OUT] ${d}`));
    daemonProc.stderr.on("data", d => process.stderr.write(`[DAEMON ERR] ${d}`));

    // Wait 300ms for startup
    await new Promise(r => setTimeout(r, 300));

    try {
        // 1. Health check
        console.log("1. Testing GET /health...");
        const health = await requestJSON(testPort, "GET", "/health");
        console.log("Health response:", health.data);
        assert.strictEqual(health.status, 200);
        assert.strictEqual(health.data.status, "ok");
        assert.strictEqual(health.data.engine, "go");

        // 2. Run task
        console.log("2. Testing POST /api/task/run...");
        const runRes = await requestJSON(testPort, "POST", "/api/task/run", {
            command: "echo 'hello from go task daemon'",
            timer: 2
        });
        console.log("Run response:", runRes.data);
        assert.strictEqual(runRes.status, 200);
        assert(runRes.data.task_id);
        assert(runRes.data.stdout.includes("hello from go task daemon"));
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

        // 4. Python execution
        console.log("4. Testing POST /api/python/run...");
        const pyRes = await requestJSON(testPort, "POST", "/api/python/run", {
            code: "a = 21\nb = 2\na * b"
        });
        console.log("Python result:", pyRes.data);
        assert.strictEqual(pyRes.status, 200);
        assert.strictEqual(pyRes.data.success, true);
        assert.strictEqual(String(pyRes.data.return_value), "42");

        console.log("✓ TCP TESTS PASSED! Now testing Unix Domain Socket...");
    } finally {
        daemonProc.kill("SIGKILL");
    }

    if (process.platform !== "win32") {
        const testSock = path.join(repoRoot, "scratch", "test_go_daemon.sock");
        if (require("fs").existsSync(testSock)) require("fs").unlinkSync(testSock);

        const sockProc = spawn(daemonBin, ["--socket", testSock], {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"]
        });

        sockProc.stdout.on("data", d => process.stdout.write(`[SOCK OUT] ${d}`));
        sockProc.stderr.on("data", d => process.stderr.write(`[SOCK ERR] ${d}`));

        await new Promise(r => setTimeout(r, 300));

        try {
            console.log("5. Testing Unix Socket GET /health...");
            const sockHealth = await new Promise((resolve, reject) => {
                const req = http.request({
                    socketPath: testSock,
                    path: "/health",
                    method: "GET"
                }, res => {
                    let d = "";
                    res.on("data", c => d += c);
                    res.on("end", () => resolve(JSON.parse(d)));
                });
                req.on("error", reject);
                req.end();
            });
            console.log("Socket Health:", sockHealth);
            assert.strictEqual(sockHealth.status, "ok");
            assert.strictEqual(sockHealth.engine, "go");

            console.log("6. Testing Unix Socket Run Task...");
            const sockRun = await new Promise((resolve, reject) => {
                const body = JSON.stringify({ command: "echo 'unix socket works!'", timer: 1 });
                const req = http.request({
                    socketPath: testSock,
                    path: "/api/task/run",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body)
                    }
                }, res => {
                    let d = "";
                    res.on("data", c => d += c);
                    res.on("end", () => resolve(JSON.parse(d)));
                });
                req.on("error", reject);
                req.write(body);
                req.end();
            });
            console.log("Socket Run Result:", sockRun);
            assert(sockRun.stdout.includes("unix socket works!"));
            console.log("✓ ALL GO DAEMON TESTS (TCP + UNIX SOCKET) PASSED CLEANLY!");
        } finally {
            sockProc.kill("SIGKILL");
            if (require("fs").existsSync(testSock)) require("fs").unlinkSync(testSock);
        }
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
