const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

function requestJSON(port, method, reqPath, data = null, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        const payload = data ? JSON.stringify(data) : null;
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: reqPath,
            method,
            timeout: timeoutMs,
            headers: payload ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            } : {}
        }, (res) => {
            let resData = "";
            res.on("data", chunk => { resData += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(resData));
                } catch (e) {
                    resolve({ raw: resData, statusCode: res.statusCode });
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out: " + reqPath));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitForServer(port, maxTries = 30) {
    for (let i = 0; i < maxTries; i++) {
        try {
            const h = await requestJSON(port, "GET", "/health", null, 800);
            if (h && h.status === "ok") return h;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Server failed to start on port ${port}`);
}

async function runTest() {
    console.log("=== Testing Live Supervisor Switchability ===");
    const testPort = 5789;
    const repoRoot = path.join(__dirname, "..");

    // 1. Test MULTIAI_TASK_DAEMON=go
    console.log("\n[1] Starting supervisor with MULTIAI_TASK_DAEMON=go...");
    const goProc = spawn("node", ["-e", `
        process.env.TASK_PORT = "${testPort}";
        process.env.MULTIAI_TASK_DAEMON = "go";
        const { initSupervisor } = require("./src/server/supervisor");
        initSupervisor();
    `], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TASK_PORT: String(testPort),
            MULTIAI_TASK_DAEMON: "go",
            MULTIAI_SANDBOX: "0",
            MULTIAI_IPC: "tcp"
        }
    });

    goProc.stdout.on("data", d => process.stdout.write(`  [GO-SUPERVISOR] ${d}`));
    goProc.stderr.on("data", d => process.stderr.write(`  [GO-SUPERVISOR ERR] ${d}`));

    try {
        const goHealth = await waitForServer(testPort);
        console.log("  Health response:", goHealth);
        if (goHealth.engine !== "go") {
            throw new Error(`Expected engine to be 'go', got '${goHealth.engine}'`);
        }

        const runRes = await requestJSON(testPort, "POST", "/api/task/run", { command: "echo switch-to-go-works", wait_ms: 2000 });
        console.log("  Go Task Run Output:", runRes.stdout?.trim());
        if (!runRes.stdout?.includes("switch-to-go-works")) {
            throw new Error("Go task execution failed");
        }
        console.log("✓ Go Daemon Test Successful!");
    } finally {
        goProc.kill("SIGTERM");
        await new Promise(r => setTimeout(r, 600));
    }

    // 2. Test MULTIAI_TASK_DAEMON=python
    console.log("\n[2] Starting supervisor with MULTIAI_TASK_DAEMON=python...");
    const pyProc = spawn("node", ["-e", `
        process.env.TASK_PORT = "${testPort}";
        process.env.MULTIAI_TASK_DAEMON = "python";
        const { initSupervisor } = require("./src/server/supervisor");
        initSupervisor();
    `], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TASK_PORT: String(testPort),
            MULTIAI_TASK_DAEMON: "python",
            MULTIAI_SANDBOX: "0",
            MULTIAI_IPC: "tcp"
        }
    });

    pyProc.stdout.on("data", d => process.stdout.write(`  [PY-SUPERVISOR] ${d}`));
    pyProc.stderr.on("data", d => process.stderr.write(`  [PY-SUPERVISOR ERR] ${d}`));

    try {
        const pyHealth = await waitForServer(testPort);
        console.log("  Health response:", pyHealth);
        if (pyHealth.engine !== "flask" && pyHealth.engine !== "http.server") {
            throw new Error(`Expected Python engine (flask or http.server), got '${pyHealth.engine}'`);
        }

        const runRes = await requestJSON(testPort, "POST", "/api/task/run", { command: "echo switch-to-python-works", timer: 2 });
        console.log("  Python Task Run Output:", runRes.stdout?.trim());
        if (!runRes.stdout?.includes("switch-to-python-works")) {
            throw new Error("Python task execution failed");
        }
        console.log("✓ Python Server Test Successful!");
    } finally {
        pyProc.kill("SIGTERM");
        await new Promise(r => setTimeout(r, 600));
    }

    console.log("\n✓ BOTH ENGINES ARE FULLY FUNCTIONAL AND 100% SWITCHABLE!\n");
    process.exit(0);
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
