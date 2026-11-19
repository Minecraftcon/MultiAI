/**
 * Automated Verification for Backblaze B2 Workspaces & Persistent Project Sync
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { b2Storage } = require("../src/core/b2_storage");
const { handleCloudToolsRoute } = require("../src/server/routes/cloud_tools");

function createMockReqRes(method, url, body = {}, headers = {}) {
    const rawBody = JSON.stringify(body);
    const req = {
        method,
        url,
        headers: {
            "content-type": "application/json",
            ...headers
        },
        async *[Symbol.asyncIterator]() {
            yield Buffer.from(rawBody);
        }
    };

    let statusCode = 200;
    let headersSent = {};
    let responseData = "";

    const res = {
        writeHead(code, h) {
            statusCode = code;
            headersSent = { ...headersSent, ...h };
        },
        setHeader(k, v) {
            headersSent[k] = v;
        },
        end(data) {
            if (data) responseData = data;
        }
    };

    const getParsed = () => {
        try {
            return JSON.parse(responseData);
        } catch (_) {
            return responseData;
        }
    };

    return { req, res, getStatus: () => statusCode, getParsed };
}

async function runTests() {
    console.log("=== Running Backblaze B2 Workspace & Sync Tests ===");

    // Test 1: B2 Config check
    console.log("Test 1: B2 Configuration");
    assert.strictEqual(b2Storage.isConfigured(), true, "B2 should be configured with credentials from .env");
    console.log("  ✓ B2 is configured");

    // Test 2: List workspaces API route
    console.log("Test 2: GET /api/cloud/workspaces");
    const testWsReq = createMockReqRes("GET", "/api/cloud/workspaces");
    await handleCloudToolsRoute(testWsReq.req, testWsReq.res);
    assert.strictEqual(testWsReq.getStatus(), 200);
    const wsData = testWsReq.getParsed();
    assert.strictEqual(wsData.success, true);
    assert.ok(Array.isArray(wsData.persistent), "persistent must be an array");
    assert.ok(Array.isArray(wsData.temporary), "temporary must be an array");
    console.log("  ✓ GET /api/cloud/workspaces returned 200 with persistent and temporary lists");

    // Test 3: Create a persistent project via POST /api/cloud/projects/create
    const testProjectName = `test-b2-proj-${Date.now()}`;
    console.log(`Test 3: POST /api/cloud/projects/create for "${testProjectName}"`);
    const createReq = createMockReqRes("POST", "/api/cloud/projects/create", {
        name: testProjectName,
        type: "persistent",
        source: "empty"
    });
    await handleCloudToolsRoute(createReq.req, createReq.res);
    assert.strictEqual(createReq.getStatus(), 200);
    const createData = createReq.getParsed();
    assert.strictEqual(createData.success, true);
    assert.strictEqual(createData.project.name, testProjectName);
    assert.strictEqual(createData.project.type, "persistent");
    assert.ok(fs.existsSync(createData.workdir), "Local project directory must exist");
    assert.ok(fs.existsSync(path.join(createData.workdir, "README.md")), "README.md should be created for empty project");
    console.log("  ✓ Project created locally and snapshot uploaded to B2");

    // Test 4: Verify project appears in persistent workspaces list
    console.log("Test 4: Verify persistence in /api/cloud/workspaces");
    const listReq2 = createMockReqRes("GET", "/api/cloud/workspaces");
    await handleCloudToolsRoute(listReq2.req, listReq2.res);
    const wsData2 = listReq2.getParsed();
    const found = wsData2.persistent.find(p => p.name === testProjectName);
    assert.ok(found, "Newly created project must appear in persistent list");
    console.log("  ✓ Project registered in persistent projects list with B2 timestamp");

    // Test 5: Modify file and test sync endpoint POST /api/cloud/projects/sync
    console.log("Test 5: POST /api/cloud/projects/sync");
    fs.writeFileSync(path.join(createData.workdir, "test_file.txt"), "Testing persistent sync");
    const syncReq = createMockReqRes("POST", "/api/cloud/projects/sync", {
        name: testProjectName,
        path: createData.workdir
    });
    await handleCloudToolsRoute(syncReq.req, syncReq.res);
    assert.strictEqual(syncReq.getStatus(), 200);
    const syncData = syncReq.getParsed();
    assert.strictEqual(syncData.success, true);
    console.log("  ✓ POST /api/cloud/projects/sync succeeded and updated B2 snapshot");

    // Test 6: Hydrate into a clean separate directory to verify snapshot integrity
    console.log("Test 6: Hydrate snapshot from B2 into fresh directory");
    const restoreDir = path.join("/tmp", `restore_${testProjectName}`);
    if (fs.existsSync(restoreDir)) fs.rmSync(restoreDir, { recursive: true, force: true });
    fs.mkdirSync(restoreDir, { recursive: true });

    // Download snapshot buffer directly
    const snapshotBuf = await b2Storage.downloadFile(`projects/${testProjectName}/snapshot.tar.gz`, true);
    assert.ok(Buffer.isBuffer(snapshotBuf) && snapshotBuf.length > 50, "Snapshot buffer must be valid gzip tarball");
    const tempTar = `/tmp/test_download_${Date.now()}.tar.gz`;
    fs.writeFileSync(tempTar, snapshotBuf);
    await b2Storage.extractTarSnapshot(tempTar, restoreDir);
    fs.unlinkSync(tempTar);

    assert.ok(fs.existsSync(path.join(restoreDir, "README.md")), "Extracted README.md must exist");
    assert.ok(fs.existsSync(path.join(restoreDir, "test_file.txt")), "Extracted test_file.txt must exist");
    assert.strictEqual(fs.readFileSync(path.join(restoreDir, "test_file.txt"), "utf8"), "Testing persistent sync");
    console.log("  ✓ Snapshot verified: extracted files match perfectly");

    // Cleanup test artifacts
    console.log("Test 7: Cleanup test project");
    if (fs.existsSync(createData.workdir)) fs.rmSync(createData.workdir, { recursive: true, force: true });
    if (fs.existsSync(restoreDir)) fs.rmSync(restoreDir, { recursive: true, force: true });

    // Clean test project from B2 registry
    const projects = await b2Storage.loadProjectsRegistry();
    const filtered = projects.filter(p => p.name !== testProjectName);
    await b2Storage.saveProjectsRegistry(filtered);
    console.log("  ✓ Cleaned up test project from registry and local disk");

    console.log("\n🎉 ALL B2 PERSISTENCE TESTS PASSED CLEANLY!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
