/**
 * Test Suite for Shadow Git Manager
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const shadowGit = require("../src/core/shadow_git_manager");

async function runTests() {
    console.log("=== Testing Shadow Git Manager ===");

    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-test-ws-"));
    console.log("Created test workspace:", tmpWorkspace);

    try {
        // 1. Ensure shadow repo initializes
        const shadowDir = shadowGit.ensureShadowRepo(tmpWorkspace);
        assert(fs.existsSync(shadowDir), "Shadow git directory must exist");
        console.log(" [PASS] Shadow repo initialized:", shadowDir);

        // 2. Pre-create a file in workspace
        const existingRel = "src/three.js";
        const fullExisting = path.join(tmpWorkspace, existingRel);
        fs.mkdirSync(path.dirname(fullExisting), { recursive: true });
        fs.writeFileSync(fullExisting, "console.log('original three.js');\nconst a = 1;\n", "utf8");

        // 3. Record baseline before edit
        shadowGit.recordPreEditBaseline(tmpWorkspace, existingRel);
        console.log(" [PASS] Baseline recorded for existing file");

        // 4. Modify existing file
        fs.writeFileSync(fullExisting, "console.log('original three.js');\nconst a = 2;\nconst b = 3;\n", "utf8");
        shadowGit.recordPostEditCommit(tmpWorkspace, existingRel, {
            chatId: "test-chat-1",
            tool: "replace_file_content",
            instruction: "Update three.js variables"
        });
        console.log(" [PASS] Post-edit commit recorded");

        // 5. Create a new file
        const newRel = "readme.md";
        const fullNew = path.join(tmpWorkspace, newRel);
        fs.writeFileSync(fullNew, "# MultiAI\nBrand new file.\n", "utf8");
        shadowGit.recordPostEditCommit(tmpWorkspace, newRel, {
            chatId: "test-chat-1",
            tool: "write_file",
            instruction: "Create readme.md"
        });
        console.log(" [PASS] New file commit recorded");

        // 6. Query unaccepted changes
        const unaccepted = shadowGit.getUnacceptedChanges(tmpWorkspace);
        assert.strictEqual(unaccepted.totalFiles, 2, "Expected 2 unaccepted files");
        console.log(" [PASS] Unaccepted changes detected:", unaccepted.files);

        const threeChange = unaccepted.files.find(f => f.path === "src/three.js");
        assert(threeChange, "src/three.js should be in unaccepted changes");
        assert(threeChange.additions >= 2, "Additions should be >= 2");
        assert(threeChange.deletions >= 1, "Deletions should be >= 1");
        console.log(` [PASS] src/three.js diff stats: +${threeChange.additions} -${threeChange.deletions}`);

        // 7. Test unified diff
        const diffText = shadowGit.getUnifiedDiff(tmpWorkspace, existingRel);
        assert(diffText.includes("+const a = 2;"), "Diff must include new lines");
        console.log(" [PASS] Unified diff retrieved successfully");

        // 8. Test Timeline
        const timeline = shadowGit.getFileHistoryTimeline(tmpWorkspace);
        assert(Array.isArray(timeline) && timeline.length >= 2, "Timeline must contain files");
        console.log(" [PASS] Timeline generated with files:", timeline.map(t => t.path));

        // 9. Revert existing file
        const revResult = shadowGit.revertFile(tmpWorkspace, existingRel);
        assert.strictEqual(revResult.status, "success");
        const restoredContent = fs.readFileSync(fullExisting, "utf8");
        assert.strictEqual(restoredContent, "console.log('original three.js');\nconst a = 1;\n", "File content must match baseline exactly");
        console.log(" [PASS] Revert restored original file content with 100% byte fidelity");

        // 10. Revert new file
        shadowGit.revertFile(tmpWorkspace, newRel);
        assert(!fs.existsSync(fullNew), "Reverted new file must be removed from disk");
        console.log(" [PASS] Revert new file removed it from disk");

        // 11. Test acceptChanges
        // Make an edit again
        fs.writeFileSync(fullExisting, "console.log('accepted edit');\n", "utf8");
        shadowGit.recordPostEditCommit(tmpWorkspace, existingRel, { instruction: "Accepted edit" });
        const beforeAccept = shadowGit.getUnacceptedChanges(tmpWorkspace);
        assert.strictEqual(beforeAccept.totalFiles, 1);

        shadowGit.acceptChanges(tmpWorkspace);
        const afterAccept = shadowGit.getUnacceptedChanges(tmpWorkspace);
        assert.strictEqual(afterAccept.totalFiles, 0, "Unaccepted changes must be 0 after acceptChanges");
        console.log(" [PASS] acceptChanges successfully cleared unaccepted changes");

        console.log("\nALL SHADOW GIT MANAGER TESTS PASSED!");
    } finally {
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
        const shadowDir = shadowGit.getShadowGitDir(tmpWorkspace);
        if (fs.existsSync(shadowDir)) {
            fs.rmSync(shadowDir, { recursive: true, force: true });
        }
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
