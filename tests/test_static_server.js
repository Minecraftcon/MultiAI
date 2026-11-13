const assert = require("assert");
const http = require("http");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");
const { handleStatic } = require("../src/server/routes/static");

console.log("=== Testing Optimized Low-Memory Static Server ===");

const server = http.createServer((req, res) => {
    handleStatic(req, res);
});

function requestRaw(serverPort, options, reqBody = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port: serverPort,
            timeout: 3000,
            ...options
        }, (res) => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    rawBody: buffer,
                    bodyText: buffer.toString("utf8")
                });
            });
        });
        req.on("error", reject);
        if (reqBody) req.write(reqBody);
        req.end();
    });
}

server.listen(0, "127.0.0.1", async () => {
    const port = server.address().port;

    try {
        // 1. Test GET / -> index.html (200 OK + ETag + Streams)
        console.log("1. Testing GET / (index.html streaming & headers)...");
        const res1 = await requestRaw(port, { method: "GET", path: "/" });
        assert.strictEqual(res1.statusCode, 200, "Should return 200 OK");
        assert.strictEqual(res1.headers["content-type"], "text/html", "MIME should be text/html");
        assert(res1.headers["etag"], "Should include ETag header");
        assert(res1.headers["last-modified"], "Should include Last-Modified header");
        assert(res1.bodyText.includes("<title>") || res1.bodyText.includes("<!DOCTYPE html>"), "Should return HTML content");
        const savedEtag = res1.headers["etag"];
        const savedLastMod = res1.headers["last-modified"];

        // 2. Test HEAD / -> same headers, zero body length
        console.log("2. Testing HEAD /...");
        const resHead = await requestRaw(port, { method: "HEAD", path: "/" });
        assert.strictEqual(resHead.statusCode, 200);
        assert.strictEqual(resHead.headers["etag"], savedEtag);
        assert.strictEqual(resHead.rawBody.length, 0, "HEAD request must have zero body");

        // 3. Test HTTP 304 Conditional Caching with If-None-Match
        console.log("3. Testing HTTP 304 with If-None-Match...");
        const res304 = await requestRaw(port, {
            method: "GET",
            path: "/",
            headers: { "if-none-match": savedEtag }
        });
        assert.strictEqual(res304.statusCode, 304, "Should return 304 Not Modified");
        assert.strictEqual(res304.rawBody.length, 0, "304 response must transfer 0 body bytes");

        // 4. Test HTTP 304 Conditional Caching with If-Modified-Since
        console.log("4. Testing HTTP 304 with If-Modified-Since...");
        const res304Time = await requestRaw(port, {
            method: "GET",
            path: "/",
            headers: { "if-modified-since": savedLastMod }
        });
        assert.strictEqual(res304Time.statusCode, 304, "Should return 304 Not Modified");
        assert.strictEqual(res304Time.rawBody.length, 0);

        // 5. Test Gzip Compression
        console.log("5. Testing Gzip Compression...");
        const resGzip = await requestRaw(port, {
            method: "GET",
            path: "/",
            headers: { "accept-encoding": "gzip" }
        });
        assert.strictEqual(resGzip.statusCode, 200);
        assert.strictEqual(resGzip.headers["content-encoding"], "gzip", "Should compress with gzip");
        const decompressed = zlib.gunzipSync(resGzip.rawBody).toString("utf8");
        assert(decompressed.includes("<title>") || decompressed.includes("<!DOCTYPE html>"), "Decompressed body must match original");

        // 6. Test Path Traversal Protection
        console.log("6. Testing Path Traversal Protection...");
        const resSec = await requestRaw(port, { method: "GET", path: "/../../package.json" });
        assert.strictEqual(resSec.statusCode, 400, "Should reject directory traversal with 400");

        // 7. Test Non-existent file (404)
        console.log("7. Testing 404 for missing non-existent file...");
        const res404 = await requestRaw(port, { method: "GET", path: "/src/does_not_exist_xyz123.js" });
        assert.strictEqual(res404.statusCode, 404);

        console.log("\n✓ ALL STATIC SERVER OPTIMIZATION TESTS PASSED CLEANLY!\n");
        server.close();
        process.exit(0);
    } catch (err) {
        console.error("Test failed:", err);
        server.close();
        process.exit(1);
    }
});
