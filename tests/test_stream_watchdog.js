const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Client-Side Dead Man's Watchdog (Stall Detection) ===");

// 1. Verify CSS styles for stall banner
const chatCssPath = path.join(__dirname, "../UI/webui/styles/chat.css");
assert(fs.existsSync(chatCssPath), "chat.css must exist");
const chatCss = fs.readFileSync(chatCssPath, "utf-8");
assert(chatCss.includes(".stream-interrupted-banner"), "chat.css must contain .stream-interrupted-banner");
assert(chatCss.includes(".stream-interrupted-badge"), "chat.css must contain .stream-interrupted-badge");
console.log("✓ CSS styling for stream watchdog stall banner verified cleanly.");

// 2. Setup mock browser environment for Node.js
global.window = {
    modelProviderMap: {},
    addEventListener: () => {},
    removeEventListener: () => {}
};
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.document = {
    getElementById: (id) => {
        if (id === "chat") return { appendChild: () => {}, querySelector: () => null, scrollIntoView: () => {} };
        return null;
    },
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                contains: () => false
            },
            dataset: {},
            innerHTML: "",
            children: [],
            appendChild: (child) => el.children.push(child),
            insertBefore: (newNode, refNode) => el.children.unshift(newNode),
            querySelector: () => null,
            querySelectorAll: () => []
        };
        return el;
    },
    documentElement: {
        style: {
            setProperty: () => {},
            getPropertyValue: () => ""
        },
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
        }
    }
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

async function runTests() {
    // 3. Test chat-client.js exports
    const { StreamStallError, StreamDroppedError, callChatModel } = await import("../UI/webui/src/agent/chat-client.js");
    const { state } = await import("../UI/webui/src/state/index.js");
    const { finalizeStalled } = await import("../UI/webui/src/components/chat-ui.js");

    assert.strictEqual(typeof StreamStallError, "function", "Must export StreamStallError");
    assert.strictEqual(typeof StreamDroppedError, "function", "Must export StreamDroppedError");

    const sampleErr = new StreamStallError("Stream connection stalled", {
        partialText: "Once upon a time",
        partialContent: "Once upon a time",
        accumulatedReasoning: "Drafting the story",
        toolCalls: []
    });
    assert.strictEqual(sampleErr.isStall, true, "isStall must be true");
    assert.strictEqual(sampleErr.partialText, "Once upon a time");
    assert.strictEqual(sampleErr.accumulatedReasoning, "Drafting the story");
    console.log("✓ StreamStallError and StreamDroppedError error classes verified.");

    // 4. Test Watchdog with fast custom timeouts (e.g. 50ms)
    state.config = state.config || {};
    state.config.Agent = state.config.Agent || {};
    state.config.Agent.StreamInitialTimeoutMs = 120;
    state.config.Agent.StreamStallTimeoutMs = 80;

    // Helper: create mock SSE readable stream
    function createMockStream(chunksWithDelays) {
        let index = 0;
        let isCancelled = false;
        return {
            cancelled: () => isCancelled,
            readable: {
                getReader: () => ({
                    read: () => {
                        if (isCancelled) {
                            return Promise.resolve({ done: true, value: undefined });
                        }
                        if (index >= chunksWithDelays.length) {
                            return Promise.resolve({ done: true, value: undefined });
                        }
                        const current = chunksWithDelays[index++];
                        return new Promise((resolve) => {
                            setTimeout(() => {
                                if (isCancelled) {
                                    resolve({ done: true, value: undefined });
                                } else {
                                    resolve({
                                        done: false,
                                        value: new TextEncoder().encode(current.text)
                                    });
                                }
                            }, current.delay);
                        });
                    },
                    cancel: () => {
                        isCancelled = true;
                        return Promise.resolve();
                    }
                })
            }
        };
    }

    // Test Case A: Normal streaming within timeout limits (No stall)
    console.log("\n4.A: Testing normal stream within watchdog window...");
    const normalStream = createMockStream([
        { delay: 20, text: 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' },
        { delay: 30, text: 'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n' },
        { delay: 20, text: 'data: [DONE]\n\n' }
    ]);

    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/event-stream"]]),
        body: normalStream.readable
    });

    let streamedOutput = "";
    const resA = await callChatModel([{ role: "user", content: "hi" }], {
        model: "custom/llama-3",
        onChunk: (chunk, acc) => {
            streamedOutput = acc;
        }
    });

    assert.strictEqual(resA.message.content, "Hello world!", "Stream must assemble full content");
    assert.strictEqual(normalStream.cancelled(), false, "Stream must not be cancelled");
    console.log("✓ Normal streaming completed cleanly without triggering watchdog.");

    // Test Case B: Dead Man's Watchdog triggers when stream stalls (delay > StreamStallTimeoutMs)
    console.log("\n4.B: Testing watchdog trigger on mid-stream stall...");
    const stalledStream = createMockStream([
        { delay: 20, text: 'data: {"choices":[{"delta":{"content":"Beginning of response..."}}]}\n\n' },
        // Simulate remote server freezing for 250ms (stall timeout is 80ms)
        { delay: 250, text: 'data: {"choices":[{"delta":{"content":"Should not arrive"}}]}\n\n' }
    ]);

    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/event-stream"]]),
        body: stalledStream.readable
    });

    let stalledCaught = null;
    try {
        await callChatModel([{ role: "user", content: "test" }], {
            model: "custom/llama-3",
            onChunk: () => {}
        });
    } catch (err) {
        stalledCaught = err;
    }

    assert(stalledCaught, "Must catch an error when stream stalls");
    assert.strictEqual(stalledCaught.isStall, true, "Caught error must have isStall = true");
    assert.strictEqual(stalledCaught.name, "StreamStallError", "Caught error name must be StreamStallError");
    assert.strictEqual(stalledCaught.partialText, "Beginning of response...", "Must preserve partialText");
    assert.strictEqual(stalledStream.cancelled(), true, "Reader must have been cancelled by watchdog");
    console.log("✓ Watchdog successfully cancelled frozen stream and threw StreamStallError with preserved partial text.");

    // Test Case C: User abort stops generation without triggering stall error
    console.log("\n4.C: Testing user abort does not trigger stall error...");
    const abortStream = createMockStream([
        { delay: 30, text: 'data: {"choices":[{"delta":{"content":"First chunk"}}]}\n\n' },
        { delay: 500, text: 'data: [DONE]\n\n' }
    ]);

    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/event-stream"]]),
        body: abortStream.readable
    });

    const userAbortController = new AbortController();
    setTimeout(() => userAbortController.abort(), 40);

    let abortCaught = null;
    try {
        await callChatModel([{ role: "user", content: "test" }], {
            model: "custom/llama-3",
            signal: userAbortController.signal,
            onChunk: () => {}
        });
    } catch (err) {
        abortCaught = err;
    }

    assert(abortCaught, "Must catch error on user abort");
    assert.strictEqual(abortCaught.name, "AbortError", "User abort must throw AbortError");
    assert.strictEqual(abortCaught.isStall, undefined, "User abort must not have isStall set");
    console.log("✓ User abort correctly throws AbortError without falsely triggering stall watchdog.");

    // Test Case D: UI finalizeStalled mounts status banner and preserves partial text
    console.log("\n4.D: Testing UI finalizeStalled behavior...");
    const finalContentObj = {
        innerHTML: "",
        innerText: "Existing generated content",
        querySelectorAll: () => []
    };
    const activityLabelObj = { textContent: "" };

    const mockElement = {
        dataset: { rawText: "Existing generated content" },
        querySelector: (sel) => {
            if (sel === ".final-content") return finalContentObj;
            if (sel === ".activity-label") return activityLabelObj;
            return null;
        },
        querySelectorAll: () => []
    };

    finalizeStalled(mockElement, Date.now() - 3000, false, {
        isStall: true,
        message: "Stream connection stalled",
        partialText: "Existing generated content"
    });

    const finalContentEl = finalContentObj;
    assert(finalContentEl.innerHTML.includes("Existing generated content"), "Preserved partial content must be in DOM");
    assert(finalContentEl.innerHTML.includes("stream-interrupted-banner"), "Must render stream-interrupted-banner in DOM");
    assert(finalContentEl.innerHTML.includes("Connection stalled"), "Must display Connection stalled badge");
    console.log("✓ finalizeStalled successfully rendered preserved output and minimal stall status badge.");

    console.log("\n=== ALL DEAD MAN'S WATCHDOG TESTS PASSED SUCCESSFULLY! ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
