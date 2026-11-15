/**
 * Verification Test: Workspace File Watcher & Live File Tree SSE Events
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

async function main() {
    console.log("=== Testing Workspace File Watcher & Live File Tree Events ===");

    // 1. Test GET /api/file/version
    const versionRes = await fetch("http://127.0.0.1:4440/api/file/version");
    assert.strictEqual(versionRes.status, 200, "GET /api/file/version must return 200");
    const versionData = await versionRes.json();
    assert.ok(typeof versionData.version === "number", "version must be a number/timestamp");
    console.log("✓ GET /api/file/version passed, current version:", versionData.version);

    // 2. Test GET /api/history/changes includes version
    const changesRes = await fetch("http://127.0.0.1:4440/api/history/changes");
    assert.strictEqual(changesRes.status, 200, "GET /api/history/changes must return 200");
    const changesData = await changesRes.json();
    assert.ok(typeof changesData.version === "number", "changes response must include version");
    console.log("✓ GET /api/history/changes includes version:", changesData.version);

    // 3. Test SSE stream: GET /api/file/events
    console.log("Connecting to SSE /api/file/events...");
    let sseInitReceived = false;
    let sseChangeReceived = false;

    const req = http.request("http://127.0.0.1:4440/api/file/events", {
        headers: { "Accept": "text/event-stream" }
    }, (res) => {
        assert.strictEqual(res.statusCode, 200, "SSE must respond with 200");
        assert.ok(res.headers["content-type"].includes("text/event-stream"), "Content-type must be text/event-stream");

        res.on("data", (chunk) => {
            const text = chunk.toString();
            // console.log("[SSE received]:", text.trim());
            if (text.includes('"type":"init"')) {
                sseInitReceived = true;
            }
            if (text.includes('"type":"change"')) {
                sseChangeReceived = true;
            }
        });
    });

    req.end();

    // Wait 400ms for SSE init event
    await new Promise(r => setTimeout(r, 400));
    assert.ok(sseInitReceived, "SSE must emit init event upon connection");
    console.log("✓ SSE init event received successfully");

    // 4. Test disk modification triggers live change event
    const testFile = path.join("/tmp/work", `test_live_tree_${Date.now()}.txt`);
    console.log("Creating test file on disk in /tmp/work:", testFile);
    fs.writeFileSync(testFile, "hello live watcher");

    // Wait for inotify debounce & event delivery
    await new Promise(r => setTimeout(r, 500));
    assert.ok(sseChangeReceived, "SSE must emit change event when file is created in workspace");
    console.log("✓ SSE change event received when file created on disk!");

    // Clean up test file
    try { fs.unlinkSync(testFile); } catch (_) {}
    req.destroy();

    console.log("\nALL LIVE FILE TREE WATCHER & EVENT TESTS PASSED CLEANLY!");
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});

