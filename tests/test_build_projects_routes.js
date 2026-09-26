const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const configManager = require("../src/core/config_manager");
const conversationsManager = require("../src/core/conversations_manager");
const { getChatWorkspace, resolveSafePath } = require("../src/server/utils");
const { handleValidateDirRoute, handleBuildProjectsRoute } = require("../src/server/routes/build_projects");

// Helper to simulate HTTP req / res
function createMockReqRes({ method = "GET", url = "/", body = null, headers = {} }) {
    const stream = require("stream");
    const req = new stream.Readable({
        read() {
            if (body) {
                this.push(typeof body === "string" ? body : JSON.stringify(body));
            }
            this.push(null);
        }
    });
    req.method = method;
    req.url = url;
    req.headers = headers;

    let resCode = 200;
    let resHeaders = {};
    let resBody = "";

    const res = {
        writeHead(code, h = {}) {
            resCode = code;
            resHeaders = { ...resHeaders, ...h };
        },
        end(data) {
            if (data) resBody += data;
        },
        write(data) {
            if (data) resBody += data;
        },
        get statusCode() { return resCode; },
        get body() {
            try { return JSON.parse(resBody); } catch (_) { return resBody; }
        }
    };

    return { req, res };
}

async function runTests() {
    console.log("=== Running Safety Net Tests for Build Projects & Directory Validation ===");

    // Use a clean sandbox for storage
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), "multiai-build-test-"));
    const origGetConfig = configManager.getConfig;
    configManager.getConfig = () => ({
        General: { StorageDir: tmpStorage }
    });

    const testProjectDir = path.join(tmpStorage, "my-code-repo");
    fs.mkdirSync(testProjectDir, { recursive: true });
    fs.writeFileSync(path.join(testProjectDir, "package.json"), '{"name":"my-code-repo"}');

    try {
        // 1. Directory Validation: /api/fs/validate-dir (suggestions)
        console.log("Test: /api/fs/validate-dir suggestions");
        {
            const { req, res } = createMockReqRes({ method: "GET", url: "/api/fs/validate-dir" });
            await handleValidateDirRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(res.body.success, "Response must be success");
            assert(Array.isArray(res.body.suggestions), "Must return suggestions array");
            assert(res.body.suggestions.length > 0, "Must have suggestions");
        }

        // 2. Directory Validation: /api/fs/validate-dir with path
        console.log("Test: /api/fs/validate-dir with existing and non-existing paths");
        {
            const { req: validReq, res: validRes } = createMockReqRes({
                method: "GET",
                url: `/api/fs/validate-dir?path=${encodeURIComponent(testProjectDir)}`
            });
            await handleValidateDirRoute(validReq, validRes);
            assert.strictEqual(validRes.statusCode, 200);
            assert.strictEqual(validRes.body.valid, true);
            assert.strictEqual(validRes.body.basename, "my-code-repo");

            const { req: invalidReq, res: invalidRes } = createMockReqRes({
                method: "GET",
                url: `/api/fs/validate-dir?path=${encodeURIComponent(path.join(tmpStorage, "non-existent-dir"))}`
            });
            await handleValidateDirRoute(invalidReq, invalidRes);
            assert.strictEqual(invalidRes.statusCode, 200);
            assert.strictEqual(invalidRes.body.valid, false);
            assert(invalidRes.body.error.includes("does not exist"));
        }

        // 3. Register Build Project: POST /api/build/projects
        console.log("Test: POST /api/build/projects register project");
        let projectId = "";
        {
            const { req, res } = createMockReqRes({
                method: "POST",
                url: "/api/build/projects",
                body: { path: testProjectDir, name: "My Code Repo" }
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(res.body.success);
            assert(res.body.project);
            assert.strictEqual(res.body.project.name, "My Code Repo");
            assert.strictEqual(res.body.project.rootPath, testProjectDir);
            projectId = res.body.project.id;
            assert(projectId, "Project ID must be generated");
        }

        // 4. List Build Projects: GET /api/build/projects
        console.log("Test: GET /api/build/projects list projects");
        {
            const { req, res } = createMockReqRes({ method: "GET", url: "/api/build/projects" });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(Array.isArray(res.body.projects));
            assert(res.body.projects.some(p => p.id === projectId));
        }

        // 5. Initialize Build Chat Workspace: POST /api/build/projects/:id/chats/session
        console.log("Test: POST /api/build/projects/:id/chats/session");
        const chatId = "build-chat-test-01";
        {
            const { req, res } = createMockReqRes({
                method: "POST",
                url: `/api/build/projects/${projectId}/chats/session`,
                body: { chatId }
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(res.body.workspace);
            assert.strictEqual(res.body.workspace.projectId, projectId);
            assert.strictEqual(res.body.workspace.projectRoot, testProjectDir);
            assert(res.body.workspace.workspacePrompt.includes("BUILD WORKSPACE - PROJECT CONTEXT"));
        }

        // 6. Save Build Chat: POST /api/build/projects/:id/chats/save
        console.log("Test: POST /api/build/projects/:id/chats/save");
        {
            const chatSession = {
                id: chatId,
                projectId,
                mode: "build",
                title: "Build App Feature",
                messages: [
                    { role: "user", content: "Build the landing page" },
                    { role: "assistant", content: "I will generate the landing page." }
                ]
            };
            const { req, res } = createMockReqRes({
                method: "POST",
                url: `/api/build/projects/${projectId}/chats/save`,
                body: chatSession
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(res.body.workspace);
        }

        // 7. Get Build Chat: GET /api/build/projects/:id/chats/:chatId
        console.log("Test: GET /api/build/projects/:id/chats/:chatId");
        {
            const { req, res } = createMockReqRes({
                method: "GET",
                url: `/api/build/projects/${projectId}/chats/${chatId}`
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert(res.body.session);
            assert.strictEqual(res.body.session.title, "Build App Feature");
            assert.strictEqual(res.body.session.messages.length, 2);
        }

        // 8. Verify findProjectForChat and resolveSafePath binding to project root
        console.log("Test: resolveSafePath binds to project root for build project chats");
        {
            const wsContext = getChatWorkspace(chatId);
            assert(wsContext, "Workspace context must be resolved");
            assert.strictEqual(wsContext.isProject, true);
            assert.strictEqual(wsContext.project.rootPath, testProjectDir);

            // Relative path should resolve to testProjectDir/package.json
            const resolvedPkg = resolveSafePath("package.json", chatId);
            assert.strictEqual(resolvedPkg, path.join(testProjectDir, "package.json"));
            assert(fs.existsSync(resolvedPkg), "Package.json must exist in project root");

            // $SCRATCH should resolve to the project chat's scratch directory
            const resolvedScratch = resolveSafePath("$SCRATCH/notes.txt", chatId);
            assert(resolvedScratch.includes(chatId));
            assert(resolvedScratch.endsWith("notes.txt"));
        }

        // 9. Delete Build Chat: DELETE /api/build/projects/:id/chats/:chatId
        console.log("Test: DELETE /api/build/projects/:id/chats/:chatId");
        {
            const { req, res } = createMockReqRes({
                method: "DELETE",
                url: `/api/build/projects/${projectId}/chats/${chatId}`
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.deleted, true);

            // Verify chat no longer found
            const { req: getReq, res: getRes } = createMockReqRes({
                method: "GET",
                url: `/api/build/projects/${projectId}/chats/${chatId}`
            });
            await handleBuildProjectsRoute(getReq, getRes);
            assert.strictEqual(getRes.statusCode, 404);
        }

        // 10. Remove Project: DELETE /api/build/projects/:id
        console.log("Test: DELETE /api/build/projects/:id");
        {
            const { req, res } = createMockReqRes({
                method: "DELETE",
                url: `/api/build/projects/${projectId}`
            });
            await handleBuildProjectsRoute(req, res);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.deleted, true);

            // Verify project no longer in list
            const { req: listReq, res: listRes } = createMockReqRes({
                method: "GET",
                url: "/api/build/projects"
            });
            await handleBuildProjectsRoute(listReq, listRes);
            assert(!listRes.body.projects.some(p => p.id === projectId));

            // Verify user project on disk is preserved!
            assert(fs.existsSync(testProjectDir), "User code repo on disk must NEVER be deleted!");
        }

        console.log("✓ ALL BUILD PROJECTS & DIRECTORY VALIDATION TESTS PASSED CLEANLY!");
    } finally {
        configManager.getConfig = origGetConfig;
        try {
            fs.rmSync(tmpStorage, { recursive: true, force: true });
        } catch (_) {}
    }
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
