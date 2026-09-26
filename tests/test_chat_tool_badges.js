const assert = require("assert");

// Dynamic import for ES modules in Node.js
async function runTests() {
    console.log("=== Running Characterization Tests for Chat Tool Badges ===");

    const badgesModule = await import("../client/src/components/chat-tool-badges.js");
    const { getToolBadgeConfig } = badgesModule;

    assert(typeof getToolBadgeConfig === "function", "getToolBadgeConfig must be exported as a function");

    // 1. web_search
    console.log("Test: web_search");
    {
        const cfg1 = getToolBadgeConfig("web_search", { query: "MultiAI documentation" });
        assert.strictEqual(cfg1.icon, "search");
        assert.strictEqual(cfg1.label, "Searched for");
        assert.strictEqual(cfg1.detail, "MultiAI documentation");
        assert.strictEqual(cfg1.isCommandTask, true);

        const cfg2 = getToolBadgeConfig("web_search", { query: "https://github.com", type: "fetch" });
        assert.strictEqual(cfg2.icon, "globe");
        assert.strictEqual(cfg2.label, "Fetched");
    }

    // 2. run_task / run_command
    console.log("Test: run_task & run_command");
    {
        const cfg1 = getToolBadgeConfig("run_task", { task_name: "Build Project", command: "npm run build" });
        assert.strictEqual(cfg1.icon, "play");
        assert.strictEqual(cfg1.label, "Ran command");
        assert.strictEqual(cfg1.detail, "Build Project");
        assert.strictEqual(cfg1.isRunTaskWithTitle, "Build Project");
        assert.strictEqual(cfg1.hasRing, true);
        assert.strictEqual(cfg1.displayCmd, "npm run build");

        const cfg2 = getToolBadgeConfig("run_command", { command: "ls -la" });
        assert.strictEqual(cfg2.detail, "ls -la");
        assert.strictEqual(cfg2.displayCmd, "ls -la");
    }

    // 3. manage_tasks
    console.log("Test: manage_tasks");
    {
        const killCfg = getToolBadgeConfig("manage_tasks", { action: "kill_task", task_id: "task-123" });
        assert.strictEqual(killCfg.icon, "octagon");
        assert.strictEqual(killCfg.label, "Killed task");
        assert.strictEqual(killCfg.detail, "task-123");

        const keyCfg = getToolBadgeConfig("manage_tasks", { action: "send_input", task_id: "task-123", key: "Enter" });
        assert.strictEqual(keyCfg.icon, "keyboard");
        assert.strictEqual(keyCfg.label, "Sent key");

        const textCfg = getToolBadgeConfig("manage_tasks", { action: "send_input", task_id: "task-123", input: "my input" });
        assert.strictEqual(textCfg.icon, "keyboard");
        assert.strictEqual(textCfg.label, "Sent input");
    }

    // 4. File tools
    console.log("Test: file tools");
    {
        const readCfg = getToolBadgeConfig("read_file", { path: "src/index.js", start_line: 10, end_line: 50 });
        assert.strictEqual(readCfg.icon, "file-text");
        assert.strictEqual(readCfg.label, "Read file");
        assert.strictEqual(readCfg.detail, "src/index.js (lines 10-50)");
        assert.strictEqual(readCfg.displayCmd, "READ: src/index.js (lines 10-50)");

        const readImageCfg = getToolBadgeConfig("read_file", { path: "screenshot.png" });
        assert.strictEqual(readImageCfg.icon, "image");
        assert.strictEqual(readImageCfg.label, "Viewed Image");
        assert.strictEqual(readImageCfg.detail, "screenshot.png");
        assert.strictEqual(readImageCfg.displayCmd, "VIEW IMAGE: screenshot.png");

        const readImageWithMimeCfg = getToolBadgeConfig("read_file", { path: "/tmp/plot", mime: "image/jpeg" });
        assert.strictEqual(readImageWithMimeCfg.icon, "image");
        assert.strictEqual(readImageWithMimeCfg.label, "Viewed Image");
        assert.strictEqual(readImageWithMimeCfg.displayCmd, "VIEW IMAGE: /tmp/plot");

        const writeArtifactCfg = getToolBadgeConfig("write_file", { path: "$ARTIFACTS/plan.md" });
        assert.strictEqual(writeArtifactCfg.icon, "file-code");
        assert.strictEqual(writeArtifactCfg.label, "Wrote artifact");
        assert.strictEqual(writeArtifactCfg.isArtifact, true);

        const writeNormalCfg = getToolBadgeConfig("write_file", { path: "src/utils.js" });
        assert.strictEqual(writeNormalCfg.icon, "file-edit");
        assert.strictEqual(writeNormalCfg.label, "Wrote file");
        assert.strictEqual(writeNormalCfg.isArtifact, false);

        const editCfg = getToolBadgeConfig("replace_file_content", { path: "src/index.js", description: "fix port bug" });
        assert.strictEqual(editCfg.icon, "edit-3");
        assert.strictEqual(editCfg.label, "Edited file");
        assert.strictEqual(editCfg.displayCmd, "EDIT: src/index.js (fix port bug)");

        const listDirCfg = getToolBadgeConfig("list_dir", { DirectoryPath: "src" });
        assert.strictEqual(listDirCfg.icon, "folder");
        assert.strictEqual(listDirCfg.label, "Listed directory");
        assert.strictEqual(listDirCfg.detail, "src");
        assert.strictEqual(listDirCfg.displayCmd, "LIST DIR: src");
    }

    // 5. Timer tools
    console.log("Test: timer tools");
    {
        const sleepCfg = getToolBadgeConfig("sleep", { seconds: 10 });
        assert.strictEqual(sleepCfg.icon, "clock");
        assert.strictEqual(sleepCfg.hasRing, true);
        assert.strictEqual(sleepCfg.isTimer, true);

        const idleCfg = getToolBadgeConfig("idle", { seconds: 5, task_id: "build-proc" });
        assert.strictEqual(idleCfg.icon, "hourglass");
        assert.strictEqual(idleCfg.hasRing, true);
        assert.strictEqual(idleCfg.label, "Waiting for task…");
    }

    // 6. formatToolResult formatting
    console.log("Test: formatToolResult running status and exit code");
    {
        const domModule = await import("../client/src/utils/dom.js");
        const { formatToolResult } = domModule;

        // When task is running: status: running must appear, exit_code must be omitted completely
        const runningResult = formatToolResult({
            task_id: "task_12345",
            running: true,
            exit_code: null,
            stdout: "server listening on port 3000\n",
            elapsed_seconds: 5.0
        });
        assert(runningResult.includes("status: running"), "Running task must include 'status: running'");
        assert(!runningResult.includes("exit_code"), "Running task must omit exit_code completely");
        assert(runningResult.includes("task_id: task_12345"), "Must include task_id");

        // When task is completed: status: running must not appear, exit_code must appear
        const completedResult = formatToolResult({
            task_id: "task_12345",
            running: false,
            exit_code: 0,
            stdout: "build completed successfully\n",
            elapsed_seconds: 2.1
        });
        assert(!completedResult.includes("status: running"), "Completed task must not include 'status: running'");
        assert(completedResult.includes("exit_code: 0"), "Completed task must include 'exit_code: 0'");
    }

    // 7. list_dir execution & read_file directory rejection
    console.log("Test: list_dir execution and read_file directory rejection");
    {
        const { handleListDir, handleFileRead } = require("../src/server/routes/files.js");
        const { resolveSafePath } = require("../src/server/utils.js");

        // 1. handleListDir on tests directory
        const listRes = await handleListDir({ DirectoryPath: "tests" }, "", { resolveSafePath });
        assert(listRes.subdirectories >= 0, "Must count subdirectories");
        assert(listRes.files > 0, "Must count files in tests");
        assert(listRes.output.includes("Summary: This directory contains"), "Output must contain summary");
        assert(listRes.entries.some(e => e.name === "test_chat_tool_badges.js"), "Entries must include this test file");

        // 2. handleListDir on a non-directory file should throw
        let fileErr = null;
        try {
            await handleListDir({ DirectoryPath: "package.json" }, "", { resolveSafePath });
        } catch (e) {
            fileErr = e;
        }
        assert(fileErr, "handleListDir must reject non-directory file");
        assert(fileErr.message.includes("is a file, not a directory"), "Error must state path is a file");

        // 3. handleFileRead on a directory should throw
        let dirErr = null;
        try {
            await handleFileRead({ path: "tests" }, "");
        } catch (e) {
            dirErr = e;
        }
        assert(dirErr, "handleFileRead must reject directory");
        assert(dirErr.message.includes("is a directory, not a file"), "Error must state path is a directory");
    }

    console.log("✓ ALL CHAT TOOL BADGES CHARACTERIZATION TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
