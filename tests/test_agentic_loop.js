const assert = require("assert");

async function runTests() {
    console.log("=== Running Safety Net Tests for Build Mode Agentic Loop & Planning Tools ===");

    // 1. Tool Registry & Planning Tools export
    console.log("Test: Planning tools registered in tools module");
    const toolsModule = await import("../client/src/tools/index.js");
    const { getTool, hasTool, tools } = toolsModule;

    assert(hasTool("write_todos"), "Tool registry must contain 'write_todos'");
    assert(hasTool("task"), "Tool registry must contain 'task'");

    const writeTodos = getTool("write_todos");
    assert.strictEqual(writeTodos.name, "write_todos");
    assert.strictEqual(writeTodos.schema.type, "function");
    assert.strictEqual(writeTodos.schema.function.name, "write_todos");
    assert(writeTodos.schema.function.parameters.properties.todos, "Schema must require 'todos' array");

    const taskTool = getTool("task");
    assert.strictEqual(taskTool.name, "task");
    assert.strictEqual(taskTool.schema.type, "function");
    assert.strictEqual(taskTool.schema.function.name, "task");
    assert(taskTool.schema.function.parameters.properties.instruction, "Schema must require 'instruction'");
    assert(taskTool.schema.function.parameters.properties.subagent_type, "Schema must support 'subagent_type'");

    // 2. Testing write_todos handler logic
    console.log("Test: write_todos handler normalizes tasks and computes counts");
    const planningModule = await import("../client/src/tools/planning/index.js");
    const { writeTodosTool } = planningModule;

    const result = await writeTodosTool.handler({
        todos: [
            { id: "1", content: "Audit repository files", status: "completed" },
            { id: "2", content: "Implement agentic loop", status: "in_progress" },
            { id: "3", content: "Write automated tests", status: "pending" },
            { content: "Invalid status defaults to pending", status: "unknown" },
            { content: "   ", status: "pending" } // Empty content should be filtered
        ]
    }, { badgeEl: null, genState: null });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.total, 4, "Should filter out empty item");
    assert.strictEqual(result.completed, 1);
    assert.strictEqual(result.in_progress, 1);
    assert.strictEqual(result.pending, 2);
    assert.strictEqual(result.todos[3].status, "pending", "Unknown status must fallback to pending");

    // 3. Subagent module exports
    console.log("Test: Subagent engine exports runSubagent");
    const subagentModule = await import("../client/src/agent/subagent.js");
    assert.strictEqual(typeof subagentModule.runSubagent, "function", "runSubagent must be an exported function");

    // 4. Plan Serializer & Artifact path
    console.log("Test: Plan serializer formats markdown and resolves artifact path");
    const { formatTodosMarkdown, resolvePlanArtifactPath } = await import("../client/src/tools/planning/plan-serializer.js");
    const sampleTodos = [
        { id: "1", content: "Create module A", status: "completed" },
        { id: "2", content: "Implement module B", status: "in_progress" },
        { id: "3", content: "Verify with tests", status: "pending" }
    ];
    const md = formatTodosMarkdown("Build Feature", sampleTodos);
    assert(md.includes("# Task Plan: Build Feature"), "Markdown must have title header");
    assert(md.includes("1/3 completed (33%)"), "Markdown must show progress summary");
    assert(md.includes("[x] **Create module A**"), "Completed task must have checked box");
    assert(md.includes("[-] **Implement module B**"), "In-progress task must have in-progress indicator");
    assert(md.includes("[ ] **Verify with tests**"), "Pending task must have unchecked box");

    const artPath = resolvePlanArtifactPath("My New Feature / Step 1");
    assert.strictEqual(artPath, "$ARTIFACTS/Tasklist-my_new_feature_step_1.md");

    // 5. Plan HITL Detection & Card Metadata
    console.log("Test: Plan HITL detection detects plan text vs normal chat");
    const { isPlanApprovalRequired, extractPlanMetadata } = await import("../client/src/components/plan-hitl.js");
    const planText = "## Implementation Plan - Core Engine\nThis is the plan description.\n1. Add component\n2. Add test\nShall I proceed with this plan?";
    assert(isPlanApprovalRequired(planText, { mode: "build" }), "Must detect plan requiring approval in build mode");
    assert(!isPlanApprovalRequired("Hello, what is the weather today?", { mode: "build" }), "Normal chat must not require plan approval");

    const meta = extractPlanMetadata(planText);
    assert.strictEqual(meta.title, "Implementation Plan - Core Engine");
    assert(meta.snippet.includes("This is the plan description."), "Snippet must extract descriptive text");

    // 5b. Plan Commenting Prompt Formatter
    console.log("Test: Plan commenting formats structured feedback prompt");
    const { formatCommentsFeedbackPrompt } = await import("../client/src/components/plan-commenting.js");
    const sampleComments = [
        { quote: "Add component", text: "Please use ES modules" },
        { quote: "Add test", text: "Include safety net unit tests" }
    ];
    const prompt = formatCommentsFeedbackPrompt(sampleComments, "Core Engine");
    assert(prompt.includes("[Implementation Plan Review Feedback]:"), "Must have review header");
    assert(prompt.includes('> "Add component"'), "Must quote selected text");
    assert(prompt.includes("Feedback: Please use ES modules"), "Must include feedback note");
    assert(prompt.includes('> "Add test"'), "Must quote second selected text");
    assert(prompt.includes("write_todos"), "Must remind model to update write_todos");

    // 6. Verification Gate
    console.log("Test: Verification gate evaluates test tool calls and completion conditions");
    const { isVerificationToolCall, shouldTriggerVerification, getVerificationPrompt } = await import("../client/src/agent/verification-gate.js");
    assert(isVerificationToolCall("run_task", { command: "npm test" }), "npm test is a verification tool call");
    assert(isVerificationToolCall("run_task", { command: "vitest run" }), "vitest is a verification tool call");
    assert(isVerificationToolCall("run_command", { command: "pytest" }), "pytest is a verification tool call");
    assert(!isVerificationToolCall("run_task", { command: "cat file.txt" }), "cat is not a verification tool call");
    assert(!isVerificationToolCall("read_file", { path: "test.js" }), "read_file is not a verification tool call");

    const completedTodos = [
        { id: "1", content: "Task 1", status: "completed" },
        { id: "2", content: "Task 2", status: "completed" }
    ];
    const incompleteTodos = [
        { id: "1", content: "Task 1", status: "completed" },
        { id: "2", content: "Task 2", status: "in_progress" }
    ];

    assert(shouldTriggerVerification({
        session: { todos: completedTodos },
        isBuildMode: true,
        hasRunVerification: false,
        verificationNudgeCount: 0,
        hasRunTools: true
    }), "Must trigger verification when all tasks completed and no verification run yet");

    assert(!shouldTriggerVerification({
        session: { todos: incompleteTodos },
        isBuildMode: true,
        hasRunVerification: false,
        verificationNudgeCount: 0,
        hasRunTools: true
    }), "Must not trigger verification if any task is still in-progress");

    assert(!shouldTriggerVerification({
        session: { todos: completedTodos },
        isBuildMode: true,
        hasRunVerification: true,
        verificationNudgeCount: 0,
        hasRunTools: true
    }), "Must not trigger verification if verification has already run");

    assert(getVerificationPrompt().includes("Verification Gate"), "Verification prompt must inform the model");

    // 7. Build Projects Workspace Prompt format
    console.log("Test: Build workspace prompt includes agentic loop, dual-track, and modularity rules");
    const { createBuildProjectsManager } = require("../src/core/build_projects_manager.js");
    const os = require("os");
    const path = require("path");
    const fs = require("fs");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-agent-test-"));
    const mgr = createBuildProjectsManager(() => tmpDir, (p) => p);

    const testRepo = path.join(tmpDir, "sample-repo");
    fs.mkdirSync(testRepo, { recursive: true });
    const project = mgr.addProject(testRepo, "Sample Repo");
    const ws = mgr.ensureProjectChatWorkspace(project.id, "test-chat-1");

    assert(ws.workspacePrompt.includes("BUILD MODE AGENTIC GUIDELINES"), "Workspace prompt must contain agentic guidelines");
    assert(ws.workspacePrompt.includes("DUAL-TRACK EXECUTION"), "Workspace prompt must reference dual-track execution");
    assert(ws.workspacePrompt.includes("MODULAR ARCHITECTURE"), "Workspace prompt must mandate modular architecture");
    assert(ws.workspacePrompt.includes("BUG FINDING RULES"), "Workspace prompt must include bug finding rules");
    assert(ws.workspacePrompt.includes("write_todos"), "Workspace prompt must reference write_todos");
    assert(ws.workspacePrompt.includes("SUBAGENT DELEGATION (task)"), "Workspace prompt must reference task delegation");

    console.log("✓ ALL AGENTIC LOOP & PLANNING TESTS PASSED CLEANLY!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
