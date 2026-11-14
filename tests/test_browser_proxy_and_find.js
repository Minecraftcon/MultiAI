/**
 * Test for Browser Proxy and File Find Endpoints
 */

const assert = require("assert");
const http = require("http");
const { handleBrowserProxyRoute } = require("../src/server/routes/browser_proxy");
const { handleFindFiles } = require("../src/tools/filesystem/code_tools");
const { resolveSafePath } = require("../src/server/utils");

async function runTests() {
    console.log("=== Testing Browser Proxy & File Find Endpoints ===");

    // 1. Test handleFindFiles
    console.log("1. Testing handleFindFiles...");
    const findRes = await handleFindFiles({ path: ".", query: "index.js" }, "", { resolveSafePath });
    assert(findRes && Array.isArray(findRes.results), "Find result should have results array");
    const foundIndex = findRes.results.some(r => r.name === "index.js");
    assert(foundIndex, "handleFindFiles should locate index.js");
    console.log(`   ✓ Found ${findRes.results.length} match(es) for 'index.js'`);

    // 2. Test handleBrowserProxyRoute rejects missing URL
    console.log("2. Testing handleBrowserProxyRoute validation...");
    const mockReqMissing = { url: "/api/browser/proxy" };
    let missingCode = 0;
    let missingBody = "";
    const mockResMissing = {
        writeHead: (code, headers) => { missingCode = code; },
        end: (body) => { missingBody = body; }
    };
    await handleBrowserProxyRoute(mockReqMissing, mockResMissing);
    assert.strictEqual(missingCode, 400, "Should return 400 for missing url");
    console.log("   ✓ Rejects missing URL with 400");

    // 3. Test handleBrowserProxyRoute rejects unsupported protocols
    const mockReqFtp = { url: "/api/browser/proxy?url=ftp://example.com" };
    let ftpCode = 0;
    const mockResFtp = {
        writeHead: (code, headers) => { ftpCode = code; },
        end: () => {}
    };
    await handleBrowserProxyRoute(mockReqFtp, mockResFtp);
    assert.strictEqual(ftpCode, 400, "Should return 400 for non-http/https protocol");
    console.log("   ✓ Rejects non-HTTP/HTTPS protocol with 400");

    console.log("=== All Browser Proxy & File Find Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
