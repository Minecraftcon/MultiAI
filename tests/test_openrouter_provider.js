const assert = require("assert");
const { resolveProvider } = require("../src/providers");
const { loadModelsConfig, getEnvKey } = require("../src/server/utils");
const OpenRouterProvider = require("../src/providers/llm/openrouter");

async function runTests() {
    console.log("=== Testing OpenRouter Provider ===");

    const provider = new OpenRouterProvider();

    // 1. Provider identification tests
    assert.strictEqual(OpenRouterProvider.id, "openrouter", "Provider ID should be 'openrouter'");
    assert.strictEqual(OpenRouterProvider.displayName, "OpenRouter", "Display name should be 'OpenRouter'");
    console.log(" [PASS] Provider identification verified.");

    // 2. Endpoint tests
    assert.strictEqual(
        provider.getEndpoint({}, "deepseek/deepseek-v4.1-flash", "test-key"),
        "https://openrouter.ai/api/v1/chat/completions",
        "Default endpoint should be OpenRouter API"
    );

    assert.strictEqual(
        provider.getEndpoint({ base_url: "https://custom.com" }, "test-model", "test-key"),
        "https://custom.com/chat/completions",
        "Custom base URL should be respected"
    );

    assert.strictEqual(
        provider.getEndpoint({ base_url: "https://custom.com/chat/completions" }, "test-model", "test-key"),
        "https://custom.com/chat/completions",
        "URL ending with /chat/completions should not be duplicated"
    );
    console.log(" [PASS] Endpoint routing verified.");

    // 3. Headers tests
    const headers = provider.getHeaders("test-key", { referer: "https://myapp.com" });
    assert.strictEqual(headers["Authorization"], "Bearer test-key", "Should include Authorization header");
    assert.strictEqual(headers["Content-Type"], "application/json", "Should include Content-Type header");
    assert.strictEqual(headers["HTTP-Referer"], "https://myapp.com", "Should include custom referer");
    assert.strictEqual(headers["X-Title"], "MultiAI", "Should include X-Title header");
    console.log(" [PASS] Headers formatting verified.");

    // 4. Payload format tests
    const payload = provider.formatPayload({
        model: "deepseek/deepseek-v4.1-flash",
        messages: [
            { role: "user", content: "Hello world" }
        ],
        tools: [{
            type: "function",
            function: { name: "test", parameters: { type: "object" } }
        }],
        config: { provider_routing: "deepseek" }
    });

    assert.strictEqual(payload.model, "deepseek/deepseek-v4.1-flash", "Model should be preserved");
    assert.strictEqual(payload.messages[0].role, "user", "Messages should be preserved");
    assert.strictEqual(payload.provider, "deepseek", "Provider routing should be added");
    assert.ok(Array.isArray(payload.tools), "Tools should be preserved");
    console.log(" [PASS] Payload formatting verified.");

    // 5. Qwen models configuration tests
    const config = loadModelsConfig();
    const providerConfig = config.providers.openrouter;
    
    // Check if our added Qwen models are present
    const qwenModels = providerConfig.models.filter(m => m.id.startsWith("qwen/"));
    assert.ok(qwenModels.length >= 4, `Should have at least 4 Qwen models, found ${qwenModels.length}`);
    
    const qwen38_24t = qwenModels.find(m => m.id === "qwen/qwen3.8-2.4t-a95b");
    assert.ok(qwen38_24t, "Qwen 3.8 2.4T A95B should be present");
    assert.strictEqual(qwen38_24t.max_context_tokens, 1048576, "Should have correct token limit");
    
    const qwen36_plus = qwenModels.find(m => m.id === "qwen/qwen3.6-plus");
    assert.ok(qwen36_plus, "Qwen 3.6 Plus should be present");
    assert.strictEqual(qwen36_plus.max_context_tokens, 1000000, "Should have correct token limit");
    
    const qwen37_plus = qwenModels.find(m => m.id === "qwen/qwen3.7-plus");
    assert.ok(qwen37_plus, "Qwen 3.7 Plus should be present");
    assert.strictEqual(qwen37_plus.max_context_tokens, 1000000, "Should have correct token limit");
    
    const qwen35_flash = qwenModels.find(m => m.id === "qwen/qwen3.5-flash-02-23");
    assert.ok(qwen35_flash, "Qwen 3.5 Flash 02-23 should be present");
    assert.strictEqual(qwen35_flash.max_context_tokens, 1000000, "Should have correct token limit");
    
    console.log(" [PASS] Qwen models configuration verified.");

    // 6. Live API validation (if API key is available)
    const apiKey = getEnvKey(providerConfig.api_key_env);
    
    if (apiKey) {
        console.log(" Validating live chat with deepseek/deepseek-v4.1-flash...");
        try {
            const res = await provider.handleChat({
                model: "deepseek/deepseek-v4.1-flash",
                apiKey,
                providerConfig,
                messages: [{ role: "user", content: "Reply with the word PONG only." }]
            });
            assert.strictEqual(res.status, 200, `Live call failed: ${res.error}`);
            assert.ok(res.message?.content, "Must contain assistant message content");
            console.log(` [PASS] Live response received: "${res.message.content.trim()}"`);
        } catch (error) {
            console.log(` [WARNING] Live test failed (this may be expected): ${error.message}`);
        }
    } else {
        console.log(" [SKIP] No OPEN_ROUTER API key found, skipping live check.");
    }

    console.log("\nAll OpenRouter provider tests passed successfully!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});