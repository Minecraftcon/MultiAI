const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { 
    startAgentJob, 
    getAgentJob, 
    stopAgentJob, 
    subscribeAgentJob, 
    activeJobs 
} = require("../src/core/build_agent_runner");

async function runTests() {
    console.log("=== Running Tests for Decoupled Server-Side Build Agent Runner ===");

    const conversationsManager = require("../src/core/conversations_manager");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-build-detached-"));
    const project = conversationsManager.addProject(tmpDir, "Test Detached Project");
    const testProjectId = project.id;
    const testChatId = `test_chat_detached_${Date.now()}`;

    // 1. Job Registry & Launch
    console.log("Test: startAgentJob initializes background job");
    const job = startAgentJob({
        projectId: testProjectId,
        chatId: testChatId,
        userText: "Analyze project files",
        model: "mock-model"
    });

    assert(job, "Job instance must be returned");
    assert.strictEqual(job.chatId, testChatId);
    assert.strictEqual(job.projectId, testProjectId);
    assert(job.isRunning, "Job must start in running state");

    // 2. Querying Job Status
    console.log("Test: getAgentJob retrieves active background job");
    const retrieved = getAgentJob(testChatId);
    assert(retrieved, "Retrieved job must exist");
    assert.strictEqual(retrieved.chatId, testChatId);
    assert.strictEqual(retrieved.isRunning, true);

    // 3. Disconnect-Resilient Event Subscription
    console.log("Test: subscribeAgentJob receives events and survives subscriber detachment");
    const receivedEvents = [];
    const unsubscribe = subscribeAgentJob(testChatId, (ev) => {
        receivedEvents.push(ev);
    });
    assert(typeof unsubscribe === "function", "subscribeAgentJob must return unsubscribe function");

    // Emit a test event to simulate background loop progress
    job.emitter.emit("event", { type: "thought", content: "Inspecting directory structure..." });
    job.emitter.emit("event", { type: "tool_start", name: "list_dir", args: { DirectoryPath: "." } });

    assert.strictEqual(receivedEvents.length, 2, "Subscriber should receive emitted events");
    assert.strictEqual(receivedEvents[0].type, "thought");
    assert.strictEqual(receivedEvents[1].name, "list_dir");

    // 4. Simulate Client Disconnect (Browser Tab Closed)
    console.log("Test: Browser disconnect (unsubscribe) does not abort server job");
    unsubscribe();

    // Emit further events while browser is 'closed'
    assert.doesNotThrow(() => {
        job.emitter.emit("event", { type: "tool_complete", name: "list_dir", result: { files: ["package.json"] } });
        job.emitter.emit("event", { type: "thought", content: "Proceeding with next task..." });
    }, "Server job must not throw when emitting events without connected clients");

    // Verify subscriber received nothing new after detachment
    assert.strictEqual(receivedEvents.length, 2, "Detached subscriber should receive no further events");

    // 5. Job Cancellation / Stop
    console.log("Test: stopAgentJob cleanly aborts running background agent");
    const stopResult = stopAgentJob(testChatId);
    assert.strictEqual(stopResult, true, "stopAgentJob must return true when active job is stopped");
    assert.strictEqual(job.isRunning, false, "Job isRunning must transition to false");
    assert(job.abortController.signal.aborted, "AbortController signal must be aborted");

    // 6. HTTP API Routes & SSE Disconnect Handling
    console.log("Test: /api/build/agent routes and safe client detachment");
    const http = require("http");
    const { handleBuildAgentRoute } = require("../src/server/routes/build_agent");

    const server = http.createServer(async (req, res) => {
        await handleBuildAgentRoute(req, res);
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // Query status via HTTP
        const statusRes = await fetch(`${baseUrl}/api/build/agent/status/${testChatId}`);
        assert.strictEqual(statusRes.status, 200);
        const statusData = await statusRes.json();
        assert.strictEqual(statusData.isRunning, false);

        // Start job via HTTP
        const startRes = await fetch(`${baseUrl}/api/build/agent/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                projectId: testProjectId,
                chatId: `${testChatId}_http`,
                userText: "Run decoupled test",
                model: "mock"
            })
        });
        assert.strictEqual(startRes.status, 200);
        const startData = await startRes.json();
        assert.strictEqual(startData.status, "started");

        // Connect SSE stream and then immediately destroy client socket (simulating browser tab close)
        const clientReq = http.get(`${baseUrl}/api/build/agent/stream/${testChatId}_http`, (sseRes) => {
            sseRes.on("data", () => {
                // Instantly destroy socket on first chunk
                clientReq.destroy();
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Stop job via HTTP
        const stopRes = await fetch(`${baseUrl}/api/build/agent/stop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: `${testChatId}_http` })
        });
        assert.strictEqual(stopRes.status, 200);
        const stopData = await stopRes.json();
        assert.strictEqual(stopData.status, "stopped");
    } finally {
        server.close();
    }

    console.log("✓ ALL DECOUPLED BUILD AGENT RUNNER & ROUTE TESTS PASSED CLEANLY!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
