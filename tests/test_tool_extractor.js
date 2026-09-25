const assert = require("assert");
const BaseProvider = require("../src/providers/llm/base");

const provider = new BaseProvider();

console.log("=== Running Safety Net Tests for Tool Extractor & BaseProvider ===");

// 1. parseToolCallArgs
console.log("Test: parseToolCallArgs");
{
    // Standard JSON
    const res1 = provider.parseToolCallArgs('{"query": "node.js", "limit": 10}');
    assert.strictEqual(res1.query, "node.js");
    assert.strictEqual(res1.limit, 10);

    // Key-value delimited
    const res2 = provider.parseToolCallArgs('query: "antigravity" count: 5 active: true done: false empty: null');
    assert.strictEqual(res2.query, "antigravity");
    assert.strictEqual(res2.count, 5);
    assert.strictEqual(res2.active, true);
    assert.strictEqual(res2.done, false);
    assert.strictEqual(res2.empty, null);

    // Delimited with <|"|> quotes
    const res3 = provider.parseToolCallArgs('command:<|"|>echo "hello world" && ls<|"|> timeout:30');
    assert.strictEqual(res3.command, 'echo "hello world" && ls');
    assert.strictEqual(res3.timeout, 30);

    // Empty or non-string
    assert.deepStrictEqual(provider.parseToolCallArgs(""), {});
    assert.deepStrictEqual(provider.parseToolCallArgs(null), {});
}

// 2. extractToolCallsFromText
console.log("Test: extractToolCallsFromText");
{
    // GLM-4 / Hermes section-begin
    const text1 = `<|tool_calls_section_begin|>
<|tool_call_begin|>functions.web_search:0<|tool_call_argument_begin|>{"query": "MultiAI"}<|tool_call_end|>
<|tool_calls_section_end|>
I will now search for MultiAI.`;
    const res1 = provider.extractToolCallsFromText(text1);
    assert.strictEqual(res1.toolCalls.length, 1);
    assert.strictEqual(res1.toolCalls[0].function.name, "web_search");
    assert.strictEqual(JSON.parse(res1.toolCalls[0].function.arguments).query, "MultiAI");
    assert.strictEqual(res1.cleanedText, "I will now search for MultiAI.");

    // Orphaned tool_call_begin
    const text2 = `<|tool_call_begin|>run_task<|tool_call_argument_begin|>{"command": "git status"}<|tool_call_end|>Checking git`;
    const res2 = provider.extractToolCallsFromText(text2);
    assert.strictEqual(res2.toolCalls.length, 1);
    assert.strictEqual(res2.toolCalls[0].function.name, "run_task");
    assert.strictEqual(JSON.parse(res2.toolCalls[0].function.arguments).command, "git status");

    // Template tokens <|tool_call>call:NAME{...}
    const text3 = `Searching for code: <|tool_call>call:grep_search{query:"export",path:"src"}<tool_call|>`;
    const res3 = provider.extractToolCallsFromText(text3);
    assert.strictEqual(res3.toolCalls.length, 1);
    assert.strictEqual(res3.toolCalls[0].function.name, "grep_search");
    const args3 = JSON.parse(res3.toolCalls[0].function.arguments);
    assert.strictEqual(args3.query, "export");
    assert.strictEqual(args3.path, "src");

    // XML wrapped <tool_call>
    const text4 = `<tool_call>{"name": "write_file", "arguments": {"path": "hello.txt", "content": "world"}}</tool_call>`;
    const res4 = provider.extractToolCallsFromText(text4);
    assert.strictEqual(res4.toolCalls.length, 1);
    assert.strictEqual(res4.toolCalls[0].function.name, "write_file");
    const args4 = JSON.parse(res4.toolCalls[0].function.arguments);
    assert.strictEqual(args4.path, "hello.txt");

    // Bracketed tool request format
    const text5 = `Let me run this: [tool_call] run_task(command: "npm test")`;
    const res5 = provider.extractToolCallsFromText(text5);
    assert.strictEqual(res5.toolCalls.length, 1);
    assert.strictEqual(res5.toolCalls[0].function.name, "run_task");
    const args5 = JSON.parse(res5.toolCalls[0].function.arguments);
    assert.strictEqual(args5.command, "npm test");

    // Protected code blocks (should NOT be extracted)
    const text6 = "Here is an example:\n```javascript\nconst res = run_task({ command: 'rm -rf /' });\n```\nDone.";
    const res6 = provider.extractToolCallsFromText(text6);
    assert.strictEqual(res6.toolCalls.length, 0);
    assert(res6.cleanedText.includes("const res = run_task"));
}

// 3. normalizeToolCalls
console.log("Test: normalizeToolCalls");
{
    const rawCalls = [
        { name: "bash", arguments: '{"cmd": "ls -la"}' },
        { name: "cat", arguments: '{"file": "README.md"}' },
        { name: "create_file", arguments: '{"filepath": "test.txt", "content": "hello"}' },
        { name: "edit_file", arguments: '{"file": "test.txt"}' },
        { name: "find_in_files", arguments: '{"query": "foo"}' },
        { name: "fetch_url", arguments: '{"url": "https://example.com"}' },
        { name: "google_search", arguments: '{"query": "ai news"}' },
        { name: "read_task_command</arg_key><arg_value>pwd</arg_value>", arguments: "{}" }
    ];

    const normalized = provider.normalizeToolCalls(rawCalls);
    assert.strictEqual(normalized[0].function.name, "run_task");
    assert.strictEqual(JSON.parse(normalized[0].function.arguments).command, "ls -la");

    assert.strictEqual(normalized[1].function.name, "read_file");
    assert.strictEqual(JSON.parse(normalized[1].function.arguments).path, "README.md");

    assert.strictEqual(normalized[2].function.name, "write_file");
    assert.strictEqual(JSON.parse(normalized[2].function.arguments).path, "test.txt");

    assert.strictEqual(normalized[3].function.name, "search_and_replace");
    assert.strictEqual(JSON.parse(normalized[3].function.arguments).path, "test.txt");

    assert.strictEqual(normalized[4].function.name, "grep_search");

    assert.strictEqual(normalized[5].function.name, "web_search");
    assert.strictEqual(JSON.parse(normalized[5].function.arguments).type, "fetch");

    assert.strictEqual(normalized[6].function.name, "web_search");
    assert.strictEqual(JSON.parse(normalized[6].function.arguments).type, "search");

    assert.strictEqual(normalized[7].function.name, "run_task");
    assert.strictEqual(JSON.parse(normalized[7].function.arguments).command, "pwd");
}

// 4. cleanPromptContent
console.log("Test: cleanPromptContent");
{
    const promptWithThought = `
<details class="thought-box" open>
<summary class="thought-summary">Thinking</summary>
<div class="thought-body"><div class="thought-content">
Let me think through this problem step by step.
</div></div>
</details>

Here is the final answer.`;

    const cleaned = provider.cleanPromptContent(promptWithThought);
    assert(cleaned.includes("<think>"));
    assert(cleaned.includes("Let me think through this problem step by step."));
    assert(cleaned.includes("Here is the final answer."));
    assert(!cleaned.includes("<details"));
}

// 5. extractImageFromToolResult
console.log("Test: extractImageFromToolResult");
{
    const toolResult = JSON.stringify({
        type: "image",
        mime: "image/png",
        data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        path: "generated.png",
        size_bytes: 68,
        human_size: "68 B"
    });

    const img = BaseProvider.extractImageFromToolResult(toolResult);
    assert.strictEqual(img.mime, "image/png");
    assert(img.base64.startsWith("iVBORw0"));
    assert.strictEqual(img.path, "generated.png");
}

console.log("✓ ALL SAFETY NET TESTS PASSED CLEANLY!");
