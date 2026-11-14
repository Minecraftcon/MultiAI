const { URL } = require("url");

/**
 * Embedded Browser Proxy
 * Fetches external web pages server-side and strips X-Frame-Options / CSP frame-ancestors
 * so they can be viewed securely inside the Right Panel's embedded browser iframe.
 */
async function handleBrowserProxyRoute(req, res) {
    try {
        const parsed = new URL(req.url, "http://localhost:4440");
        const targetUrl = parsed.searchParams.get("url");

        if (!targetUrl) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Missing url parameter" }));
        }

        let parsedTarget;
        try {
            parsedTarget = new URL(targetUrl);
        } catch (_) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid target url" }));
        }

        if (!["http:", "https:"].includes(parsedTarget.protocol)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Only http and https protocols supported" }));
        }

        const headers = {
            "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        let response;
        try {
            response = await fetch(parsedTarget.href, {
                method: req.method === "HEAD" ? "HEAD" : "GET",
                headers,
                redirect: "follow",
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        const contentType = response.headers.get("content-type") || "text/html";
        const resHeaders = {};

        // Copy safe headers from upstream response
        for (const [key, value] of response.headers.entries()) {
            const lKey = key.toLowerCase();
            // Strip headers that prevent iframe embedding or block same-origin framing
            if (
                lKey === "x-frame-options" ||
                lKey === "content-security-policy" ||
                lKey === "content-security-policy-report-only" ||
                lKey === "strict-transport-security"
            ) {
                continue;
            }
            resHeaders[key] = value;
        }

        resHeaders["Access-Control-Allow-Origin"] = "*";
        resHeaders["X-Content-Type-Options"] = "nosniff";

        const isHtml = contentType.toLowerCase().includes("text/html");

        if (isHtml) {
            let html = await response.text();
            // Inject <base href="..."> so relative paths (CSS, JS, images, links) resolve to the original site
            const baseTag = `<base href="${response.url}">`;
            if (html.includes("<head>")) {
                html = html.replace("<head>", `<head>${baseTag}`);
            } else if (html.includes("<HEAD>")) {
                html = html.replace("<HEAD>", `<HEAD>${baseTag}`);
            } else {
                html = baseTag + html;
            }

            delete resHeaders["content-length"];
            delete resHeaders["content-encoding"];

            res.writeHead(response.status, resHeaders);
            return res.end(html);
        } else {
            // Binary or streaming content (images, fonts, stylesheets)
            res.writeHead(response.status, resHeaders);
            const arrayBuf = await response.arrayBuffer();
            return res.end(Buffer.from(arrayBuf));
        }
    } catch (err) {
        console.error("[BROWSER PROXY ERROR]", err.message);
        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`
                <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:32px 24px;color:#a1a1aa;background:#18181b;height:100vh;box-sizing:border-box;">
                    <div style="max-width:540px;margin:0 auto;text-align:center;">
                        <h3 style="color:#ef4444;margin-bottom:8px;font-size:18px;">Unable to load page</h3>
                        <p style="font-size:14px;line-height:1.6;color:#71717a;margin-bottom:20px;">${err.message || "Target server did not respond or connection was refused."}</p>
                    </div>
                </div>
            `);
        } else if (!res.writableEnded) {
            res.end();
        }
    }
}

module.exports = {
    handleBrowserProxyRoute
};

