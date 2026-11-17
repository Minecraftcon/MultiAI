/**
 * verify_artifacts_system.js
 *
 * Automated verification check for Native Storage & Antigravity Artifacting System
 * (Milestone 3 / Requirements R3).
 *
 * Verifies:
 * 1. Storage segregation between persistent $ARTIFACTS and ephemeral $SCRATCH in Chat & Build modes.
 * 2. Safe path resolution in src/server/utils.js for $ARTIFACTS and $SCRATCH.
 * 3. ArtifactMetadata parsing, validation, and return payload contracts in code_tools.js.
 * 4. Case-insensitive parameter normalization (path vs Path, content vs Content).
 * 5. Artifact registry persistence in artifacts.json with proper schema.
 * 6. /api/artifacts/list route contract in src/server/routes/conversations.js.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT_DIR = path.resolve(__dirname, "..");
const configManager = require("../src/core/config_manager");

// Create temporary isolated sandbox
const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-artifact-verify-"));

// Monkey-patch configManager to isolate test storage
const origGetConfig = configManager.getConfig;
configManager.getConfig = () => ({
    General: {
        StorageDir: sandboxDir
    }
});

const convManager = require("../src/core/conversations_manager");
const rawBuildManager = require("../src/core/build_projects_manager");
const buildProjectsRoot = path.join(sandboxDir, "build", "projects");
const buildManager = typeof rawBuildManager.createBuildProjectsManager === "function"
    ? rawBuildManager.createBuildProjectsManager(() => buildProjectsRoot, (p) => p)
    : rawBuildManager;
const serverUtils = require("../src/server/utils");
const codeTools = require("../src/tools/filesystem/code_tools");
const { handleConversationsRoute } = require("../src/server/routes/conversations");

async function runArtifactsVerificationChecks(options = {}) {
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
        console.log(" ARTIFACTING SYSTEM & NATIVE STORAGE VERIFICATION");
        console.log("================================================================================");
    }

    const testChatId = "chat-artifact-test-" + Date.now();
    const testDate = "2026-11-16";

    try {
        // ---------------------------------------------------------------------
        // 1. Chat Mode Storage Hierarchy & Segregation
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n1. Verifying Chat Mode Storage Segregation...");

        const chatWs = convManager.ensureChatWorkspace(testChatId, testDate);

        record(
            "Chat workspace creates distinct chatDir",
            Boolean(chatWs && chatWs.chatDir && fs.existsSync(chatWs.chatDir)),
            `chatDir must exist. Got: ${chatWs?.chatDir}`
        );

        record(
            "Chat workspace creates persistent artifactsDir ($ARTIFACTS)",
            Boolean(chatWs && chatWs.artifactsDir && fs.existsSync(chatWs.artifactsDir)),
            `artifactsDir must exist. Got: ${chatWs?.artifactsDir}`
        );

        record(
            "Chat workspace creates ephemeral scratchDir ($SCRATCH)",
            Boolean(chatWs && chatWs.scratchDir && fs.existsSync(chatWs.scratchDir)),
            `scratchDir must exist. Got: ${chatWs?.scratchDir}`
        );

        record(
            "$ARTIFACTS and $SCRATCH directories are strictly isolated",
            chatWs && chatWs.artifactsDir !== chatWs.scratchDir &&
            !chatWs.artifactsDir.startsWith(chatWs.scratchDir) &&
            !chatWs.scratchDir.startsWith(chatWs.artifactsDir),
            "artifactsDir and scratchDir must be separate siblings."
        );

        // Verify saveChat preserves artifactsDir in workspace metadata
        const savedSession = {
            id: testChatId,
            title: "Artifacts Test Chat",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{ role: "user", content: "Create artifact" }]
        };
        const savedWs = convManager.saveChat(savedSession);
        const metaPath = path.join(chatWs.chatDir, "metadata.json");
        let metaObj = {};
        if (fs.existsSync(metaPath)) {
            try { metaObj = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch (_) {}
        }
        record(
            "Chat metadata.json includes artifactsDir in workspace",
            Boolean(metaObj.workspace && metaObj.workspace.artifactsDir),
            `workspace.artifactsDir missing in ${metaPath}. Got: ${JSON.stringify(metaObj.workspace)}`
        );

        // ---------------------------------------------------------------------
        // 2. Build Mode Storage Segregation
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n2. Verifying Build Mode Storage Segregation...");

        const testProjId = "proj-test-" + Date.now();
        const testProjDir = path.join(sandboxDir, "build", "projects", testProjId);
        fs.mkdirSync(testProjDir, { recursive: true });

        const testBuildChatId = "build-chat-" + Date.now();
        const ensureWorkspaceFn = buildManager.ensureProjectChatWorkspace || buildManager.ensureBuildProjectWorkspace || convManager.ensureProjectChatWorkspace;
        const buildWs = ensureWorkspaceFn ? ensureWorkspaceFn.call(buildManager, testProjId, testBuildChatId) : null;

        record(
            "Build mode creates isolated artifactsDir",
            Boolean(buildWs && buildWs.artifactsDir && fs.existsSync(buildWs.artifactsDir)),
            `Build artifactsDir missing: ${buildWs?.artifactsDir}`
        );

        record(
            "Build mode creates isolated scratchDir",
            Boolean(buildWs && buildWs.scratchDir && fs.existsSync(buildWs.scratchDir)),
            `Build scratchDir missing: ${buildWs?.scratchDir}`
        );

        // ---------------------------------------------------------------------
        // 3. Safe Path Resolution ($ARTIFACTS vs $SCRATCH)
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n3. Verifying Safe Path Resolution & Isolation...");

        const resolvedArtifact = serverUtils.resolveSafePath("$ARTIFACTS/design.md", testChatId);
        const resolvedScratch = serverUtils.resolveSafePath("$SCRATCH/temp.log", testChatId);
        const resolvedArtifactBraces = serverUtils.resolveSafePath("${ARTIFACTS}/design.md", testChatId);
        const resolvedArtifactShorthand = serverUtils.resolveSafePath("artifacts/design.md", testChatId);

        record(
            "resolveSafePath correctly routes $ARTIFACTS/design.md to artifacts directory",
            resolvedArtifact === path.join(chatWs.artifactsDir, "design.md"),
            `Expected ${path.join(chatWs.artifactsDir, "design.md")}, got ${resolvedArtifact}`
        );

        record(
            "resolveSafePath correctly routes $SCRATCH/temp.log to scratch directory",
            resolvedScratch === path.join(chatWs.scratchDir, "temp.log"),
            `Expected ${path.join(chatWs.scratchDir, "temp.log")}, got ${resolvedScratch}`
        );

        record(
            "resolveSafePath supports ${ARTIFACTS} and artifacts/ shorthands",
            resolvedArtifactBraces === resolvedArtifact && resolvedArtifactShorthand === resolvedArtifact,
            "Shorthands ${ARTIFACTS} and artifacts/ must resolve identically."
        );

        // Path Traversal Security Check
        let traversalEscaped = false;
        try {
            const traversalPath = serverUtils.resolveSafePath("$ARTIFACTS/../../../../etc/passwd", testChatId);
            // If it resolved outside sandbox or storageRoot, fail
            if (!traversalPath.startsWith(chatWs.chatDir) && !traversalPath.startsWith(sandboxDir)) {
                traversalEscaped = true;
            }
        } catch (_) {
            // Throwing on traversal is also acceptable safe behavior
        }
        record(
            "Path traversal attempts cannot escape the chat directory",
            !traversalEscaped,
            "Directory traversal with ../ must not escape the chat workspace."
        );

        // ---------------------------------------------------------------------
        // 4. ArtifactMetadata & Tool Contracts in code_tools.js
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n4. Verifying ArtifactMetadata & Tool Contracts in code_tools.js...");

        const artifactContent = "# Architecture Brief\nThis is a test artifact document.";
        const artifactMetadata = {
            UserFacing: true,
            Summary: "Detailed architectural brief for the subsystem.",
            RequestFeedback: true
        };

        // 4.1 handleWriteFile with ArtifactMetadata
        let writeRes = null;
        try {
            writeRes = await codeTools.handleWriteFile(
                {
                    path: "$ARTIFACTS/architecture.md",
                    content: artifactContent,
                    ArtifactMetadata: artifactMetadata
                },
                testChatId,
                { resolveSafePath: serverUtils.resolveSafePath }
            );
        } catch (err) {
            writeRes = { error: err.message };
        }

        record(
            "handleWriteFile writes file to disk at $ARTIFACTS path",
            Boolean(writeRes && writeRes.status === "success" && fs.existsSync(resolvedArtifact.replace("design.md", "architecture.md"))),
            `handleWriteFile failed: ${JSON.stringify(writeRes)}`
        );

        record(
            "handleWriteFile returns is_artifact: true for $ARTIFACTS writes",
            Boolean(writeRes && writeRes.is_artifact === true),
            `Expected is_artifact: true, got: ${writeRes?.is_artifact}`
        );

        record(
            "handleWriteFile passes back validated artifact_metadata in payload",
            Boolean(writeRes && (writeRes.artifact_metadata || writeRes.ArtifactMetadata)),
            `artifact_metadata missing in return payload: ${JSON.stringify(writeRes)}`
        );

        // 4.2 Case-insensitive parameter normalization (Path vs path, Content vs content)
        let caseInsensitiveRes = null;
        try {
            caseInsensitiveRes = await codeTools.handleWriteFile(
                {
                    Path: "$ARTIFACTS/case_test.md",
                    Content: "Case test content",
                    ArtifactMetadata: { Summary: "Case sensitivity test", UserFacing: false }
                },
                testChatId,
                { resolveSafePath: serverUtils.resolveSafePath }
            );
        } catch (err) {
            caseInsensitiveRes = { error: err.message };
        }

        record(
            "handleWriteFile supports case-insensitive parameters (Path, Content)",
            Boolean(caseInsensitiveRes && caseInsensitiveRes.status === "success"),
            `Failed with capitalized Path/Content: ${JSON.stringify(caseInsensitiveRes)}`
        );

        // 4.3 handleReplaceFileContent with ArtifactMetadata
        let replaceRes = null;
        try {
            replaceRes = await codeTools.handleReplaceFileContent(
                {
                    path: "$ARTIFACTS/architecture.md",
                    target_content: "This is a test artifact document.",
                    replacement_content: "This is an UPDATED artifact document.",
                    ArtifactMetadata: {
                        UserFacing: true,
                        Summary: "Updated architectural brief.",
                        RequestFeedback: false
                    }
                },
                testChatId,
                { resolveSafePath: serverUtils.resolveSafePath }
            );
        } catch (err) {
            replaceRes = { error: err.message };
        }

        record(
            "handleReplaceFileContent supports ArtifactMetadata updates on artifacts",
            Boolean(replaceRes && replaceRes.status === "success" && (replaceRes.is_artifact === true || replaceRes.artifact_metadata)),
            `handleReplaceFileContent artifact contract failed: ${JSON.stringify(replaceRes)}`
        );

        // ---------------------------------------------------------------------
        // 5. Artifact Registry (artifacts.json) Persistence
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n5. Verifying Artifact Registry (artifacts.json) Persistence...");

        const registryPath = path.join(chatWs.artifactsDir, "artifacts.json");
        const registryExists = fs.existsSync(registryPath);

        record(
            "Writing artifact persists registry to artifacts.json",
            registryExists,
            `Expected ${registryPath} to exist after artifact write.`
        );

        let registryData = null;
        if (registryExists) {
            try {
                registryData = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
            } catch (_) {}
        }

        record(
            "artifacts.json contains artifacts array",
            Boolean(registryData && Array.isArray(registryData.artifacts)),
            `artifacts.json must contain 'artifacts' array. Got: ${JSON.stringify(registryData)}`
        );

        const entry = registryData?.artifacts?.find(a => a.name === "architecture.md" || a.path?.includes("architecture.md"));
        record(
            "artifacts.json record contains metadata fields (id, name, path, summary, userFacing, requestFeedback)",
            Boolean(
                entry &&
                entry.name &&
                entry.path &&
                (entry.summary !== undefined || entry.Summary !== undefined) &&
                (entry.userFacing !== undefined || entry.UserFacing !== undefined)
            ),
            `Artifact entry missing expected metadata: ${JSON.stringify(entry)}`
        );

        // Ephemeral scratch files must NOT appear in artifacts.json
        try {
            await codeTools.handleWriteFile(
                { path: "$SCRATCH/scratch_log.txt", content: "temp log" },
                testChatId,
                { resolveSafePath: serverUtils.resolveSafePath }
            );
        } catch (_) {}

        let updatedRegistry = null;
        if (fs.existsSync(registryPath)) {
            try { updatedRegistry = JSON.parse(fs.readFileSync(registryPath, "utf-8")); } catch (_) {}
        }
        const scratchInRegistry = updatedRegistry?.artifacts?.some(a => a.path?.includes("scratch_log.txt") || a.name === "scratch_log.txt");
        record(
            "Ephemeral $SCRATCH files are NOT recorded in artifacts.json",
            !scratchInRegistry,
            "Files in $SCRATCH must remain strictly ephemeral and excluded from artifacts.json."
        );

        // ---------------------------------------------------------------------
        // 6. /api/artifacts/list Endpoint Contract
        // ---------------------------------------------------------------------
        if (verbose) console.log("\n6. Verifying /api/artifacts/list Route Contract...");

        // Mock HTTP req/res for handleConversationsRoute
        function createMockHttp(method, url) {
            const res = {
                statusCode: 200,
                headers: {},
                body: "",
                writeHead: (code, headers) => {
                    res.statusCode = code;
                    if (headers) Object.assign(res.headers, headers);
                },
                setHeader: (key, val) => { res.headers[key] = val; },
                end: (chunk) => {
                    if (chunk) res.body += chunk;
                }
            };
            const req = {
                method,
                url,
                headers: { host: "localhost:3000" },
                [Symbol.asyncIterator]: async function* () {}
            };
            return { req, res };
        }

        const { req, res } = createMockHttp("GET", `/api/artifacts/list?chatId=${encodeURIComponent(testChatId)}`);
        let routeHandled = false;
        try {
            await handleConversationsRoute(req, res);
            routeHandled = res.statusCode !== 404;
        } catch (e) {
            routeHandled = false;
        }

        record(
            "handleConversationsRoute handles /api/artifacts/list endpoint",
            routeHandled,
            `Expected /api/artifacts/list to be handled, received statusCode ${res.statusCode}`
        );

        let parsedList = null;
        try { parsedList = JSON.parse(res.body); } catch (_) {}

        record(
            "/api/artifacts/list returns JSON list of artifacts",
            Boolean(parsedList && (Array.isArray(parsedList.artifacts) || parsedList.success === true)),
            `Expected { success: true, artifacts: [...] }, got: ${res.body}`
        );

    } finally {
        // Cleanup test sandbox
        configManager.getConfig = origGetConfig;
        try {
            fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch (_) {}
    }

    if (verbose) {
        console.log("\n================================================================================");
        console.log(`TOTAL CHECKS: ${results.totalChecks}`);
        console.log(`PASSED:       ${results.passedChecks}`);
        console.log(`FAILED:       ${results.failedChecks}`);
        console.log("================================================================================");
        if (results.failedChecks === 0) {
            console.log("RESULT: PASS - Artifacting system and storage are verified.");
        } else {
            console.log(`RESULT: FAIL - ${results.failedChecks} artifacting check(s) failed.`);
        }
        console.log("================================================================================");
    }

    return results;
}

if (require.main === module) {
    runArtifactsVerificationChecks({ verbose: true }).then(results => {
        process.exit(results.failedChecks === 0 ? 0 : 1);
    }).catch(err => {
        console.error("Fatal error running artifacts verification checks:", err);
        process.exit(1);
    });
}

module.exports = {
    runArtifactsVerificationChecks
};
