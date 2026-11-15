const assert = require("assert");
const { resolveProvider } = require("../src/providers");
const BaseProvider = require("../src/providers/llm/base");
const GoogleProvider = require("../src/providers/llm/google");
const AnthropicProvider = require("../src/providers/llm/anthropic");
const GroqProvider = require("../src/providers/llm/groq");

console.log("=== Testing Temporary System Instructions Hierarchy (system_server) ===");

// 1. Test BaseProvider with plain string system_server
const baseProvider = new BaseProvider();
const basePayload = baseProvider.formatPayload({
    model: "test-model",
    messages: [
        { role: "system", content: "You are MultiAI base assistant." },
        { role: "user", content: "Hello" }
    ],
    options: {
        system_server: "Active Daemon PID: 12345. Do not terminate."
    }
});

assert.strictEqual(basePayload.messages.length, 2);
assert.strictEqual(basePayload.messages[0].role, "system");
assert.ok(basePayload.messages[0].content.includes("You are MultiAI base assistant."));
assert.ok(basePayload.messages[0].content.includes("<system_server>"));
assert.ok(basePayload.messages[0].content.includes("Active Daemon PID: 12345. Do not terminate."));
console.log("✓ BaseProvider plain string system_server passed");

// 2. Test BaseProvider with structured object (scope, priority, instruction)
const structuredPayload = baseProvider.formatPayload({
    model: "test-model",
    messages: [
        { role: "user", content: "Fix bug" }
    ],
    options: {
        system_server: {
            scope: "verification",
            priority: "critical",
            instruction: "Ensure all tests pass before replying."
        }
    }
});

assert.strictEqual(structuredPayload.messages[0].role, "system");
assert.ok(structuredPayload.messages[0].content.includes("[Scope: verification]"));
assert.ok(structuredPayload.messages[0].content.includes("[Priority: critical]"));
assert.ok(structuredPayload.messages[0].content.includes("Ensure all tests pass before replying."));
console.log("✓ BaseProvider structured object (scope/priority/instruction) passed");

// 3. Test BaseProvider with hierarchy object (server + ephemeral)
const hierarchyPayload = baseProvider.formatPayload({
    model: "test-model",
    messages: [
        { role: "system", content: "Base Persona." },
        { role: "user", content: "Do work" }
    ],
    options: {
        system_instructions: {
            server: "Standing directive: safe mode active.",
            ephemeral: "Previous tool output was truncated, use ByteOffset to continue."
        }
    }
});

assert.ok(hierarchyPayload.messages[0].content.includes("Standing directive: safe mode active."));
assert.ok(hierarchyPayload.messages[0].content.includes("[EPHEMERAL RUNTIME DIRECTIVE]"));
assert.ok(hierarchyPayload.messages[0].content.includes("Previous tool output was truncated"));
console.log("✓ BaseProvider hierarchy object (server + ephemeral) passed");

// 4. Test GoogleProvider (Gemini multi-part systemInstruction)
const googleProvider = new GoogleProvider();
const googlePayload = googleProvider.formatPayload({
    model: "gemini-2.5-flash",
    messages: [
        { role: "system", content: "You are Gemini agent." },
        { role: "user", content: "Hello" }
    ],
    options: {
        system_server: {
            scope: "sandbox",
            instruction: "Direct host execution profile."
        }
    }
});

assert.ok(googlePayload.systemInstruction, "Google payload must have systemInstruction");
assert.strictEqual(googlePayload.systemInstruction.parts.length, 2);
assert.strictEqual(googlePayload.systemInstruction.parts[0].text, "You are Gemini agent.");
assert.ok(googlePayload.systemInstruction.parts[1].text.includes("[SYSTEM_SERVER DIRECTIVE]"));
assert.ok(googlePayload.systemInstruction.parts[1].text.includes("Direct host execution profile."));
console.log("✓ GoogleProvider native multi-part systemInstruction passed");

// 4.B Test GoogleProvider thought_signature retention in functionCall parts
const googleToolPayload = googleProvider.formatPayload({
    model: "gemini-2.5-flash",
    messages: [
        { role: "user", content: "Write a test file" },
        {
            role: "assistant",
            content: "Writing file...",
            tool_calls: [{
                id: "call_abc123",
                type: "function",
                function: { name: "write_file", arguments: '{"path":"test.txt"}' },
                thoughtSignature: "cryptographic_thought_sig_xyz"
            }]
        },
        {
            role: "tool",
            tool_call_id: "call_abc123",
            name: "write_file",
            content: '{"success":true}'
        }
    ]
});

const assistantContent = googleToolPayload.contents.find(c => c.role === "model");
assert.ok(assistantContent, "Model content turn must exist");
const fcPart = assistantContent.parts.find(p => p.functionCall);
assert.ok(fcPart, "functionCall part must exist");
assert.strictEqual(fcPart.functionCall.name, "write_file");
assert.strictEqual(fcPart.thoughtSignature, "cryptographic_thought_sig_xyz");
assert.strictEqual(fcPart.thought_signature, "cryptographic_thought_sig_xyz");
console.log("✓ GoogleProvider thought_signature retention in functionCall parts passed");

// 5. Test AnthropicProvider (Claude <system_server> integration)
const anthropicProvider = new AnthropicProvider();
const anthropicPayload = anthropicProvider.formatPayload({
    model: "claude-3-7-sonnet",
    messages: [
        { role: "system", content: "Base Claude Persona." },
        { role: "user", content: "Hello" }
    ],
    options: {
        system_server: ["First server directive.", "Second server directive."]
    }
});

assert.ok(anthropicPayload.system, "Anthropic payload must have system prompt");
assert.ok(anthropicPayload.system.includes("Base Claude Persona."));
assert.ok(anthropicPayload.system.includes("<system_server>"));
assert.ok(anthropicPayload.system.includes("First server directive."));
assert.ok(anthropicPayload.system.includes("Second server directive."));
console.log("✓ AnthropicProvider <system_server> integration passed");

// 6. Test GroqProvider (both emulated and direct modes)
const groqProvider = new GroqProvider();
const groqPayload = groqProvider.formatPayload({
    model: "llama-3.3-70b-versatile",
    messages: [
        { role: "system", content: "Groq Base System." },
        { role: "user", content: "Hello" }
    ],
    options: {
        system_server: "Groq server constraint: strict json format."
    }
});

assert.ok(groqPayload.messages[0].content.includes("Groq Base System."));
assert.ok(groqPayload.messages[0].content.includes("<system_server>"));
assert.ok(groqPayload.messages[0].content.includes("Groq server constraint: strict json format."));
console.log("✓ GroqProvider system_server integration passed");

// 7. Test User Editor Cursor Position & Terminal Output in system_server
const userContextPayload = baseProvider.formatPayload({
    model: "test-model",
    messages: [
        { role: "system", content: "Base Persona." },
        { role: "user", content: "Why is line 42 throwing an error?" }
    ],
    options: {
        system_server: [
            {
                scope: "user_editor_context",
                priority: "medium",
                instruction: "[USER ACTIVE EDITOR CONTEXT]:\nFile: \"src/index.js\" (user is actively editing)\nCursor Position: Line 42, Column 18 (Total lines: 75)\nCurrent Line Content: const port = config.port;\nUser Selected Text:\n\"\"\"\nconfig.port\n\"\"\""
            },
            {
                scope: "user_terminal_context",
                priority: "medium",
                instruction: "[USER RECENT TERMINAL CONTEXT]:\nStatus: Terminal window is currently OPEN/VISIBLE\nSession: bash-1\nRecent Output Buffer:\n```\n$ node src/index.js\nTypeError: Cannot read properties of undefined (reading 'port')\n    at startServer (src/index.js:42:18)\n```"
            }
        ]
    }
});

assert.strictEqual(userContextPayload.messages[0].role, "system");
assert.ok(userContextPayload.messages[0].content.includes("[USER ACTIVE EDITOR CONTEXT]"));
assert.ok(userContextPayload.messages[0].content.includes("File: \"src/index.js\""));
assert.ok(userContextPayload.messages[0].content.includes("Cursor Position: Line 42, Column 18"));
assert.ok(userContextPayload.messages[0].content.includes("[USER RECENT TERMINAL CONTEXT]"));
assert.ok(userContextPayload.messages[0].content.includes("TypeError: Cannot read properties of undefined"));
console.log("✓ User Editor Cursor & Terminal History in system_server passed cleanly");

console.log("\nALL TEMPORARY SYSTEM INSTRUCTIONS HIERARCHY TESTS PASSED CLEANLY!");

