/**
 * services/deepsearch/engines/fetch_page.js
 * =========================================
 * DeepSearch Source-Digger Page Content Reader.
 * Fetches and distills readable textual content and references from a URL.
 */

const { execFile } = require("child_process");

function decodeHtmlEntities(str) {
    if (!str) return "";
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clean and convert raw HTML into readable text.
 */
function cleanHtmlToMarkdown(html, maxChars = 15000) {
    // Strip irrelevant blocks
    let cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<svg[\s\S]*?<\/svg>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");

    // Extract title
    const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "")) : "";

    // Convert basic headings and paragraphs
    cleaned = cleaned
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1")
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n")
        .replace(/<br\s*[\/]?>/gi, "\n");

    // Strip remaining HTML tags
    let text = cleaned.replace(/<[^>]+>/g, "");
    text = decodeHtmlEntities(text);

    // Normalize whitespace
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    if (text.length > maxChars) {
        text = text.substring(0, maxChars) + "\n\n...[Content truncated for length]...";
    }

    return {
        title: pageTitle,
        text
    };
}

/**
 * Extract outbound links from raw HTML.
 */
function extractLinks(html, baseUrl) {
    const links = new Set();
    const linkMatches = [...html.matchAll(/<a[^>]+href="([^"#\s]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of linkMatches) {
        try {
            const raw = m[1];
            const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "")).trim();
            const abs = new URL(raw, baseUrl).toString();
            if (abs.startsWith("http") && text.length > 2 && text.length < 100) {
                links.add(JSON.stringify({ title: text, url: abs }));
            }
        } catch (_) {}
    }
    return Array.from(links).slice(0, 15).map(l => JSON.parse(l));
}

/**
 * Fetch a webpage using fast HTTP fetch, falling back to headless Chromium if needed.
 * @param {string} url - Target URL
 * @param {Object} options - { maxChars, extractLinks, timeoutMs }
 * @returns {Promise<{url: string, title: string, content: string, links?: Array}>}
 */
async function fetchWebpage(url, options = {}) {
    if (!url || !url.startsWith("http")) {
        throw new Error("Target URL must be a valid http/https string.");
    }

    const maxChars = options.maxChars || 15000;
    const needLinks = options.extractLinks === true;
    const timeoutMs = options.timeoutMs || 15000;

    let html = "";

    // Stage 1: Fast fetch
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
            html = await res.text();
        }
    } catch (_) {
        // Fallback to Chromium
    }

    // Stage 2: If raw fetch failed or returned minimal JS shell, use Chromium dump
    if (!html || html.length < 500) {
        html = await new Promise((resolve) => {
            const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
            const args = [
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                `--user-agent=${userAgent}`,
                "--dump-dom",
                url
            ];
            execFile("chromium", args, { maxBuffer: 15 * 1024 * 1024, timeout: timeoutMs, encoding: "utf8" }, (err, stdout) => {
                resolve(stdout || "");
            });
        });
    }

    if (!html) {
        throw new Error(`Failed to retrieve readable content from: ${url}`);
    }

    const { title, text } = cleanHtmlToMarkdown(html, maxChars);
    const result = {
        url,
        title,
        content: text
    };

    if (needLinks) {
        result.links = extractLinks(html, url);
    }

    return result;
}

module.exports = {
    fetchWebpage
};
