/**
 * services/deepsearch/engines/google.js
 * ====================================
 * Headless Google Search Scraper for DeepSearch.
 * Uses system Chromium in stealth headless mode to bypass bot detections without API keys.
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
 * Extract Google's AI Overview / AI Mode summary and citations if present.
 */
async function extractAiOverview(html) {
    const hasAi = html.includes("AI Mode replied") || html.includes("AI Overview") || html.includes("data-container-id=\"main-col\"");
    if (!hasAi) return null;

    let containerHtml = "";
    const colMatch = html.match(/<div[^>]*data-container-id="main-col"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*MjjYud[^"]*"|$)/i);
    if (colMatch) {
        containerHtml = colMatch[0];
    } else {
        const marker = html.includes("AI Mode replied") ? "AI Mode replied" : "AI Overview";
        const startIdx = html.indexOf(marker);
        if (startIdx !== -1) {
            containerHtml = html.substring(startIdx, startIdx + 30000);
        }
    }

    if (!containerHtml) return null;

    // Extract citation links
    const rawCitations = [];
    const linkMatches = [...containerHtml.matchAll(/aria-label="([^"]+)"[^>]*href="(\/goto\?url=[^"]+|https?:\/\/[^"]+)"/gi)];
    for (const m of linkMatches) {
        rawCitations.push({
            label: decodeHtmlEntities(m[1]),
            rawHref: m[2]
        });
    }

    // Clean overview text: strip buttons, interactive widgets, scripts, styles
    const text = containerHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<svg[\s\S]*?<\/svg>/gi, "")
        .replace(/<button[\s\S]*?<\/button>/gi, "")
        .replace(/<button[^>]*>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\"")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^.*?data-container-id="main-col"[^>]*>/i, "")
        .replace(/^AI Mode replied:\s*/i, "")
        .replace(/^AI Overview\s*/i, "")
        .trim();

    // Resolve citation URLs
    const citations = await Promise.all(rawCitations.map(async (c) => {
        let finalUrl = c.rawHref;
        if (finalUrl.startsWith("/goto?url=")) {
            try {
                const fullGoto = "https://www.google.com" + finalUrl;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(fullGoto, { redirect: "manual", signal: controller.signal });
                clearTimeout(timer);
                const loc = res.headers.get("location");
                if (loc && loc.startsWith("http")) finalUrl = loc;
            } catch (e) {}
        }
        return {
            label: c.label,
            url: finalUrl
        };
    }));

    return {
        present: true,
        text,
        citations
    };
}

/**
 * Extract "People Also Ask" questions from Google SERP.
 */
function extractPeopleAlsoAsk(html) {
    const questions = new Set();
    const dataQMatches = [...html.matchAll(/data-q="([^"]+)"/gi)];
    for (const m of dataQMatches) {
        const q = decodeHtmlEntities(m[1]);
        if (q && q.length > 5 && q.length < 150) {
            questions.add(q);
        }
    }

    if (questions.size === 0) {
        const spanMatches = [...html.matchAll(/<span[^>]*class="[^"]*CSkcDe[^"]*"[^>]*>([^<]+)<\/span>/gi)];
        for (const m of spanMatches) {
            const q = decodeHtmlEntities(m[1]);
            if (q && q.length > 5 && q.length < 150) {
                questions.add(q);
            }
        }
    }

    return Array.from(questions).slice(0, 8);
}

/**
 * Extract Knowledge Graph entity details if present.
 */
function extractKnowledgeGraph(html) {
    const hasKg = html.includes("data-attrid") || html.includes("knowledge-panel");
    if (!hasKg) return null;

    const kg = { title: "", subtitle: "", attributes: {} };
    const titleMatch = html.match(/data-attrid="title"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    if (titleMatch) {
        kg.title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ""));
    }

    const subMatch = html.match(/data-attrid="subtitle"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    if (subMatch) {
        kg.subtitle = decodeHtmlEntities(subMatch[1].replace(/<[^>]+>/g, ""));
    }

    const attrMatches = [...html.matchAll(/data-attrid="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)];
    for (const m of attrMatches) {
        const key = m[1];
        if (["title", "subtitle", "image"].includes(key)) continue;
        const val = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ""));
        if (val && val.length > 1 && val.length < 300) {
            const cleanKey = key.replace(/^(?:kc:\/|hw:\/)/, "").replace(/_/g, " ");
            kg.attributes[cleanKey] = val;
        }
    }

    return (kg.title || Object.keys(kg.attributes).length > 0) ? kg : null;
}

/**
 * Extract related search queries from Google SERP.
 */
function extractRelatedSearches(html, originalQuery) {
    const queries = new Set();
    const matches = [...html.matchAll(/<div[^>]*class="[^"]*(?:s75CSd|BNeawe)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];
    for (const m of matches) {
        const text = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ""));
        if (text && text.toLowerCase() !== originalQuery.toLowerCase() && text.length > 3 && text.length < 80) {
            queries.add(text);
        }
    }
    return Array.from(queries).slice(0, 8);
}
/**
 * Fetch a single SERP page from Google using headless Chromium.
 */
async function fetchGooglePage(query, startIndex = 0, timeoutMs = 20000) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en${startIndex > 0 ? `&start=${startIndex}` : ""}`;
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

    const args = [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--blink-settings=imagesEnabled=false",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-client-side-phishing-detection",
        "--metrics-recording-only",
        "--no-first-run",
        "--safebrowsing-disable-auto-update",
        `--user-agent=${userAgent}`,
        "--dump-dom",
        searchUrl
    ];

    return new Promise((resolve, reject) => {
        execFile("chromium", args, {
            maxBuffer: 15 * 1024 * 1024,
            timeout: timeoutMs,
            encoding: "utf8"
        }, (err, stdout) => {
            if (err) {
                return reject(new Error(`Chromium execution failed: ${err.message}`));
            }
            resolve(stdout || "");
        });
    });
}

/**
 * Execute headless Chromium to search Google with configurable rich extractions.
 * @param {string} query - Search query.
 * @param {Object|number} options - Options object or maxResults number.
 * @returns {Promise<{results: Array, aiOverview?: Object, peopleAlsoAsk?: Array, knowledgeGraph?: Object, relatedSearches?: Array}>}
 */
async function searchGoogle(query, options = {}) {
    if (!query || typeof query !== "string") {
        throw new Error("Search query must be a non-empty string.");
    }

    const opts = typeof options === "number" ? { maxResults: options } : (options || {});
    const maxResults = typeof opts.maxResults === "number" ? opts.maxResults : 10;
    const includeAiOverview = opts.includeAiOverview !== false;
    const includePaa = opts.includePaa !== false;
    const includeKnowledgeGraph = opts.includeKnowledgeGraph !== false;
    const includeRelatedSearches = opts.includeRelatedSearches !== false;
    const timeoutMs = opts.timeoutMs || 20000;

    const allItems = [];
    let currentStart = 0;
    let aiOverview = null;
    let peopleAlsoAsk = [];
    let knowledgeGraph = null;
    let relatedSearches = [];

    while (allItems.length < maxResults) {
        const html = await fetchGooglePage(query, currentStart, timeoutMs);

        // Accurate CAPTCHA / bot challenge check (avoiding false positives when snippets discuss recaptcha)
        const isBotChallenge = html.includes("id=\"captcha-form\"") ||
            html.includes("action=\"CaptchaRedirect\"") ||
            html.includes("Our systems have detected unusual traffic from your computer network");
        if (isBotChallenge) {
            throw new Error("Google CAPTCHA triggered. Fallback needed.");
        }

        // On first page, extract rich metadata if requested
        if (currentStart === 0) {
            if (includeAiOverview) {
                aiOverview = await extractAiOverview(html);
            }
            if (includePaa) {
                peopleAlsoAsk = extractPeopleAlsoAsk(html);
            }
            if (includeKnowledgeGraph) {
                knowledgeGraph = extractKnowledgeGraph(html);
            }
            if (includeRelatedSearches) {
                relatedSearches = extractRelatedSearches(html, query);
            }
        }

        const cardChunks = html.split(/<div[^>]*class="[^"]*(?:MjjYud|tF2Cxc)[^"]*"[^>]*>/i);
        let addedThisRound = 0;

        for (const chunk of cardChunks) {
            const h3Match = chunk.match(/<h3[^>]*class="[^"]*LC20lb[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
            if (!h3Match) continue;
            const title = decodeHtmlEntities(h3Match[1].replace(/<[^>]+>/g, ""));
            if (!title) continue;

            const linkMatch = chunk.match(/<a[^>]+href="(\/goto\?url=[^"]+|https?:\/\/[^"]+)"[^>]*>/i);
            if (!linkMatch) continue;
            const rawHref = linkMatch[1];
            if (rawHref.includes("google.com/search") || rawHref.startsWith("#")) continue;

            let snippet = "";
            const snipMatch = chunk.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (snipMatch) {
                snippet = decodeHtmlEntities(snipMatch[1].replace(/<[^>]+>/g, ""));
            }

            allItems.push({ title, rawHref, snippet });
            addedThisRound++;
            if (allItems.length >= maxResults) break;
        }

        if (addedThisRound === 0) break;
        currentStart += 10;
        if (currentStart >= 30) break;
    }

    // Resolve /goto?url= redirects in parallel to get final direct URLs
    const resolvedResults = await Promise.all(allItems.map(async (item, idx) => {
        let finalUrl = item.rawHref;
        if (finalUrl.startsWith("/goto?url=")) {
            try {
                const fullGoto = "https://www.google.com" + finalUrl;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4000);
                const res = await fetch(fullGoto, { redirect: "manual", signal: controller.signal });
                clearTimeout(timer);
                const loc = res.headers.get("location");
                if (loc && loc.startsWith("http")) {
                    finalUrl = loc;
                }
            } catch (e) {}
        }
        return {
            position: idx + 1,
            title: item.title,
            url: finalUrl,
            snippet: item.snippet
        };
    }));

    const output = {
        results: resolvedResults
    };

    if (includeAiOverview && aiOverview) {
        output.aiOverview = aiOverview;
    }
    if (includePaa && peopleAlsoAsk && peopleAlsoAsk.length > 0) {
        output.peopleAlsoAsk = peopleAlsoAsk;
    }
    if (includeKnowledgeGraph && knowledgeGraph) {
        output.knowledgeGraph = knowledgeGraph;
    }
    if (includeRelatedSearches && relatedSearches && relatedSearches.length > 0) {
        output.relatedSearches = relatedSearches;
    }

    return output;
}

module.exports = {
    searchGoogle
};
