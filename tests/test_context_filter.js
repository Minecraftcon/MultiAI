import assert from "assert";
import { ContextFilterer, BUILTIN_PRESETS, DEFAULT_FILTERS } from "../UI/webui/src/agent/context-filter.js";

console.log("=== Testing Context Privacy & Redaction Filterer ===");

// 1. Keyword filtering with whole-word and case-insensitivity
console.log("Test: Keyword filtering");
const keywordFilter = new ContextFilterer([
    {
        id: "kw1",
        type: "keyword",
        pattern: "SecretCompany",
        replacement: "[REDACTED_CORP]",
        wholeWord: true,
        flags: "gi",
        action: "replace",
        scope: "all",
        enabled: true
    }
]);

assert.strictEqual(
    keywordFilter.filterText("Working at secretcompany on internal stuff"),
    "Working at [REDACTED_CORP] on internal stuff"
);
// Substrings should not match when wholeWord is true
assert.strictEqual(
    keywordFilter.filterText("MysecretcompanyXYZ is not replaced"),
    "MysecretcompanyXYZ is not replaced"
);

// 2. Custom Regex filtering
console.log("Test: Custom regex filtering");
const regexFilter = new ContextFilterer([
    {
        id: "rx1",
        type: "regex",
        pattern: "ghp_[a-zA-Z0-9]{10,}",
        replacement: "[REDACTED_GITHUB_TOKEN]",
        flags: "g",
        action: "replace",
        scope: "all",
        enabled: true
    }
]);

assert.strictEqual(
    regexFilter.filterText("Token: ghp_1234567890ABCDEF123456"),
    "Token: [REDACTED_GITHUB_TOKEN]"
);

// 3. Builtin Presets
console.log("Test: Built-in presets (API Keys & Local Paths)");
const presetFilter = new ContextFilterer(DEFAULT_FILTERS.map(f => ({ ...f, enabled: true })));

const sampleText = "Here is my secret sk-abcdef1234567890abcdef1234 and home directory is /home/johndoe/projects.";
const scrubbed = presetFilter.filterText(sampleText);
assert.ok(scrubbed.includes("[REDACTED_API_KEY]"), "Should redact OpenAI API key");
assert.ok(scrubbed.includes("/home/[USER]"), "Should scrub user home path");
assert.ok(!scrubbed.includes("/home/johndoe"), "Original user path must be scrubbed");

// 4. Halt/Block Mode
console.log("Test: Halt/Block mode");
const blockFilter = new ContextFilterer([
    {
        id: "blk1",
        type: "keyword",
        pattern: "TOP_SECRET_DROP",
        action: "block",
        scope: "all",
        enabled: true
    }
]);

assert.throws(() => {
    blockFilter.filterText("Please inspect TOP_SECRET_DROP for me");
}, /Context Filter Blocked/);

// 5. Message Structure Filtering
console.log("Test: Message array structure filtering (content preserved vs tool calls protected)");
const msgFilter = new ContextFilterer([
    {
        id: "m1",
        type: "keyword",
        pattern: "database_password_999",
        replacement: "[DB_PASSWORD]",
        scope: "all",
        enabled: true
    },
    {
        id: "m2",
        type: "keyword",
        pattern: "cp",
        replacement: "[C-related]",
        scope: "all",
        enabled: true
    }
]);

const rawMessages = [
    { role: "user", content: "Connection string has database_password_999 inside and mentions cp." },
    {
        role: "assistant",
        content: "Here is cp in assistant text",
        tool_calls: [
            {
                id: "call_1",
                function: {
                    name: "list_dir",
                    arguments: '{"DirectoryPath":"src/providers/llm"}'
                }
            }
        ]
    }
];

const cleaned = msgFilter.filterMessages(rawMessages);
// User and assistant content are filtered
assert.strictEqual(cleaned[0].content, "Connection string has [DB_PASSWORD] inside and mentions [C-related].");
assert.strictEqual(cleaned[1].content, "Here is [C-related] in assistant text");
// Tool call arguments are NOT corrupted by general filters (src/providers must stay intact!)
assert.strictEqual(cleaned[1].tool_calls[0].function.arguments, '{"DirectoryPath":"src/providers/llm"}');

// 5b. Explicit tool_call_args scoping
const explicitToolFilter = new ContextFilterer([
    {
        id: "t1",
        type: "keyword",
        pattern: "secret_token_123",
        replacement: "[SECRET]",
        scope: "tool_call_args",
        enabled: true
    }
]);
const explicitCleaned = explicitToolFilter.filterMessages([
    {
        role: "assistant",
        content: "secret_token_123",
        tool_calls: [
            {
                id: "call_2",
                function: {
                    name: "run_task",
                    arguments: '{"command":"curl secret_token_123"}'
                }
            }
        ]
    }
]);
// Content untouched because filter was scoped strictly to tool_call_args
assert.strictEqual(explicitCleaned[0].content, "secret_token_123");
assert.strictEqual(explicitCleaned[0].tool_calls[0].function.arguments, '{"command":"curl [SECRET]"}');

// 6. Scope scoping (user vs tool vs assistant)
console.log("Test: Scope-restricted filtering");
const scopeFilter = new ContextFilterer([
    {
        id: "s1",
        type: "keyword",
        pattern: "ScrubOnlyTools",
        replacement: "[TOOL_SCRUBBED]",
        scope: "tool",
        enabled: true
    }
]);

const userMsg = scopeFilter.filterText("User mentions ScrubOnlyTools", "user");
assert.strictEqual(userMsg, "User mentions ScrubOnlyTools", "User scope should not be touched");

const toolMsg = scopeFilter.filterText("Tool output has ScrubOnlyTools", "tool");
assert.strictEqual(toolMsg, "Tool output has [TOOL_SCRUBBED]", "Tool scope must be filtered");

console.log("✓ ALL CONTEXT FILTER TESTS PASSED CLEANLY!");

