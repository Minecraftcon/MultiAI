const fs = require("fs");
const path = require("path");
const assert = require("assert");
const os = require("os");

const { resolveSafePath, getChatScratchDir } = require("../src/server/utils");

console.log("=== Testing Workspace Scratch Feature Adaptation ===");

const testWorkdir = path.join(os.tmpdir(), "multiai_test_workspace_" + Date.now());
fs.mkdirSync(testWorkdir, { recursive: true });
process.env.MULTIAI_WORKSPACE_DIR = testWorkdir;

const testChatId = "test_chat_scratch_" + Date.now();

// 1. Verify getChatScratchDir returns testWorkdir/scratch
console.log("1. Verifying getChatScratchDir maps to workspace root ./scratch...");
const scratchDir = getChatScratchDir(testChatId);
assert.strictEqual(scratchDir, path.join(testWorkdir, "scratch"), "getChatScratchDir should return workspace/scratch");
assert.ok(fs.existsSync(scratchDir), "scratch directory should be created on disk");
console.log("   ✓ Scratch dir resolved and created at:", scratchDir);

// 2. Verify path resolution for 'scratch/test.py', './scratch/test.py', and '$SCRATCH/test.py'
console.log("2. Verifying path resolution consistency...");
const pathA = resolveSafePath("scratch/script.py", testChatId);
const pathB = resolveSafePath("./scratch/script.py", testChatId);
const pathC = resolveSafePath("$SCRATCH/script.py", testChatId);
const pathD = resolveSafePath("${SCRATCH}/script.py", testChatId);

assert.strictEqual(pathA, path.join(testWorkdir, "scratch", "script.py"), "pathA mismatch");
assert.strictEqual(pathB, path.join(testWorkdir, "scratch", "script.py"), "pathB mismatch");
assert.strictEqual(pathC, path.join(testWorkdir, "scratch", "script.py"), "pathC mismatch");
assert.strictEqual(pathD, path.join(testWorkdir, "scratch", "script.py"), "pathD mismatch");
console.log("   ✓ All representations (scratch/, ./scratch/, $SCRATCH/) resolve to identical disk location!");

// 3. Verify .gitignore auto-population when workspace is a git repo
console.log("3. Verifying .gitignore auto-population for git repos...");
const gitDir = path.join(testWorkdir, ".git");
fs.mkdirSync(gitDir, { recursive: true });
// Re-trigger getChatScratchDir
getChatScratchDir(testChatId);
const gitignoreFile = path.join(testWorkdir, ".gitignore");
assert.ok(fs.existsSync(gitignoreFile), ".gitignore should exist");
const gitignoreContent = fs.readFileSync(gitignoreFile, "utf8");
assert.ok(gitignoreContent.includes("scratch/"), ".gitignore should ignore scratch/");
console.log("   ✓ scratch/ automatically added to workspace .gitignore!");

// Cleanup
try {
    fs.rmSync(testWorkdir, { recursive: true, force: true });
} catch (_) {}

console.log("\n✓ ALL WORKSPACE SCRATCH TESTS PASSED CLEANLY!");
