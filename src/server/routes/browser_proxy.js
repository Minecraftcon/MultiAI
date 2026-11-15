const { URL } = require("url");

/**
 * Embedded Browser Proxy
 * Fetches external web pages server-side and strips X-Frame-Options / CSP frame-ancestors
 * so they can be viewed securely inside the Right Panel's embedded browser iframe.
 *
 * Supports:
 * - Direct search query execution and redirect handling
 * - Following HTTP 301/302/303/307/308 redirects automatically
 * - Unwrapping search engine tracker redirect links (Bing, DuckDuckGo, Google)
 * - Automatic server-side following of client JS / meta-refresh redirect landing pages
 * - Client script injection to intercept link clicks, form submissions, and location navigation
 * - Synchronizing current URL and title with the parent window via postMessage
 * - Full client SPA fetch/XHR proxying so search engine suggestions and dynamic results work
 * - Content-Encoding header normalization to avoid decoding corruption
 */

function unwrapTrackerUrl(targetUrl) {
    try {
        const u = new URL(targetUrl);
        // Bing click tracker: /ck/a?!&&...&u=a1<base64>...
        if (u.hostname.includes("bing.com") && u.pathname.includes("/ck/a") && u.searchParams.has("u")) {
            const rawU = u.searchParams.get("u").replace(/^a1/, "");
            const decoded = Buffer.from(rawU, "base64").toString("utf-8");
            if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
                return decoded;
            }
        }
        // DuckDuckGo click tracker: /l/?uddg=<url>
        if (u.hostname.includes("duckduckgo.com") && u.searchParams.has("uddg")) {
            const uddg = u.searchParams.get("uddg");
            if (uddg && (uddg.startsWith("http://") || uddg.startsWith("https://"))) {
                return uddg;
            }
        }
        // Google click tracker: /url?q=<url>
        if (u.hostname.includes("google.com") && u.pathname.startsWith("/url") && u.searchParams.has("q")) {
            const q = u.searchParams.get("q");
            if (q && (q.startsWith("http://") || q.startsWith("https://"))) {
                return q;
            }
        }
    } catch (_) {}
    return targetUrl;
}

function extractClientRedirectTarget(html, baseUrl) {
    if (!html || html.length > 5000) return null;
    try {
        // Match JS redirect: window.location.replace("..."), location.href = "...", var u = "..."
        const jsMatch = html.match(/var\s+u\s*=\s*["'](https?:\/\/[^"']+)["']/i) ||
                        html.match(/(?:window\.)?location\.(?:replace|href)\s*=?\s*\(?["'](https?:\/\/[^"']+)["']\)?/i);
        if (jsMatch && jsMatch[1]) {
            return jsMatch[1];
        }

        // Match meta refresh redirect
        const metaMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["'][^>]*>/i);
        if (metaMatch && metaMatch[1]) {
            const target = metaMatch[1].trim().replace(/^['"]|['"]$/g, "");
            return new URL(target, baseUrl).href;
        }
    } catch (_) {}
    return null;
}

function generateInjectedScript(currentUrl, proxyOrigin) {
    return `<script id="__multiai_browser_helper__">
(function() {
    const CURRENT_URL = ${JSON.stringify(currentUrl)};
    const PROXY_ORIGIN = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : ${JSON.stringify(proxyOrigin || "http://localhost:4440")};

    // 1. Notify parent frame of current URL and document title
    function notifyParent(urlOverride, titleOverride) {
        try {
            const finalU = urlOverride || CURRENT_URL;
            const finalT = titleOverride || document.title || finalU;
            window.parent.postMessage({
                type: "MULTIAI_BROWSER_NAVIGATED",
                url: finalU,
                title: finalT
            }, "*");
        } catch (_) {}
    }
    notifyParent();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { notifyParent(); });
    }
    window.addEventListener("load", function() { notifyParent(); });
    setTimeout(function() { notifyParent(); }, 150);
    setTimeout(function() { notifyParent(); }, 600);

    // 2. Helper to resolve and route URLs through proxy
    function toProxyUrl(rawHref) {
        if (!rawHref) return "";
        let dest = rawHref;
        try {
            dest = new URL(rawHref, CURRENT_URL).href;
        } catch (_) {
            return rawHref;
        }

        // Already proxied to this server
        if (dest.startsWith(PROXY_ORIGIN + "/api/browser/proxy")) {
            return dest;
        }

        // Unwrap search tracker redirect links directly on client
        try {
            const u = new URL(dest);
            if (u.hostname.includes("duckduckgo.com") && u.searchParams.has("uddg")) {
                const uddg = u.searchParams.get("uddg");
                if (uddg) dest = uddg;
            } else if (u.hostname.includes("google.com") && u.pathname.startsWith("/url") && u.searchParams.has("q")) {
                const q = u.searchParams.get("q");
                if (q) dest = q;
            } else if (u.hostname.includes("bing.com") && u.pathname.includes("/ck/a") && u.searchParams.has("u")) {
                const b64 = u.searchParams.get("u").replace(/^a1/, "");
                try { dest = atob(b64); } catch (_) {}
            }
        } catch (_) {}

        if (dest.startsWith("javascript:") || dest.startsWith("mailto:") || dest.startsWith("tel:") || dest.startsWith("data:")) {
            return dest;
        }

        // ALWAYS prefix PROXY_ORIGIN so <base href="..."> cannot resolve this relative to the external site!
        return PROXY_ORIGIN + "/api/browser/proxy?url=" + encodeURIComponent(dest);
    }

    // 3. Patch Location.prototype.assign and replace
    try {
        if (typeof Location !== "undefined" && Location.prototype) {
            const _assign = Location.prototype.assign;
            Location.prototype.assign = function(url) {
                window.location.href = toProxyUrl(url);
            };
            const _replace = Location.prototype.replace;
            Location.prototype.replace = function(url) {
                window.location.replace(toProxyUrl(url));
            };
        }
    } catch (_) {}

    // 4. Patch History.prototype.pushState and replaceState (SPA navigation)
    try {
        if (typeof History !== "undefined" && History.prototype) {
            const _pushState = History.prototype.pushState;
            History.prototype.pushState = function(state, unused, url) {
                if (url) {
                    try {
                        const abs = new URL(url, CURRENT_URL).href;
                        notifyParent(abs);
                        return _pushState.call(this, state, unused, toProxyUrl(abs));
                    } catch (_) {}
                }
                return _pushState.apply(this, arguments);
            };

            const _replaceState = History.prototype.replaceState;
            History.prototype.replaceState = function(state, unused, url) {
                if (url) {
                    try {
                        const abs = new URL(url, CURRENT_URL).href;
                        notifyParent(abs);
                        return _replaceState.call(this, state, unused, toProxyUrl(abs));
                    } catch (_) {}
                }
                return _replaceState.apply(this, arguments);
            };
        }
    } catch (_) {}

    // 5. Intercept all link clicks (capture phase)
    document.addEventListener("click", function(e) {
        const a = e.target.closest("a");
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
        e.preventDefault();
        e.stopPropagation();
        window.location.href = toProxyUrl(a.href || href);
    }, true);

    // 6. Intercept form submissions (e.g. search boxes)
    document.addEventListener("submit", function(e) {
        const form = e.target;
        if (!form) return;
        const method = (form.getAttribute("method") || "GET").toUpperCase();
        const action = form.getAttribute("action") || CURRENT_URL;
        e.preventDefault();
        e.stopPropagation();

        try {
            const actionUrl = new URL(action, CURRENT_URL);
            const formData = new FormData(form);
            if (method === "GET") {
                for (const [key, val] of formData.entries()) {
                    actionUrl.searchParams.append(key, val);
                }
                window.location.href = toProxyUrl(actionUrl.href);
            } else {
                form.action = toProxyUrl(actionUrl.href);
                form.submit();
            }
        } catch (_) {
            window.location.href = toProxyUrl(action);
        }
    }, true);

    // 7. Intercept window.open
    try {
        const _open = window.open;
        window.open = function(url, target, features) {
            if (url) {
                window.location.href = toProxyUrl(url);
                return window;
            }
            return _open.apply(window, arguments);
        };
    } catch (_) {}

    // 8. Intercept meta refresh
    try {
        const meta = document.querySelector('meta[http-equiv="refresh" i]');
        if (meta) {
            const content = meta.getAttribute("content") || "";
            const m = content.match(/url=(.*)/i);
            if (m && m[1]) {
                const dest = m[1].trim().replace(/^['"]|['"]$/g, "");
                meta.setAttribute("content", "0;url=" + toProxyUrl(dest));
            }
        }
    } catch (_) {}

    // 9. Embedded element inspector for iframe (Jetski Preview parity)
    (function setupIframeInspector() {
        let iframeInspectActive = false;
        let iframeOverlay = null;
        let currentHoverEl = null;

        function rgbToHex(rgb) {
            if (!rgb) return "";
            const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
            if (!m) return rgb;
            const r = parseInt(m[1], 10).toString(16).padStart(2, "0");
            const g = parseInt(m[2], 10).toString(16).padStart(2, "0");
            const b = parseInt(m[3], 10).toString(16).padStart(2, "0");
            if (m[4] !== undefined && parseFloat(m[4]) < 1) {
                const a = Math.round(parseFloat(m[4]) * 255).toString(16).padStart(2, "0");
                return ("#" + r + g + b + a).toUpperCase();
            }
            return ("#" + r + g + b).toUpperCase();
        }

        function buildSel(el) {
            if (!el || el === document.body) return "body";
            if (el.id) return "#" + el.id;
            const tag = el.tagName.toLowerCase();
            const classes = Array.from(el.classList || [])
                .filter(function(c) { return !c.startsWith("element-inspector") && !c.startsWith("is-"); })
                .slice(0, 2)
                .map(function(c) { return "." + c; })
                .join("");
            return tag + classes;
        }

        function extractData(el) {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const tag = el.tagName.toLowerCase();
            const classes = Array.from(el.classList || [])
                .filter(function(c) { return !c.startsWith("element-inspector") && !c.startsWith("is-"); })
                .slice(0, 2)
                .map(function(c) { return "." + c; })
                .join("");
            const tagDisplay = tag + classes;
            const dimsDisplay = r.width.toFixed(1) + " × " + r.height.toFixed(1);

            const a11yName = el.getAttribute("aria-label") ||
                             el.getAttribute("title") ||
                             el.getAttribute("alt") ||
                             el.getAttribute("placeholder") ||
                             (el.innerText ? el.innerText.trim().slice(0, 36) : "");
            const a11yRole = el.getAttribute("role") || tag;
            const isFocusable = el.tabIndex >= 0 || ["a", "button", "input", "textarea", "select"].includes(tag);

            return {
                selector: buildSel(el),
                tagName: el.tagName,
                tagDisplay: tagDisplay,
                dimsDisplay: dimsDisplay,
                rect: {
                    top: r.top,
                    left: r.left,
                    width: parseFloat(r.width.toFixed(2)),
                    height: parseFloat(r.height.toFixed(2)),
                    x: Math.round(r.x),
                    y: Math.round(r.y)
                },
                styles: {
                    color: rgbToHex(cs.color),
                    rawColor: cs.color,
                    backgroundColor: rgbToHex(cs.backgroundColor),
                    rawBg: cs.backgroundColor,
                    font: cs.fontSize + " " + cs.fontFamily.split(",")[0].replace(/['"]/g, ""),
                    padding: (cs.paddingTop + " " + cs.paddingRight).replace(/px/g, "px ")
                },
                accessibility: {
                    name: a11yName,
                    role: a11yRole,
                    focusable: isFocusable
                },
                outerHTML: (el.outerHTML || "").slice(0, 1500)
            };
        }

        function sendHover(el) {
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (!iframeOverlay) {
                iframeOverlay = document.createElement("div");
                iframeOverlay.style.cssText = "position:fixed;pointer-events:none;z-index:9999990;border:2px solid #3b82f6;background:rgba(59,130,246,0.14);border-radius:4px;box-sizing:border-box;";
                document.body.appendChild(iframeOverlay);
            }
            iframeOverlay.style.display = "block";
            iframeOverlay.style.top = r.top + "px";
            iframeOverlay.style.left = r.left + "px";
            iframeOverlay.style.width = r.width + "px";
            iframeOverlay.style.height = r.height + "px";

            const data = extractData(el);
            try {
                window.parent.postMessage({
                    type: "MULTIAI_ELEMENT_HOVER",
                    elementData: data,
                    rect: {
                        top: r.top,
                        left: r.left,
                        width: r.width,
                        height: r.height
                    }
                }, "*");
            } catch (_) {}
        }

        function onIframeMove(e) {
            if (!iframeInspectActive) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === iframeOverlay) return;
            if (el === currentHoverEl) return;
            currentHoverEl = el;
            sendHover(el);
        }

        function onIframeClick(e) {
            if (!iframeInspectActive) return;
            e.preventDefault();
            e.stopPropagation();

            const el = currentHoverEl || document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return;

            const data = extractData(el);
            setInspectActive(false);
            try {
                window.parent.postMessage({ type: "MULTIAI_ELEMENT_SELECTED", elementData: data }, "*");
            } catch (_) {}
        }

        function onIframeScroll() {
            if (iframeInspectActive && currentHoverEl) {
                sendHover(currentHoverEl);
            }
        }

        function onIframeLeave() {
            currentHoverEl = null;
            if (iframeOverlay) iframeOverlay.style.display = "none";
            try {
                window.parent.postMessage({ type: "MULTIAI_ELEMENT_UNHOVER" }, "*");
            } catch (_) {}
        }

        function setInspectActive(active) {
            iframeInspectActive = active;
            if (active) {
                document.addEventListener("mousemove", onIframeMove, true);
                document.addEventListener("click", onIframeClick, true);
                window.addEventListener("scroll", onIframeScroll, true);
                document.addEventListener("mouseleave", onIframeLeave, true);
            } else {
                currentHoverEl = null;
                document.removeEventListener("mousemove", onIframeMove, true);
                document.removeEventListener("click", onIframeClick, true);
                window.removeEventListener("scroll", onIframeScroll, true);
                document.removeEventListener("mouseleave", onIframeLeave, true);
                if (iframeOverlay) iframeOverlay.style.display = "none";
                try {
                    window.parent.postMessage({ type: "MULTIAI_ELEMENT_UNHOVER" }, "*");
                } catch (_) {}
            }
        }

        window.addEventListener("message", function(e) {
            if (e.data && e.data.type === "MULTIAI_TOGGLE_ELEMENT_INSPECTOR") {
                setInspectActive(Boolean(e.data.active));
            }
        });
    })();
})();
</script>`;
}

async function handleBrowserProxyRoute(req, res) {
    try {
        const parsed = new URL(req.url, "http://localhost:4440");
        let rawTarget = parsed.searchParams.get("url");

        if (!rawTarget) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Missing url parameter" }));
        }

        // Unwrap tracking redirects if already encoded in URL
        rawTarget = unwrapTrackerUrl(rawTarget);

        let parsedTarget;
        try {
            parsedTarget = new URL(rawTarget);
        } catch (_) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid target url" }));
        }

        if (!["http:", "https:"].includes(parsedTarget.protocol)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Only http and https protocols supported" }));
        }

        const hostHeader = req.headers.host || "localhost:4440";
        const proxyOrigin = (req.connection && req.connection.encrypted ? "https://" : "http://") + hostHeader;

        // Forward realistic browser headers
        const headers = {
            "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
            "sec-ch-ua": req.headers["sec-ch-ua"] || '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            "sec-ch-ua-mobile": req.headers["sec-ch-ua-mobile"] || "?0",
            "sec-ch-ua-platform": req.headers["sec-ch-ua-platform"] || '"Linux"',
            "upgrade-insecure-requests": "1",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
        };

        if (req.headers["content-type"]) {
            headers["Content-Type"] = req.headers["content-type"];
        }

        let bodyBuffer = undefined;
        if (req.method === "POST") {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            bodyBuffer = Buffer.concat(chunks);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18000);

        let response;
        try {
            response = await fetch(parsedTarget.href, {
                method: req.method === "HEAD" ? "HEAD" : (req.method === "POST" ? "POST" : "GET"),
                headers,
                body: bodyBuffer,
                redirect: "follow",
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        let finalUrl = response.url || parsedTarget.href;
        let contentType = response.headers.get("content-type") || "text/html";
        let isHtml = contentType.toLowerCase().includes("text/html");

        let html = null;
        if (isHtml) {
            html = await response.text();

            // Check if this is an intermediate client-side redirect landing page (e.g. Bing redirect)
            const intermediateTarget = extractClientRedirectTarget(html, finalUrl);
            if (intermediateTarget && intermediateTarget !== finalUrl) {
                // Follow redirect immediately server-side
                const subController = new AbortController();
                const subTimeout = setTimeout(() => subController.abort(), 15000);
                try {
                    const secondResponse = await fetch(intermediateTarget, {
                        method: "GET",
                        headers,
                        redirect: "follow",
                        signal: subController.signal
                    });
                    response = secondResponse;
                    finalUrl = secondResponse.url || intermediateTarget;
                    contentType = secondResponse.headers.get("content-type") || "text/html";
                    isHtml = contentType.toLowerCase().includes("text/html");
                    if (isHtml) {
                        html = await secondResponse.text();
                    } else {
                        html = null;
                    }
                } catch (_) {
                    // Fall back to original HTML if subfetch fails
                } finally {
                    clearTimeout(subTimeout);
                }
            }
        }

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
        resHeaders["X-Final-URL"] = finalUrl;

        // Node fetch automatically decompresses body (gzip/br/deflate).
        // MUST strip content-encoding and content-length for ALL responses to prevent client decompression failures.
        delete resHeaders["content-length"];
        delete resHeaders["content-encoding"];

        if (isHtml && html !== null) {
            // Inject <base href="..."> and helper script
            const injectedSnippet = `<base href="${finalUrl}">${generateInjectedScript(finalUrl, proxyOrigin)}`;
            if (html.includes("<head>")) {
                html = html.replace("<head>", `<head>${injectedSnippet}`);
            } else if (html.includes("<HEAD>")) {
                html = html.replace("<HEAD>", `<HEAD>${injectedSnippet}`);
            } else {
                html = injectedSnippet + html;
            }

            res.writeHead(response.status, resHeaders);
            return res.end(html);
        } else {
            // Binary or streaming content (images, fonts, stylesheets, non-HTML)
            res.writeHead(response.status, resHeaders);
            if (html !== null) {
                return res.end(html);
            }
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
    handleBrowserProxyRoute,
    unwrapTrackerUrl,
    extractClientRedirectTarget
};
