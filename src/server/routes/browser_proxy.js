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
 * - Full client fetch() / XHR proxying so search engine suggestions and dynamic results work
 * - <base href> always pointing to the proxy root so relative URLs never escape to the real domain
 * - Cookie jar per domain (server-side forwarding) so search engines maintain session state
 * - Synchronizing current URL and title with the parent window via postMessage
 * - Content-Encoding header normalization to avoid decoding corruption
 */

// ─── Per-domain cookie jar (simple, in-memory) ───────────────────────────────
const cookieJar = new Map(); // hostname → cookie string

function storeCookies(hostname, setCookieHeaders) {
    if (!setCookieHeaders) return;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const existing = cookieJar.get(hostname) || "";
    // Parse existing into a Map
    const jar = new Map();
    if (existing) {
        for (const pair of existing.split("; ")) {
            const idx = pair.indexOf("=");
            if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
        }
    }
    for (const header of list) {
        // "name=value; Path=/; Secure; SameSite=Lax"
        const firstPart = header.split(";")[0].trim();
        const idx = firstPart.indexOf("=");
        if (idx > 0) {
            jar.set(firstPart.slice(0, idx), firstPart.slice(idx + 1));
        }
    }
    cookieJar.set(hostname, Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; "));
}

function getCookies(hostname) {
    return cookieJar.get(hostname) || "";
}

// ─── Tracker URL unwrapping ───────────────────────────────────────────────────
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

// ─── Injected client script ───────────────────────────────────────────────────
function generateInjectedScript(currentUrl, proxyOrigin) {
    return `<script id="__multiai_browser_helper__">
(function() {
    'use strict';
    const CURRENT_URL = ${JSON.stringify(currentUrl)};
    const PROXY_BASE  = ${JSON.stringify(proxyOrigin || "http://localhost:4440")} + "/api/browser/proxy?url=";

    // ── Helper: resolve any URL and route through proxy ──────────────────────
    function toProxyUrl(rawHref) {
        if (!rawHref) return "";
        // Already a proxy URL
        if (typeof rawHref === "string" && rawHref.startsWith(PROXY_BASE)) return rawHref;

        let dest = rawHref;
        try { dest = new URL(rawHref, CURRENT_URL).href; } catch (_) { return rawHref; }

        if (dest.startsWith("javascript:") || dest.startsWith("mailto:") ||
            dest.startsWith("tel:") || dest.startsWith("data:")) return dest;

        // Unwrap tracker redirect links on the client side
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

        return PROXY_BASE + encodeURIComponent(dest);
    }

    // ── 1. Notify parent of current URL / title ───────────────────────────────
    function notifyParent(urlOverride, titleOverride) {
        try {
            window.parent.postMessage({
                type: "MULTIAI_BROWSER_NAVIGATED",
                url:   urlOverride  || CURRENT_URL,
                title: titleOverride || document.title || urlOverride || CURRENT_URL
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

    // ── 2. Proxy window.fetch() ───────────────────────────────────────────────
    (function patchFetch() {
        if (typeof window.fetch !== "function") return;
        const _fetch = window.fetch.bind(window);
        window.fetch = function(resource, init) {
            try {
                let url;
                if (resource instanceof Request) {
                    url = resource.url;
                } else {
                    url = String(resource);
                }
                // Only intercept absolute http/https URLs that don't already go through proxy
                let resolved;
                try { resolved = new URL(url, CURRENT_URL).href; } catch (_) { resolved = url; }
                if ((resolved.startsWith("http://") || resolved.startsWith("https://")) &&
                    !resolved.startsWith(PROXY_BASE)) {
                    const proxied = PROXY_BASE + encodeURIComponent(resolved);
                    if (resource instanceof Request) {
                        resource = new Request(proxied, { ...init, ...resource });
                    } else {
                        resource = proxied;
                    }
                }
            } catch (_) {}
            return _fetch(resource, init);
        };
    })();

    // ── 3. Proxy XMLHttpRequest ───────────────────────────────────────────────
    (function patchXHR() {
        if (typeof XMLHttpRequest === "undefined") return;
        const _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            try {
                let resolved;
                try { resolved = new URL(String(url), CURRENT_URL).href; } catch (_) { resolved = String(url); }
                if ((resolved.startsWith("http://") || resolved.startsWith("https://")) &&
                    !resolved.startsWith(PROXY_BASE)) {
                    url = PROXY_BASE + encodeURIComponent(resolved);
                }
            } catch (_) {}
            return _open.call(this, method, url, async !== undefined ? async : true, user, password);
        };
    })();

    // ── 4. Patch Location.prototype.assign / replace ──────────────────────────
    // These are patched AFTER the href-setter patch so they can use nativeNavigate.
    // We defer them into a closure that runs after nativeNavigate is defined.
    // (They're defined below, after nativeNavigate is set up.)

    // ── 5. Patch History.pushState / replaceState (SPA navigation) ───────────
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

    // ── 6. Intercept location.href setter ────────────────────────────────────
    // DuckDuckGo autocomplete & many SPAs set location.href = "/path" or
    // window.location.href = url directly from JS, going through Location.prototype's
    // href setter. We capture the native setter BEFORE redefining it so that
    // assign/replace/nativeNavigate can call it without infinite recursion.
    let _nativeHrefSetter = null;
    try {
        const locProto = Object.getPrototypeOf(window.location);
        const origDesc = Object.getOwnPropertyDescriptor(locProto, "href");
        if (origDesc && typeof origDesc.set === "function") {
            _nativeHrefSetter = origDesc.set;
            Object.defineProperty(locProto, "href", {
                configurable: true,
                enumerable:   origDesc.enumerable,
                get: origDesc.get,
                set: function(url) {
                    const proxied = toProxyUrl(String(url));
                    try { _nativeHrefSetter.call(this, proxied); } catch (_) {}
                }
            });
        }
    } catch (_) {}

    // Helper: navigate via native setter (no double-proxy risk)
    function nativeNavigate(url) {
        const proxied = toProxyUrl(String(url));
        if (_nativeHrefSetter) {
            try { _nativeHrefSetter.call(window.location, proxied); return; } catch (_) {}
        }
        // Fallback — hits the patched setter but toProxyUrl is idempotent for already-proxied URLs
        window.location.href = proxied;
    }

    // ── 4 (deferred). Patch Location.prototype.assign / replace ──────────────
    // Now that nativeNavigate exists, wire assign/replace to it.
    try {
        if (typeof Location !== "undefined" && Location.prototype) {
            Location.prototype.assign  = function(url) { nativeNavigate(String(url)); };
            Location.prototype.replace = function(url) { nativeNavigate(String(url)); };
        }
    } catch (_) {}

    // ── 6b. Patch HTMLFormElement.prototype.submit ────────────────────────────
    // DDG calls form.submit() directly from JS — this bypasses addEventListener('submit').
    try {
        const _formSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype._multiai_real_submit = _formSubmit; // expose for submit-event handler
        HTMLFormElement.prototype.submit = function() {
            const method = (this.getAttribute("method") || "GET").toUpperCase();
            const rawAction = this.getAttribute("action") || CURRENT_URL;
            try {
                const actionUrl = new URL(rawAction, CURRENT_URL);
                const formData = new FormData(this);
                if (method === "GET") {
                    for (const [key, val] of formData.entries()) {
                        actionUrl.searchParams.append(key, val);
                    }
                    nativeNavigate(actionUrl.href);
                } else {
                    this.action = toProxyUrl(actionUrl.href);
                    return _formSubmit.call(this);
                }
            } catch (_) {
                return _formSubmit.call(this);
            }
        };
    } catch (_) {}

    // ── 7. Intercept all link clicks (capture phase, mousedown + click) ───────
    // mousedown handles DuckDuckGo-style links that set href on mousedown
    document.addEventListener("mousedown", function(e) {
        if (e.button !== 0) return;
        const a = e.target.closest("a[href]");
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
        // Cache so the click handler can read the latest resolved href
        a._multiai_pending_href = a.href || href;
    }, true);
    document.addEventListener("click", function(e) {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const finalHref = a._multiai_pending_href || a.dataset.url || a.href || href;
        a._multiai_pending_href = null;
        nativeNavigate(finalHref);
    }, true);

    // ── 8. Intercept form submissions (event-based) ───────────────────────────
    document.addEventListener("submit", function(e) {
        const form = e.target;
        if (!form) return;
        const method = (form.getAttribute("method") || "GET").toUpperCase();
        const action = form.getAttribute("action") || CURRENT_URL;
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
            const actionUrl = new URL(action, CURRENT_URL);
            const formData = new FormData(form);
            if (method === "GET") {
                for (const [key, val] of formData.entries()) {
                    actionUrl.searchParams.append(key, val);
                }
                nativeNavigate(actionUrl.href);
            } else {
                form.action = toProxyUrl(actionUrl.href);
                // Use the real (unpatched) submit for POST — avoids re-entering our GET path
                const realSubmit = HTMLFormElement.prototype._multiai_real_submit;
                if (realSubmit) realSubmit.call(form);
            }
        } catch (_) {
            nativeNavigate(action);
        }
    }, true);

    // ── 9. Intercept window.open ──────────────────────────────────────────────
    try {
        window.open = function(url, target, features) {
            if (url) { nativeNavigate(url); return window; }
        };
    } catch (_) {}

    // ── 10. Intercept meta refresh ────────────────────────────────────────────
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

    // ── 11. Rewrite all <a href> and <form action> in document on load ────────
    // Covers statically rendered links that click handlers might miss
    function rewriteStaticLinks() {
        try {
            document.querySelectorAll("a[href]").forEach(function(a) {
                const href = a.getAttribute("href");
                if (!href || href.startsWith("#") || href.startsWith("javascript:") ||
                    href.startsWith("mailto:") || href.startsWith("data:")) return;
                if (href.startsWith(PROXY_BASE)) return;
                try {
                    const abs = new URL(href, CURRENT_URL).href;
                    if (abs.startsWith("http://") || abs.startsWith("https://")) {
                        a.setAttribute("href", toProxyUrl(abs));
                        a.setAttribute("target", "_self");
                    }
                } catch (_) {}
            });
            document.querySelectorAll("form[action]").forEach(function(form) {
                const action = form.getAttribute("action");
                if (!action || action.startsWith(PROXY_BASE)) return;
                try {
                    const abs = new URL(action, CURRENT_URL).href;
                    if (abs.startsWith("http://") || abs.startsWith("https://")) {
                        form.setAttribute("action", toProxyUrl(abs));
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", rewriteStaticLinks);
    } else {
        rewriteStaticLinks();
    }
    // Also rewrite after any dynamic mutations (DDG injects results via JS)
    try {
        const mo = new MutationObserver(function() { rewriteStaticLinks(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        // Don't observe forever — stop after 30 s to avoid overhead on stable pages
        setTimeout(function() { mo.disconnect(); }, 30000);
    } catch (_) {}

    // ── 12. Embedded element inspector for iframe (Jetski Preview parity) ─────
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
                tagDisplay: tag + classes,
                dimsDisplay: r.width.toFixed(1) + " \u00d7 " + r.height.toFixed(1),
                rect: { top: r.top, left: r.left, width: parseFloat(r.width.toFixed(2)), height: parseFloat(r.height.toFixed(2)), x: Math.round(r.x), y: Math.round(r.y) },
                styles: {
                    color: rgbToHex(cs.color), rawColor: cs.color,
                    backgroundColor: rgbToHex(cs.backgroundColor), rawBg: cs.backgroundColor,
                    font: cs.fontSize + " " + cs.fontFamily.split(",")[0].replace(/['"]/g, ""),
                    padding: (cs.paddingTop + " " + cs.paddingRight).replace(/px/g, "px ")
                },
                accessibility: { name: a11yName, role: a11yRole, focusable: isFocusable },
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
            iframeOverlay.style.top    = r.top    + "px";
            iframeOverlay.style.left   = r.left   + "px";
            iframeOverlay.style.width  = r.width  + "px";
            iframeOverlay.style.height = r.height + "px";
            const data = extractData(el);
            try {
                window.parent.postMessage({ type: "MULTIAI_ELEMENT_HOVER", elementData: data, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }, "*");
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
            try { window.parent.postMessage({ type: "MULTIAI_ELEMENT_SELECTED", elementData: data }, "*"); } catch (_) {}
        }

        function onIframeScroll() {
            if (iframeInspectActive && currentHoverEl) sendHover(currentHoverEl);
        }

        function onIframeLeave() {
            currentHoverEl = null;
            if (iframeOverlay) iframeOverlay.style.display = "none";
            try { window.parent.postMessage({ type: "MULTIAI_ELEMENT_UNHOVER" }, "*"); } catch (_) {}
        }

        function setInspectActive(active) {
            iframeInspectActive = active;
            if (active) {
                document.addEventListener("mousemove",  onIframeMove,  true);
                document.addEventListener("click",      onIframeClick, true);
                window.addEventListener("scroll",       onIframeScroll, true);
                document.addEventListener("mouseleave", onIframeLeave,  true);
            } else {
                currentHoverEl = null;
                document.removeEventListener("mousemove",  onIframeMove,  true);
                document.removeEventListener("click",      onIframeClick, true);
                window.removeEventListener("scroll",       onIframeScroll, true);
                document.removeEventListener("mouseleave", onIframeLeave,  true);
                if (iframeOverlay) iframeOverlay.style.display = "none";
                try { window.parent.postMessage({ type: "MULTIAI_ELEMENT_UNHOVER" }, "*"); } catch (_) {}
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

// ─── Main proxy route handler ─────────────────────────────────────────────────
async function handleBrowserProxyRoute(req, res) {
    // Handle CORS preflight so proxied XHR/fetch inside the iframe works
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

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

        // Forward realistic browser headers + stored cookies for this domain
        const cookies = getCookies(parsedTarget.hostname);
        const headers = {
            "User-Agent":          req.headers["user-agent"] || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept":              req.headers["accept"] || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language":     req.headers["accept-language"] || "en-US,en;q=0.9",
            "sec-ch-ua":           '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            "sec-ch-ua-mobile":    "?0",
            "sec-ch-ua-platform":  '"Linux"',
            "upgrade-insecure-requests": "1",
            "sec-fetch-dest":      "document",
            "sec-fetch-mode":      "navigate",
            "sec-fetch-site":      "none",
            "sec-fetch-user":      "?1",
        };
        if (cookies) headers["Cookie"] = cookies;
        if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];

        let bodyBuffer;
        if (req.method === "POST") {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            bodyBuffer = Buffer.concat(chunks);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18000);

        let response;
        try {
            response = await fetch(parsedTarget.href, {
                method:   req.method === "HEAD" ? "HEAD" : (req.method === "POST" ? "POST" : "GET"),
                headers,
                body:     bodyBuffer,
                redirect: "follow",
                signal:   controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        // Persist cookies from the response
        const setCookieHeader = response.headers.get("set-cookie");
        if (setCookieHeader) storeCookies(parsedTarget.hostname, setCookieHeader);

        let finalUrl    = response.url || parsedTarget.href;
        let contentType = response.headers.get("content-type") || "text/html";
        let isHtml      = contentType.toLowerCase().includes("text/html");

        let html = null;
        if (isHtml) {
            html = await response.text();

            // Follow server-side JS / meta-refresh redirects (e.g. Bing ad redirects)
            const intermediateTarget = extractClientRedirectTarget(html, finalUrl);
            if (intermediateTarget && intermediateTarget !== finalUrl) {
                const subController = new AbortController();
                const subTimeout = setTimeout(() => subController.abort(), 15000);
                try {
                    const secondResponse = await fetch(intermediateTarget, {
                        method: "GET", headers, redirect: "follow", signal: subController.signal
                    });
                    const sc2 = secondResponse.headers.get("set-cookie");
                    if (sc2) storeCookies(parsedTarget.hostname, sc2);
                    response    = secondResponse;
                    finalUrl    = secondResponse.url || intermediateTarget;
                    contentType = secondResponse.headers.get("content-type") || "text/html";
                    isHtml      = contentType.toLowerCase().includes("text/html");
                    html        = isHtml ? await secondResponse.text() : null;
                } catch (_) {
                    // Fall back to original HTML
                } finally {
                    clearTimeout(subTimeout);
                }
            }
        }

        // Build safe response headers
        const resHeaders = {
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
            "X-Content-Type-Options": "nosniff",
            "X-Final-URL": finalUrl,
        };

        for (const [key, value] of response.headers.entries()) {
            const lKey = key.toLowerCase();
            // Strip headers that prevent iframe embedding, block CORS, or cause decoding issues
            if ([
                "x-frame-options",
                "content-security-policy",
                "content-security-policy-report-only",
                "strict-transport-security",
                "content-encoding",   // Node fetch auto-decompresses; re-sending causes double-decompress
                "content-length",     // Length changes after our HTML injection
                "set-cookie",         // We already stored it; re-sending breaks iframe same-origin rules
                "access-control-allow-origin",  // We set our own
            ].includes(lKey)) continue;
            resHeaders[key] = value;
        }

        if (isHtml && html !== null) {
            // <base href> must resolve to the PROXY for relative paths (e.g. /ac/?q=hello → proxied)
            // so we set it to the proxy URL for the current page — relative paths will be resolved by
            // the browser against the base href, which now points to the proxy
            const proxyBaseHref = `${proxyOrigin}/api/browser/proxy?url=${encodeURIComponent(finalUrl)}`;

            // We use a custom base + injected script.
            // The <base href> trick: we set it to the REAL url so the browser
            // resolves relative hrefs. Then our MutationObserver + fetch/XHR patches catch those
            // requests and reroute through the proxy.
            // Setting base href to the proxy URL itself breaks relative paths like "/ac/?q=" because
            // the browser would send them to localhost:4440/ac/?q= (not proxied).
            // BEST approach: set base href = real finalUrl, but intercept all network at the JS level.
            const injectedSnippet = `<base href="${finalUrl}">${generateInjectedScript(finalUrl, proxyOrigin)}`;

            if (html.includes("<head>")) {
                html = html.replace("<head>", `<head>${injectedSnippet}`);
            } else if (html.includes("<HEAD>")) {
                html = html.replace("<HEAD>", `<HEAD>${injectedSnippet}`);
            } else {
                html = injectedSnippet + html;
            }

            resHeaders["Content-Type"] = contentType.includes("charset") ? contentType : (contentType + "; charset=utf-8");
            res.writeHead(response.status, resHeaders);
            return res.end(html);
        } else {
            res.writeHead(response.status, resHeaders);
            if (html !== null) return res.end(html);
            const arrayBuf = await response.arrayBuffer();
            return res.end(Buffer.from(arrayBuf));
        }

    } catch (err) {
        console.error("[BROWSER PROXY ERROR]", err.message);
        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`
                <div style="font-family:ui-monospace,monospace;padding:32px 24px;color:#a1a1aa;background:#18181b;height:100vh;box-sizing:border-box;">
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
