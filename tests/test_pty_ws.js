const WebSocket = require("ws");
const assert = require("assert");

async function testWebSocketPty() {
    console.log("=== Testing PTY WebSocket Protocol ===");
    const ws = new WebSocket("ws://127.0.0.1:4440/ws/pty");

    await new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
    });
    console.log("1. Connected to ws://127.0.0.1:4440/ws/pty");

    let receivedOutput = "";
    let spawnedId = null;

    ws.on("message", (msg) => {
        const str = msg.toString("utf8");
        try {
            const data = JSON.parse(str);
            if (data.type === "spawned" || data.action === "spawned") {
                spawnedId = data.pty_id;
            } else if (data.type === "data") {
                receivedOutput += data.data;
            }
        } catch (_) {
            receivedOutput += str;
        }
    });

    // 2. Send spawn command
    console.log("2. Sending spawn command via WebSocket...");
    ws.send(JSON.stringify({
        action: "spawn",
        shell: "/bin/bash",
        cols: 80,
        rows: 24
    }));

    // Wait for spawn response
    let attempts = 0;
    while (!spawnedId && attempts < 20) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }

    assert.ok(spawnedId, "Should have received spawned pty_id");
    console.log("Spawned PTY ID:", spawnedId);

    // 3. Send keystrokes
    console.log("3. Sending interactive command via WebSocket...");
    ws.send(JSON.stringify({
        action: "input",
        input: "echo 'WS_VERIFIED_PTY_OK'\n"
    }));

    attempts = 0;
    while (!receivedOutput.includes("WS_VERIFIED_PTY_OK") && attempts < 25) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }

    console.log("Received output contains WS token:", receivedOutput.includes("WS_VERIFIED_PTY_OK"));
    assert.ok(receivedOutput.includes("WS_VERIFIED_PTY_OK"), "Output must contain verification string");

    // 4. Send resize
    ws.send(JSON.stringify({
        action: "resize",
        cols: 110,
        rows: 35
    }));

    // 5. Clean up
    ws.send(JSON.stringify({ action: "kill" }));
    ws.close();

    console.log("\n[SUCCESS] WebSocket PTY test passed successfully!");
}

testWebSocketPty().catch(err => {
    console.error("\n[TEST FAILED]:", err);
    process.exit(1);
});
