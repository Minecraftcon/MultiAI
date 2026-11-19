const assert = require("assert");
const { parseToolCallArgs, normalizeToolCalls } = require("../src/providers/llm/tool_extractor");

console.log("=== Running Tool Argument Robustness & Recovery Tests ===");

// 1. Trailing comma recovery
const trailingCommaStr = '{"command":"ANDROID_AVD_HOME=${ANDROID_AVD_HOME:-unset}","task_name":"List AVDs",}';
const parsed1 = parseToolCallArgs(trailingCommaStr);
assert.strictEqual(parsed1.command, "ANDROID_AVD_HOME=${ANDROID_AVD_HOME:-unset}", "Must recover command despite trailing comma");
assert.strictEqual(parsed1.task_name, "List AVDs", "Must recover task_name despite trailing comma");
console.log("✓ Trailing comma recovery passed");

// 2. Nested arguments wrapper unwrapping
const nestedArgsStr = '{"arguments":{"command":"emulator -list-avds","task_name":"List AVDs"}}';
const parsed2 = parseToolCallArgs(nestedArgsStr);
assert.strictEqual(parsed2.command, "emulator -list-avds", "Must unwrap nested arguments.command");
assert.strictEqual(parsed2.task_name, "List AVDs", "Must unwrap nested arguments.task_name");
console.log("✓ Nested arguments wrapper unwrapping passed");

// 3. Nested parameters wrapper unwrapping
const nestedParamsStr = '{"parameters":{"command":"adb devices"}}';
const parsed3 = parseToolCallArgs(nestedParamsStr);
assert.strictEqual(parsed3.command, "adb devices", "Must unwrap nested parameters.command");
console.log("✓ Nested parameters wrapper unwrapping passed");

// 4. Nested input wrapper unwrapping
const nestedInputObj = { input: { command: "uptime" } };
const parsed4 = parseToolCallArgs(nestedInputObj);
assert.strictEqual(parsed4.command, "uptime", "Must unwrap nested input.command from object");
console.log("✓ Nested input wrapper unwrapping passed");

// 5. Normalization of tool calls with trailing commas and CommandLine alias
const rawCalls = [
    {
        id: "call_123",
        function: {
            name: "run_command",
            arguments: '{"CommandLine": "avdmanager list avd", "task_name": "Full AVD audit",}'
        }
    },
    {
        id: "call_456",
        function: {
            name: "bash",
            arguments: '{"arguments": {"command": "echo test"}}'
        }
    }
];

const normalized = normalizeToolCalls(rawCalls);
assert.strictEqual(normalized[0].function.name, "run_task", "run_command must normalize to run_task");
const args1 = JSON.parse(normalized[0].function.arguments);
assert.strictEqual(args1.command, "avdmanager list avd", "CommandLine must normalize to command");

assert.strictEqual(normalized[1].function.name, "run_task", "bash must normalize to run_task");
const args2 = JSON.parse(normalized[1].function.arguments);
assert.strictEqual(args2.command, "echo test", "Nested arguments must be flattened and command extracted");
console.log("✓ Normalization of tool calls with aliases and nested wrappers passed");

console.log("ALL TOOL ARGUMENT ROBUSTNESS TESTS PASSED CLEANLY!");
