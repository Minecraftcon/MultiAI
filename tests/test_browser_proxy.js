const assert = require("assert");
const { unwrapTrackerUrl, extractClientRedirectTarget } = require("../src/server/routes/browser_proxy");

console.log("=== Testing Embedded Browser Proxy & Redirect Support ===");

// 1. Tracker Unwrapping
console.log("Test 1: Unwrapping Bing Tracker URL...");
const dest1 = "https://nodejs.org/docs/latest/api/";
const b64_1 = Buffer.from(dest1).toString("base64");
const bingUrl = `https://www.bing.com/ck/a?!&&p=12345&u=a1${b64_1}&ntb=1`;
assert.strictEqual(unwrapTrackerUrl(bingUrl), dest1);
console.log("✓ Bing tracker unwrapped correctly.");

console.log("Test 2: Unwrapping DuckDuckGo Tracker URL...");
const dest2 = "https://github.com/torvalds/linux";
const ddgUrl = `https://duckduckgo.com/l/?uddg=${encodeURIComponent(dest2)}&rut=abc`;
assert.strictEqual(unwrapTrackerUrl(ddgUrl), dest2);
console.log("✓ DuckDuckGo tracker unwrapped correctly.");

console.log("Test 3: Unwrapping Google Tracker URL...");
const dest3 = "https://developer.mozilla.org/en-US/";
const googleUrl = `https://www.google.com/url?q=${encodeURIComponent(dest3)}&sa=U&ved=0`;
assert.strictEqual(unwrapTrackerUrl(googleUrl), dest3);
console.log("✓ Google tracker unwrapped correctly.");

// 2. Client-side Redirect Extraction
console.log("Test 4: Extracting JS Redirect Landing Page Target...");
const bingHtml = `
<html>
<head>
<script>
function r() {
    var u = "https://www.wikipedia.org";
    window.location.replace(u);
}
</script>
</head>
<body onload="r()">Redirecting...</body>
</html>`;
assert.strictEqual(extractClientRedirectTarget(bingHtml, "https://www.bing.com"), "https://www.wikipedia.org");
console.log("✓ JS redirect extracted correctly.");

console.log("Test 5: Extracting Meta Refresh Target...");
const metaHtml = `<html><head><meta http-equiv="refresh" content="0; url=/next-page"></head></html>`;
assert.strictEqual(extractClientRedirectTarget(metaHtml, "https://example.com/start"), "https://example.com/next-page");
console.log("✓ Meta refresh target extracted correctly.");

// 3. Live Server Proxy Tests (Testing http://localhost:4440/api/browser/proxy)
async function runServerTests() {
    console.log("Test 6: Live Proxy GET with Header Stripping & Base Tag Injection...");
    const testUrl = "https://example.com";
    const res = await fetch(`http://localhost:4440/api/browser/proxy?url=${encodeURIComponent(testUrl)}`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);

    const xFinal = res.headers.get("x-final-url");
    assert(xFinal, "Missing X-Final-URL header");
    assert.strictEqual(res.headers.get("x-frame-options"), null, "X-Frame-Options must be stripped");
    assert.strictEqual(res.headers.get("content-security-policy"), null, "CSP must be stripped");

    const html = await res.text();
    assert(html.includes(`<base href="`), "Proxied HTML must include <base href=...>");
    assert(html.includes(`__multiai_browser_helper__`), "Proxied HTML must include helper script");
    assert(html.includes(`MULTIAI_BROWSER_NAVIGATED`), "Helper script must post MULTIAI_BROWSER_NAVIGATED message");
    console.log("✓ Proxy correctly injected base tag, helper script, and stripped security framing headers.");

    console.log("Test 7: Live Proxy Redirect Following (http -> https)...");
    const redirectReq = await fetch(`http://localhost:4440/api/browser/proxy?url=${encodeURIComponent("http://github.com")}`);
    assert.strictEqual(redirectReq.status, 200);
    const finalGithubUrl = redirectReq.headers.get("x-final-url");
    assert(finalGithubUrl && finalGithubUrl.startsWith("https://github.com"), `Expected final URL https://github.com, got ${finalGithubUrl}`);
    console.log("✓ Live HTTP redirect followed automatically, final URL propagated:", finalGithubUrl);

    console.log("Test 8: Live Proxy POST Support...");
    const postRes = await fetch(`http://localhost:4440/api/browser/proxy?url=${encodeURIComponent("https://httpbin.org/post")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "multiai-browser" })
    });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.json.test, "multiai-browser");
    console.log("✓ Live Proxy POST request succeeded and payload was forwarded.");

    console.log("\n========================================================");
    console.log("🎉 ALL EMBEDDED BROWSER PROXY & REDIRECT TESTS PASSED! 🎉");
    console.log("========================================================\n");
}

runServerTests().catch((err) => {
    console.error("Test failure:", err);
    process.exit(1);
});

