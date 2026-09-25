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

    // 5a. Valid 1x1 test image
    const img = BaseProvider.extractImageFromToolResult(toolResult);
    assert.strictEqual(img.mime, "image/png");
    assert(img.base64.startsWith("iVBORw0"));
    assert.strictEqual(img.path, "generated.png");

    // 5b. Corrupted / Truncated image should return null
    const truncatedPayload1 = `{"type":"image","mime":"image/png","data_url":"data:image/png;base64,iVBORw0KGgo\n\n[... Output truncated to fit model context window ...]\n\nASUVORK5CYII="}`;
    assert.strictEqual(BaseProvider.extractImageFromToolResult(truncatedPayload1), null);

    const truncatedPayload2 = `{"type":"image","mime":"image/png","data_url":"data:image/png;base64,iVBORw0KGgo[... OMITTED 50000 CHARS ...]CYII="}`;
    assert.strictEqual(BaseProvider.extractImageFromToolResult(truncatedPayload2), null);

    // 5c. Large image in older turn must NOT be sliced by pruneMessagesForContext
    const largeB64 = "iVBORw0KGgoAAAANSUhEUgAA" + "A".repeat(8000) + "ASUVORK5CYII=";
    const testMessages = [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: "Take a screenshot" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "screenshot", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ type: "image", mime: "image/png", data_url: `data:image/png;base64,${largeB64}` }) },
        { role: "assistant", content: "Here is your screenshot." },
        { role: "user", content: "Now do step 2" }
    ];

    const pruned = provider.pruneMessagesForContext(testMessages, 4000, { maxToolChars: 2000 });
    const toolMsg = pruned.find(m => m.role === "tool");
    assert(!toolMsg.content.includes("[... Output truncated"), "Tool image payload must not be truncated by pruneMessagesForContext");
    assert(toolMsg.content.includes("data:image/png;base64,"), "Tool image base64 must remain intact");

    // 5d. normalizeMessages with vision support must successfully extract image and clean tool message
    const normalized = provider.normalizeMessages(pruned, true, true);
    const userImgMsg = normalized.find(m => m.role === "user" && Array.isArray(m.content) && m.content.some(c => c.type === "image_url"));
    assert(userImgMsg, "Image should be extracted and attached as user vision message");
    const normToolMsg = normalized.find(m => m.role === "tool");
    assert(!normToolMsg.content.includes(largeB64), "Normalized tool message should have base64 stripped out");
    assert(normToolMsg.content.includes('"type":"image"'), "Normalized tool message should retain metadata");
}

(async () => {
    // 5e. Base64 payload with line breaks (MIME style) must be handled cleanly
    const b64WithNewlines = "iVBORw0KGgoAAAANSUhEUgAA\r\n" + "A".repeat(100) + "\nASUVORK5CYII=";
    const newlineImgPayload = JSON.stringify({
        type: "image",
        mime: "image/png",
        data_url: `data:image/png;base64,${b64WithNewlines}`,
        path: "wrapped.png"
    });
    const parsedNewlineImg = BaseProvider.extractImageFromToolResult(newlineImgPayload);
    assert(parsedNewlineImg, "Must parse image with wrapped newlines");
    assert(!parsedNewlineImg.base64.includes("\n"), "Must strip newlines from base64 string");
    assert(!parsedNewlineImg.base64.includes("\r"), "Must strip carriage returns from base64 string");

    // 5f. formatMessagesToTranscript must format image tool result cleanly without slicing base64
    const { formatMessagesToTranscript } = await import("../client/src/agent/compactor.js");
    const transcript = formatMessagesToTranscript([{
        role: "tool",
        name: "read_file",
        content: newlineImgPayload
    }]);
    assert(transcript.includes("[Image file read: wrapped.png (image/png"), "Transcript should summarize image cleanly");
    assert(!transcript.includes("[output truncated for summary]"), "Transcript must not slice base64 with truncation notice");
    assert(!transcript.includes("iVBORw0"), "Transcript must not leak raw base64 characters");

    console.log("✓ ALL SAFETY NET TESTS PASSED CLEANLY!");
})().catch(err => {
    console.error(err);
    process.exit(1);
});

