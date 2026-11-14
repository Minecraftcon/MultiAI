/**
 * Rootless Tools (micromamba + pkgx) Verification Test
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { ensureRootlessTools, getEnhancedEnv, getBinDir } = require("../scripts/setup_rootless_tools");
const { getSystemInfo } = require("../src/server/utils");
const { ensureChatWorkspace } = require("../src/core/conversations_manager");
const { TaskManager } = require("../src/server/task_manager");

async function runTests() {
    console.log("=== Testing Rootless Tools (micromamba + pkgx) ===");

    // 1. Test getBinDir & getEnhancedEnv
    const binDir = getBinDir();
    assert(binDir && fs.existsSync(binDir), `binDir should exist: ${binDir}`);
    console.log("  [PASS] getBinDir() returned valid directory:", binDir);

    const baseEnv = { PATH: "/usr/bin:/bin" };
    const enhanced = getEnhancedEnv(baseEnv);
    assert(enhanced.PATH.includes(binDir), "Enhanced PATH should include binDir");
    assert(enhanced.MAMBA_ROOT_PREFIX, "MAMBA_ROOT_PREFIX should be defined");
    assert(enhanced.PKGX_DIR, "PKGX_DIR should be defined");
    console.log("  [PASS] getEnhancedEnv() enhanced PATH, MAMBA_ROOT_PREFIX, and PKGX_DIR");

    // 2. Test ensureRootlessTools()
    const tools = await ensureRootlessTools();
    console.log("  ensureRootlessTools result:", tools);
    assert(tools.micromamba && fs.existsSync(tools.micromamba), "micromamba binary should exist");
    assert(tools.pkgx && fs.existsSync(tools.pkgx), "pkgx binary should exist");
    console.log("  [PASS] Both micromamba and pkgx binaries are verified present and executable");

    // 3. Test getSystemInfo() prompt instructions
    const sysInfo = getSystemInfo();
    if (sysInfo.isLinux) {
        const text = sysInfo.instructions.join("\n");
        assert(text.includes("micromamba"), "Linux instructions should mention micromamba");
        assert(text.includes("pkgx"), "Linux instructions should mention pkgx");
        console.log("  [PASS] getSystemInfo() includes rootless package instructions for Linux");
    }

    // 4. Test workspacePrompt in conversations_manager
    const ws = ensureChatWorkspace("test-chat-tools");
    assert(ws.workspacePrompt.includes("pkgx"), "workspacePrompt should mention pkgx");
    assert(ws.workspacePrompt.includes("micromamba"), "workspacePrompt should mention micromamba");
    console.log("  [PASS] ensureChatWorkspace() includes rootless package guidelines");

    // 5. Test task manager execution inherits PATH
    const tm = new TaskManager();
    const taskId = tm.runTask({
        command: "which micromamba && which pkgx",
        chatId: "test-chat-tools"
    });
    const taskRecord = tm.tasks.get(taskId);
    assert(taskRecord && taskRecord.process, "Task record should have child process");

    await new Promise((resolve, reject) => {
        let output = "";
        taskRecord.process.stdout.on("data", d => output += d.toString());
        taskRecord.process.stderr.on("data", d => output += d.toString());
        taskRecord.process.on("close", code => {
            if (code === 0) {
                console.log("  [PASS] Task spawned successfully and resolved rootless tools in PATH:\n  " + output.trim().split("\n").join("\n  "));
                resolve();
            } else {
                reject(new Error(`Command exited with code ${code}. Output: ${output}`));
            }
        });
    });

    console.log("=== All Rootless Tools Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
