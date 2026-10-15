const assert = require("assert");
const { resolveProvider } = require("../src/providers");
const { loadModelsConfig, getEnvKey } = require("../src/server/utils");
const OpenCodeProvider = require("../src/providers/llm/opencode");

async function runTests() {
    console.log("=== Testing OpenCodeProvider Dual Protocol Support ===");

    const provider = new OpenCodeProvider();

    // 1. Endpoint routing tests
    assert.strictEqual(
        provider.getEndpoint({}, "muse-spark-1.3-contributor-free"),
        "https://opencode.ai/zen/v1/responses",
        "Muse Spark must route to /responses"
    );
    assert.strictEqual(
        provider.getEndpoint({}, "space-bunny-free"),
        "https://opencode.ai/zen/v1/chat/completions",
        "Space Bunny must route to /chat/completions"
    );
    assert.strictEqual(
        provider.getEndpoint({}, "mimo-v2.6-flash-free"),
        "https://opencode.ai/zen/v1/chat/completions",
        "MiMo must route to /chat/completions"
    );
    console.log(" [PASS] Endpoint routing verified.");

    // 2. Payload format tests for Responses protocol
    const responsesPayload = provider.formatPayload({
        model: "muse-spark-1.3-contributor-free",
        messages: [
            { role: "user", content: "hello" },
            { 
                role: "assistant", 
                content: "run tool",
                tool_calls: [{ id: "c1", type: "function", function: { name: "run_task", arguments: "{}" } }]
            },
            { role: "tool", tool_call_id: "c1", content: "done" }
        ],
        tools: [{
            type: "function",
            function: { name: "run_task", description: "run a task", parameters: { type: "object", properties: {} } }
        }]
    });

    assert.ok(Array.isArray(responsesPayload.input), "Responses payload must have an input array");
    assert.strictEqual(responsesPayload.input[0].role, "user");
    assert.strictEqual(responsesPayload.input[1].role, "assistant");
    assert.strictEqual(responsesPayload.input[2].type, "function_call");
    assert.strictEqual(responsesPayload.input[3].type, "function_call_output");
    assert.strictEqual(responsesPayload.input[3].call_id, "c1");
    assert.ok(responsesPayload.tools.every(t => typeof t.name === "string" && !t.function), "Tools must be flattened");
    console.log(" [PASS] Responses payload normalization verified.");

    // 3. Live API validation
    const config = loadModelsConfig();
    const providerConfig = config.providers.opencode;
    const apiKey = getEnvKey(providerConfig.api_key_env);

    if (apiKey) {
        console.log(" Validating live chat with muse-spark-1.3-contributor-free...");
        const res = await provider.handleChat({
            model: "muse-spark-1.3-contributor-free",
            apiKey,
            providerConfig,
            messages: [{ role: "user", content: "Reply with the word PONG only." }]
        });
        assert.strictEqual(res.status, 200, `Live call failed: ${res.error}`);
        assert.ok(res.message?.content, "Must contain assistant message content");
        console.log(` [PASS] Live response received: "${res.message.content.trim()}"`);
    } else {
        console.log(" [SKIP] No OPENCODE_API_KEY found, skipping live check.");
    }

    console.log("\nAll OpenCode provider dual protocol tests passed successfully!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
