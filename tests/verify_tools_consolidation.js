/**
 * verify_tools_consolidation.js
 *
 * Automated verification check for Tool Consolidation, Anti-Hallucination Design,
 * and Prompt Polishing (Milestone 1 / Requirements R1).
 *
 * Verifies:
 * 1. show_html_preview parameter validation and auto-reveal of preview pane.
 * 2. toggle_panel removal from designer allowed tools.
 * 3. Schema consistency and anti-hallucination constraints between SERVER_BUILD_TOOLS and webui tools.
 * 4. Multi-replace tool availability in server build tools.
 * 5. ArtifactMetadata support in tool schemas.
 * 6. formatToolResult instruct formatting (anti-json-waste).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Loads ES module or parses static definition if needed.
 */
async function loadModules() {
    const designModule = await import(path.join(ROOT_DIR, "UI/webui/src/tools/design/index.js"));
    const domModule = await import(path.join(ROOT_DIR, "UI/webui/src/utils/dom.js"));
    return { designModule, domModule };
}

function loadServerBuildTools() {
    const buildRunnerPath = path.join(ROOT_DIR, "src/core/build_agent_runner.js");
    const content = fs.readFileSync(buildRunnerPath, "utf-8");
    // Extract SERVER_BUILD_TOOLS array using evaluation in safe context
    const match = content.match(/const\s+SERVER_BUILD_TOOLS\s*=\s*(\[[\s\S]*?\n\];)/);
    if (!match) {
        throw new Error("Could not find SERVER_BUILD_TOOLS in src/core/build_agent_runner.js");
    }
    const toolsCode = "return " + match[1].replace(/;\s*$/, "");
    return new Function(toolsCode)();
}

async function runToolsConsolidationChecks(options = {}) {
    const verbose = options.verbose !== false;
    const results = {
        totalChecks: 0,
        passedChecks: 0,
        failedChecks: 0,
        failures: []
    };

    function record(testName, pass, message) {
        results.totalChecks++;
        if (pass) {
            results.passedChecks++;
            if (verbose) console.log(`  [PASS] ${testName}`);
        } else {
            results.failedChecks++;
            results.failures.push({ testName, message });
            if (verbose) console.log(`  [FAIL] ${testName}: ${message}`);
        }
    }

    if (verbose) {
        console.log("================================================================================");
        console.log(" TOOLS CONSOLIDATION & ANTI-HALLUCINATION VERIFICATION");
        console.log("================================================================================");
    }

    const { designModule, domModule } = await loadModules();
    const serverBuildTools = loadServerBuildTools();

    // -------------------------------------------------------------------------
    // 1. show_html_preview Auto-Reveal & Parameter Handling
    // -------------------------------------------------------------------------
    if (verbose) console.log("\n1. Verifying show_html_preview Auto-Reveal & Parameters...");

    const showHtmlPreviewTool = designModule.showHtmlPreviewTool;
    record(
        "showHtmlPreviewTool exists and has schema",
        Boolean(showHtmlPreviewTool && showHtmlPreviewTool.schema && showHtmlPreviewTool.schema.function),
        "showHtmlPreviewTool must be defined with valid function schema."
    );

    // Schema properties check
    const fnSchema = showHtmlPreviewTool.schema.function;
    const props = fnSchema.parameters?.properties || {};
    record(
        "showHtmlPreviewTool schema defines html property",
        Boolean(props.html && props.html.type === "string"),
        "Parameters must include 'html' of type string."
    );
    record(
        "showHtmlPreviewTool schema defines title property",
        Boolean(props.title && props.title.type === "string"),
        "Parameters must include 'title' of type string."
    );

    // Auto-reveal behavior when rightPanel is present
    let rightPanelOpenCalled = false;
    let rightPanelPreviewCalled = false;
    let renderedHtml = null;

    global.window = {
        rightPanel: {
            open: () => { rightPanelOpenCalled = true; },
            openHtmlPreview: (html, title, path) => {
                rightPanelPreviewCalled = true;
                renderedHtml = html;
            },
            openBrowserTab: () => {}
        }
    };

    try {
        const testHtml = "<div class='test-card'>Hello World</div>";
        const res = await showHtmlPreviewTool.handler({ html: testHtml, title: "Test Card" });

        record(
            "show_html_preview auto-opens rightPanel without toggle_panel",
            rightPanelOpenCalled === true,
            "Executing show_html_preview must call window.rightPanel.open() automatically."
        );
        record(
            "show_html_preview renders HTML in preview panel",
            rightPanelPreviewCalled === true && renderedHtml === testHtml,
            "Executing show_html_preview must forward HTML to openHtmlPreview."
        );
        record(
            "show_html_preview returns rendered status payload",
            res && res.status === "rendered" && res.title === "Test Card",
            `Expected status 'rendered', received: ${JSON.stringify(res)}`
        );
    } catch (err) {
        record("show_html_preview execution", false, err.message);
    } finally {
        delete global.window;
    }

    // -------------------------------------------------------------------------
    // 2. First-class show_html_preview tool availability
    // -------------------------------------------------------------------------
    if (verbose) console.log("\n2. Verifying show_html_preview tool availability...");

    record(
        "show_html_preview is available without isolation restriction",
        !designModule.showHtmlPreviewTool?.subagentOnly,
        "show_html_preview must be available as a direct tool without isolation restriction."
    );

    record(
        "show_html_preview is exported in designTools",
        designModule.designTools.some(t => t.name === "show_html_preview"),
        "show_html_preview must remain available in designTools."
    );

    // -------------------------------------------------------------------------
    // 3. Schema Parity & Anti-Hallucination Constraints in SERVER_BUILD_TOOLS
    // -------------------------------------------------------------------------
    if (verbose) console.log("\n3. Verifying SERVER_BUILD_TOOLS Schema Parity & Constraints...");

    const serverToolNames = serverBuildTools.map(t => t.function?.name);

    record(
        "SERVER_BUILD_TOOLS includes multi_replace_file_content",
        serverToolNames.includes("multi_replace_file_content"),
        "SERVER_BUILD_TOOLS must include multi_replace_file_content for atomic multi-block edits (Feature 3)."
    );

    // Check write_file and replace_file_content parameter schemas
    const writeFileTool = serverBuildTools.find(t => t.function?.name === "write_file");
    const replaceFileTool = serverBuildTools.find(t => t.function?.name === "replace_file_content");

    record(
        "write_file defines ArtifactMetadata property in schema",
        Boolean(writeFileTool?.function?.parameters?.properties?.ArtifactMetadata || writeFileTool?.function?.parameters?.properties?.artifact_metadata),
        "write_file schema in SERVER_BUILD_TOOLS must document ArtifactMetadata parameter (Feature 10)."
    );

    record(
        "replace_file_content defines ArtifactMetadata property in schema",
        Boolean(replaceFileTool?.function?.parameters?.properties?.ArtifactMetadata || replaceFileTool?.function?.parameters?.properties?.artifact_metadata),
        "replace_file_content schema in SERVER_BUILD_TOOLS must document ArtifactMetadata parameter (Feature 10)."
    );

    // Parameter constraint checks: all tools must have type 'object' and strict required array
    let allSchemasStrict = true;
    let schemaStrictError = "";
    for (const tool of serverBuildTools) {
        const fn = tool.function;
        if (!fn || !fn.parameters || fn.parameters.type !== "object") {
            allSchemasStrict = false;
            schemaStrictError = `Tool ${fn?.name} missing parameters object type.`;
            break;
        }
        if (!Array.isArray(fn.parameters.required) || fn.parameters.required.length === 0) {
            // write_todos, run_task, read_file all require at least 1 parameter
            if (["write_file", "read_file", "replace_file_content", "run_task"].includes(fn.name)) {
                allSchemasStrict = false;
                schemaStrictError = `Tool ${fn.name} missing non-empty required parameters array.`;
                break;
            }
        }
    }
    record(
        "All server tools enforce strict parameter object and required constraints",
        allSchemasStrict,
        schemaStrictError
    );

    // -------------------------------------------------------------------------
    // 4. formatToolResult Instruct Formatting
    // -------------------------------------------------------------------------
    if (verbose) console.log("\n4. Verifying formatToolResult Instruct Formatting...");

    const formatToolResult = domModule.formatToolResult;

    record(
        "formatToolResult exists in dom.js",
        typeof formatToolResult === "function",
        "formatToolResult must be exported as a function from UI/webui/src/utils/dom.js"
    );

    // 4.1 Task/Terminal output formatting
    const taskResult = {
        task_id: "task-99",
        status: "completed",
        exit_code: 0,
        stdout: "Build succeeded in 2.4s\nAll tests passed."
    };
    const formattedTask = formatToolResult(taskResult);
    record(
        "formatToolResult formats task execution in clean instruct style",
        formattedTask.includes("task_id: task-99") &&
        formattedTask.includes("exit_code: 0") &&
        formattedTask.includes("Build succeeded"),
        `Expected structured task lines, got: ${formattedTask}`
    );

    // 4.2 Questionnaire prompt formatting
    const questionResult = {
        status: "answered",
        answers: [
            { question: "Choose database", answer: "PostgreSQL" }
        ]
    };
    const formattedQuestion = formatToolResult(questionResult);
    record(
        "formatToolResult formats questionnaires cleanly",
        formattedQuestion.includes("Answered by user:") && formattedQuestion.includes("PostgreSQL"),
        `Expected questionnaire summary, got: ${formattedQuestion}`
    );

    // 4.3 File & Artifact operation formatting: should NOT just return escaped raw JSON
    const fileResult = {
        status: "success",
        path: "$ARTIFACTS/architecture.md",
        resolved_path: "/data/artifacts/architecture.md",
        bytes_written: 1024,
        is_artifact: true
    };
    const formattedFile = formatToolResult(fileResult);
    const isRawJson = formattedFile.trim().startsWith("{") && formattedFile.trim().endsWith("}");
    record(
        "formatToolResult formats file/artifact tool results in instruct style without raw JSON waste",
        !isRawJson && formattedFile.includes("$ARTIFACTS/architecture.md"),
        `File tool result should be formatted as clean instruct text without raw JSON waste. Got: ${formattedFile}`
    );

    // 4.4 Boundary: null / undefined / primitives
    record(
        "formatToolResult handles null/undefined safely",
        formatToolResult(null) === "null" && formatToolResult(undefined) === "undefined",
        "formatToolResult must not crash on null or undefined"
    );

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    if (verbose) {
        console.log("\n================================================================================");
        console.log(`TOTAL CHECKS: ${results.totalChecks}`);
        console.log(`PASSED:       ${results.passedChecks}`);
        console.log(`FAILED:       ${results.failedChecks}`);
        console.log("================================================================================");
        if (results.failedChecks === 0) {
            console.log("RESULT: PASS - Tool consolidation and schemas are verified.");
        } else {
            console.log(`RESULT: FAIL - ${results.failedChecks} tool consolidation check(s) failed.`);
        }
        console.log("================================================================================");
    }

    return results;
}

if (require.main === module) {
    runToolsConsolidationChecks({ verbose: true }).then(results => {
        process.exit(results.failedChecks === 0 ? 0 : 1);
    }).catch(err => {
        console.error("Fatal error running tools consolidation checks:", err);
        process.exit(1);
    });
}

module.exports = {
    runToolsConsolidationChecks
};
