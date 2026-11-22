const assert = require("assert");
const { normalizeServerUrl } = require("../src/server/utils");
const LocalProvider = require("../src/providers/llm/local");

console.log("=== Running Local URL Normalization Tests ===");

// 1. normalizeServerUrl unit tests
const cases = [
    {
        input: "techno-replication-advantage-headline.trycloudflare.com/",
        expected: "https://techno-replication-advantage-headline.trycloudflare.com"
    },
    {
        input: "techno-replication-advantage-headline.trycloudflare.com",
        expected: "https://techno-replication-advantage-headline.trycloudflare.com"
    },
    {
        input: "techno-replication-advantage-headline.trycloudflare.com/v1",
        expected: "https://techno-replication-advantage-headline.trycloudflare.com"
    },
    {
        input: "techno-replication-advantage-headline.trycloudflare.com/v1/",
        expected: "https://techno-replication-advantage-headline.trycloudflare.com"
    },
    {
        input: "https://techno-replication-advantage-headline.trycloudflare.com/v1/chat/completions",
        expected: "https://techno-replication-advantage-headline.trycloudflare.com"
    },
    {
        input: "my-tunnel.ngrok-free.app/",
        expected: "https://my-tunnel.ngrok-free.app"
    },
    {
        input: "localhost:5001",
        expected: "http://localhost:5001"
    },
    {
        input: "localhost:5001/",
        expected: "http://localhost:5001"
    },
    {
        input: "127.0.0.1:11434/api/chat",
        expected: "http://127.0.0.1:11434"
    },
    {
        input: "http://localhost:1234/v1",
        expected: "http://localhost:1234"
    },
    {
        input: "http://192.168.1.50:8000/api/v1/",
        expected: "http://192.168.1.50:8000"
    },
    {
        input: "   'https://api.openai-local.dev/v1/'   ",
        expected: "https://api.openai-local.dev"
    }
];

for (const { input, expected } of cases) {
    const actual = normalizeServerUrl(input);
    assert.strictEqual(actual, expected, `normalizeServerUrl(${JSON.stringify(input)}) should be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
console.log("✓ All normalizeServerUrl unit test cases passed!");

// 2. LocalProvider.getEndpoint endpoint generation without duplicate paths
const provider = new LocalProvider();

const endpointCases = [
    {
        config: { base_url: "techno-replication-advantage-headline.trycloudflare.com/v1", api_format: "openai" },
        expected: "https://techno-replication-advantage-headline.trycloudflare.com/v1/chat/completions"
    },
    {
        config: { base_url: "https://my-tunnel.trycloudflare.com", api_format: "openai" },
        expected: "https://my-tunnel.trycloudflare.com/v1/chat/completions"
    },
    {
        config: { base_url: "localhost:5001/api/v1", api_format: "kobold" },
        expected: "http://localhost:5001/api/v1/chat/completions"
    },
    {
        config: { base_url: "127.0.0.1:11434", api_format: "ollama" },
        expected: "http://127.0.0.1:11434/api/chat"
    }
];

for (const { config, expected } of endpointCases) {
    const actual = provider.getEndpoint(config, "local:model");
    assert.strictEqual(actual, expected, `getEndpoint(${JSON.stringify(config.base_url)}, ${config.api_format}) should be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
console.log("✓ All LocalProvider endpoint generation cases passed!");

console.log("=== ALL LOCAL URL NORMALIZATION TESTS PASSED ===");
