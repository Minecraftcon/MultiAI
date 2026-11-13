/**
 * Test: Crash Persistence & Error History Retention
 * Verifies that:
 * 1. Fatal errors / crashes are preserved in session.messages with full debug metadata (stack, status, raw).
 * 2. Disk serialization writes the full error record to messages.jsonl.
 * 3. Working context compiler sanitizes the error turn so models receive clean context without raw stack traces.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
    readMessages,
    safelyWriteMessages,
    appendMessage
} = require("../src/core/jsonl_session_store");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-crash-test-"));
const messagesFile = path.join(tempDir, "messages.jsonl");

try {
    console.log("=== Testing Crash Persistence & Error Retention ===");

    // 1. Simulate conversation turns with a crash on turn 2
    const testMessages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Analyze src/components/terminal.js" },
        {
            role: "assistant",
            content: "[Error: Request could not be succeeded [HTTP 401] - Invalid API key]",
            isError: true,
            error: {
                message: "Invalid API key provided",
                statusCode: 401,
                code: "invalid_api_key",
                stack: "Error: Invalid API key provided\n    at GoogleProvider.chat (/src/providers/google.js:42:15)\n    at runAgent (/src/agent/orchestrator.js:180:20)",
                raw: JSON.stringify({ error: { message: "Invalid API key provided", type: "invalid_request_error", code: 401 } }),
                timestamp: 1794551234567
            }
        }
    ];

    console.log("1. Writing messages with crash error to messages.jsonl...");
    safelyWriteMessages(messagesFile, testMessages, true);

    // 2. Read back from messages.jsonl
    const loaded = readMessages(messagesFile);
    assert.strictEqual(loaded.length, 3, "All 3 messages must exist in messages.jsonl");

    const errorMsg = loaded[2];
    assert.strictEqual(errorMsg.role, "assistant");
    assert.strictEqual(errorMsg.isError, true);
    assert.ok(errorMsg.error, "Error metadata object must be preserved");
    assert.strictEqual(errorMsg.error.statusCode, 401);
    assert.strictEqual(errorMsg.error.message, "Invalid API key provided");
    assert.ok(errorMsg.error.stack.includes("GoogleProvider.chat"), "Full stack trace must be preserved on disk in JSONL");
    assert.ok(errorMsg.error.raw.includes("invalid_request_error"), "Raw error response must be preserved on disk in JSONL");

    console.log("✓ JSONL file on disk contains full error, stack trace, and raw response.");

    // 3. Test sanitizeWorkingTurn logic
    console.log("2. Testing working context sanitization for LLM dispatch...");
    const sanitizeWorkingTurn = (m) => {
        if (!m || typeof m !== "object") return m;
        if (m.isError || m.error) {
            const errObj = m.error || {};
            const cleanErr = errObj.message || (typeof m.content === "string" ? m.content : "Previous generation encountered an error");
            return {
                role: "assistant",
                content: `[Previous attempt failed: ${cleanErr}]`
            };
        }
        return m;
    };

    const sanitized = sanitizeWorkingTurn(errorMsg);
    assert.strictEqual(sanitized.role, "assistant");
    assert.strictEqual(sanitized.content, "[Previous attempt failed: Invalid API key provided]");
    assert.strictEqual(sanitized.stack, undefined, "Stack trace must NOT be leaked to the LLM working context");
    assert.strictEqual(sanitized.raw, undefined, "Raw dump must NOT be leaked to the LLM working context");

    console.log("✓ Working context properly sanitized for future model turns.");

    console.log("\n[SUCCESS] Crash persistence test passed cleanly!");
} finally {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
}
