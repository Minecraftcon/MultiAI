// Unit test for Kilo AI Gateway Provider
const assert = require("assert");
const { resolveProvider } = require("../src/providers/llm");
const KiloProvider = require("../src/providers/llm/kilo");

console.log("Starting Kilo AI Gateway Provider tests...");

// 1. Resolution checks
const p1 = resolveProvider("kilo");
assert(p1 instanceof KiloProvider, "Should resolve 'kilo' to KiloProvider");

const p2 = resolveProvider("kilo-ai");
assert(p2 instanceof KiloProvider, "Should resolve 'kilo-ai' to KiloProvider");

const p3 = resolveProvider("kilo_gateway");
assert(p3 instanceof KiloProvider, "Should resolve 'kilo_gateway' to KiloProvider");

const p4 = resolveProvider("kilocode");
assert(p4 instanceof KiloProvider, "Should resolve 'kilocode' to KiloProvider");

console.log("✔ Provider resolution tests passed.");

// 2. Endpoint check
const defaultEndpoint = p1.getEndpoint({});
assert.strictEqual(defaultEndpoint, "https://ai-gateway.kilo.ai/api/v1/chat/completions");

const customEndpoint = p1.getEndpoint({ base_url: "https://custom.kilo.ai/v1" });
assert.strictEqual(customEndpoint, "https://custom.kilo.ai/v1/chat/completions");

console.log("✔ Endpoint formatting tests passed.");

// 3. Headers check
const headersNoAuth = p1.getHeaders();
assert.strictEqual(headersNoAuth["Content-Type"], "application/json");
assert.strictEqual(headersNoAuth["Authorization"], undefined);

const headersAuth = p1.getHeaders("kilo_secret_key");
assert.strictEqual(headersAuth["Authorization"], "Bearer kilo_secret_key");

console.log("✔ Headers formatting tests passed.");

// 4. Payload formatting check
const payload = p1.formatPayload({
    model: "kilo:kilo-auto/free",
    messages: [{ role: "user", content: "Hello Kilo" }],
    tools: [
        { type: "function", function: { name: "test_tool", parameters: {} } }
    ],
    supportsTools: true,
    config: { default_max_tokens: 4096 }
});

assert.strictEqual(payload.model, "kilo-auto/free", "Should strip provider prefix");
assert.strictEqual(payload.messages[0].content, "Hello Kilo");
assert.strictEqual(payload.tools.length, 1);
assert.strictEqual(payload.max_tokens, 4096);

console.log("✔ Payload formatting tests passed.");

console.log("All Kilo Provider tests passed successfully!");

