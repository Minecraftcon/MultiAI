const http = require("http");
const assert = require("assert");

process.env.CLOUD_PASSWORD = process.env.CLOUD_PASSWORD || "test-pty-token";

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const payload = postData ? (typeof postData === "string" ? postData : JSON.stringify(postData)) : null;
        const headers = {
            ...(options.headers || {}),
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
            "Authorization": `Bearer ${process.env.CLOUD_PASSWORD}`
        };
        const req = http.request({ ...options, headers }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
                } catch (_) {
                    resolve({ status: res.statusCode, data, headers: res.headers });
                }
            });
        });
        req.on("error", reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

async function runTests() {
    console.log("=== Testing Real Pseudo-Terminal (PTY) Subsystem ===");

    let server = null;
    let port = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 0;
    if (!port) {
        const { routeRequest } = require("../src/server/router");
        const { initPtyWebSocket } = require("../src/server/routes/pty");
        const { initSupervisor } = require("../src/server/supervisor");
        initSupervisor();
        server = http.createServer(routeRequest);
        initPtyWebSocket(server);
        await new Promise(res => server.listen(0, "127.0.0.1", res));
        port = server.address().port;
        await new Promise(r => setTimeout(r, 600));
    }

    try {
        // 1. Spawn a real PTY
        console.log("1. Spawning PTY session...");
        const spawnRes = await request({
            hostname: "127.0.0.1",
            port,
            path: "/api/pty/spawn",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            shell: "/bin/bash",
            cols: 100,
            rows: 30
        });

        console.log("Spawn response:", spawnRes.data);
        assert.strictEqual(spawnRes.status, 200, "Spawn should return HTTP 200");
        assert.ok(spawnRes.data.pty_id, "Should have pty_id");
        assert.strictEqual(spawnRes.data.is_native, true, "Should use native node-pty");
        const ptyId = spawnRes.data.pty_id;

        // 2. Connect to SSE stream
        console.log("2. Connecting to PTY stream...");
        let receivedData = "";
        const streamReq = http.request({
            hostname: "127.0.0.1",
            port,
            path: `/api/pty/stream/${encodeURIComponent(ptyId)}`,
            method: "GET",
            headers: {
                "Authorization": `Bearer ${process.env.CLOUD_PASSWORD}`
            }
        }, (res) => {
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.headers["content-type"].includes("text/event-stream"));

            res.on("data", chunk => {
                receivedData += chunk.toString("utf8");
            });
        });
        streamReq.end();

        // Give stream a brief moment to connect
        await new Promise(r => setTimeout(r, 300));

        // 3. Write interactive commands to PTY
        console.log("3. Writing command to PTY stdin...");
        const writeRes = await request({
            hostname: "127.0.0.1",
            port,
            path: `/api/pty/input/${encodeURIComponent(ptyId)}`,
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            input: "echo 'PTY_VERIFICATION_TOKEN_8891'\n"
        });
        assert.strictEqual(writeRes.status, 200);

        // Also check `tty`
        await request({
            hostname: "127.0.0.1",
            port,
            path: `/api/pty/input/${encodeURIComponent(ptyId)}`,
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            input: "tty\n"
        });

        // Wait for output to arrive in stream
        let attempts = 0;
        while (!receivedData.includes("PTY_VERIFICATION_TOKEN_8891") && attempts < 30) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        console.log("Received data contains token:", receivedData.includes("PTY_VERIFICATION_TOKEN_8891"));
        assert.ok(receivedData.includes("PTY_VERIFICATION_TOKEN_8891"), "PTY output should include verification token");
        console.log("Stream output preview:\n", receivedData.slice(0, 400));

        // 4. Test Resize
        console.log("4. Testing PTY window resize...");
        const resizeRes = await request({
            hostname: "127.0.0.1",
            port,
            path: `/api/pty/resize/${encodeURIComponent(ptyId)}`,
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            cols: 120,
            rows: 40
        });
        assert.strictEqual(resizeRes.status, 200);
        assert.strictEqual(resizeRes.data.cols, 120);
        assert.strictEqual(resizeRes.data.rows, 40);

        // 5. Test List
        console.log("5. Testing PTY list...");
        const listRes = await request({
            hostname: "127.0.0.1",
            port,
            path: "/api/pty/list",
            method: "GET"
        });
        assert.strictEqual(listRes.status, 200);
        assert.ok(Array.isArray(listRes.data), "List should be array");
        const found = listRes.data.find(s => s.pty_id === ptyId);
        assert.ok(found, "Active session should be in list");
        assert.strictEqual(found.running, true);

        // 6. Test Kill
        console.log("6. Testing PTY kill...");
        const killRes = await request({
            hostname: "127.0.0.1",
            port,
            path: `/api/pty/kill/${encodeURIComponent(ptyId)}`,
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        assert.strictEqual(killRes.status, 200);
        assert.strictEqual(killRes.data.status, "killed");

        try { streamReq.destroy(); } catch (_) {}
        console.log("\n[SUCCESS] All PTY backend tests passed successfully!");
    } finally {
        if (server) {
            server.close();
            const { cleanupAndExit } = require("../src/server/supervisor");
            cleanupAndExit(0);
        }
    }
}

runTests().catch(err => {
    console.error("\n[TEST FAILED]:", err);
    process.exit(1);
});
