/**
 * services/deepsearch/engines/duckduckgo.js
 * =========================================
 * Comprehensive Headless DuckDuckGo Search Engine for DeepSearch.
 * Extracts:
 * 1. DuckAssist AI Overview (summary + verified citations)
 * 2. Knowledge Box (Entity summary + Wikipedia link)
 * 3. Related Searches (10 curated query expansions)
 * 4. Dictionary / Instant Answers (definitions, phonetic pronunciation)
 * 5. Organic Results (positions, titles, canonical URLs, snippets)
 * 6. Date Filtering (past day 'd', past week 'w', past month 'm', past year 'y')
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
        .replace(/\u200B/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Fallback parser for html.duckduckgo.com (lite mode)
 */
function parseLiteHtml(html, maxResults = 10) {
    const results = [];
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    const titlesAndUrls = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
        let rawUrl = m[1];
        let title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ""));

        let finalUrl = rawUrl;
        if (rawUrl.includes("uddg=")) {
            const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
            if (uddgMatch) {
                finalUrl = decodeURIComponent(uddgMatch[1]);
            }
        } else if (rawUrl.startsWith("//")) {
            finalUrl = "https:" + rawUrl;
        }

        titlesAndUrls.push({ title, url: finalUrl });
        if (titlesAndUrls.length >= maxResults) break;
    }

    const snippets = [];
    while ((m = snippetRegex.exec(html)) !== null) {
        snippets.push(decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")));
        if (snippets.length >= maxResults) break;
    }

    for (let i = 0; i < titlesAndUrls.length; i++) {
        results.push({
            position: i + 1,
            title: titlesAndUrls[i].title,
            url: titlesAndUrls[i].url,
            snippet: snippets[i] || ""
        });
    }

    return {
        ai_overview: null,
        knowledge_box: null,
        related_searches: [],
        definition: null,
        organic_results: results
    };
}

/**
 * Parse rich DuckDuckGo DOM
 */
function parseRichDuckDuckGo(html, options = {}) {
    const {
        maxResults = 10,
        includeAiOverview = true,
        includeKnowledgeBox = true,
        includeRelatedSearches = true
    } = options;

    // 1. DuckAssist AI Overview
    let aiOverview = null;
    if (includeAiOverview) {
        const daIdx = html.indexOf("data-testid=\"duckassist-answer-content\"");
        if (daIdx !== -1) {
            const chunk = html.slice(daIdx, daIdx + 4000);
            
            // Extract paragraph text
            const pMatch = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
            const text = pMatch 
                ? decodeHtmlEntities(pMatch[1].replace(/<[^>]+>/g, " "))
                : "";

            // Extract citations
            const citations = [];
            const aRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let am;
            while ((am = aRegex.exec(chunk)) !== null) {
                const href = am[1];
                if (href.startsWith("http") && !href.includes("duckduckgo.com")) {
                    const title = decodeHtmlEntities(am[2].replace(/<[^>]+>/g, " "));
                    if (!citations.some(c => c.url === href)) {
                        citations.push({
                            title: title || href,
                            url: href
                        });
                    }
                }
                if (citations.length >= 6) break;
            }

            if (text) {
                aiOverview = {
                    text,
                    citations
                };
            }
        }
    }

    // 2. Knowledge Box (Entity info)
    let knowledgeBox = null;
    if (includeKnowledgeBox) {
        const kbIdx = html.indexOf("data-testid=\"about-pole-redesign\"");
        if (kbIdx !== -1) {
            const rawChunk = html.slice(kbIdx, kbIdx + 3500);
            const contentStart = rawChunk.indexOf(">") !== -1 ? rawChunk.indexOf(">") + 1 : 0;
            const chunk = rawChunk.slice(contentStart);
            
            // Extract clean text
            const summary = decodeHtmlEntities(
                chunk.replace(/<button[\s\S]*?<\/button>/gi, "")
                     .replace(/More Images/gi, "")
                     .replace(/About/gi, "")
                     .replace(/<[^>]+>/g, " ")
            ).slice(0, 500);

            const wikiMatch = chunk.match(/href="([^"]*wikipedia\.org[^"]*)"/i);

            knowledgeBox = {
                summary,
                wikipedia_url: wikiMatch ? wikiMatch[1] : null
            };
        }
    }

    // 3. Related Searches
    const relatedSearches = [];
    if (includeRelatedSearches) {
        const relRegex = /<a[^>]+class="[^"]*js-related-searches-link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let rm;
        while ((rm = relRegex.exec(html)) !== null && relatedSearches.length < 10) {
            const queryText = decodeHtmlEntities(rm[2].replace(/<[^>]+>/g, " "));
            if (queryText && !relatedSearches.includes(queryText)) {
                relatedSearches.push(queryText);
            }
        }
    }

    // 4. Definition / Instant Answer
    let definition = null;
    const defIdx = html.indexOf("module--definitions");
    if (defIdx !== -1) {
        const chunk = html.slice(defIdx, defIdx + 2000);
        const text = decodeHtmlEntities(chunk.replace(/<[^>]+>/g, " "));
        if (text) {
            definition = text.slice(0, 300);
        }
    }

    // 5. Organic Results
    const organicResults = [];
    const artParts = html.split(/<article\b[^>]*>/i).slice(1);

    for (let i = 0; i < artParts.length && organicResults.length < maxResults; i++) {
        const art = artParts[i].split(/<\/article>/i)[0];

        // Title and URL from data-testid="result-title-a"
        const titleLinkMatch = art.match(/<a[^>]+href="([^"]+)"[^>]+data-testid="result-title-a"[^>]*>([\s\S]*?)<\/a>/i) ||
                               art.match(/<a[^>]+data-testid="result-title-a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

        if (!titleLinkMatch) continue;

        const url = titleLinkMatch[1];
        const title = decodeHtmlEntities(titleLinkMatch[2].replace(/<[^>]+>/g, " "));

        // Extract snippet text
        let snippet = "";
        const snipMatch = art.match(/class="[^"]*(?:snippet|og-description)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i) ||
                          art.match(/<div[^>]+data-result="snippet"[^>]*>([\s\S]*?)<\/div>/i);

        if (snipMatch) {
            snippet = decodeHtmlEntities(snipMatch[1].replace(/<[^>]+>/g, " "));
        } else {
            snippet = decodeHtmlEntities(
                art.replace(/<button[\s\S]*?<\/button>/gi, "")
                   .replace(/<a[\s\S]*?<\/a>/gi, "")
                   .replace(/<[^>]+>/g, " ")
            ).slice(0, 250);
        }

        organicResults.push({
            position: organicResults.length + 1,
            title,
            url,
            snippet
        });
    }

    return {
        ai_overview: aiOverview,
        knowledge_box: knowledgeBox,
        related_searches: relatedSearches,
        definition,
        organic_results: organicResults
    };
}

/**
 * Search DuckDuckGo.
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.maxResults=10]
 * @param {boolean} [options.includeAiOverview=true]
 * @param {boolean} [options.includeKnowledgeBox=true]
 * @param {boolean} [options.includeRelatedSearches=true]
 * @param {string} [options.dateFilter] - Optional date filter: 'd' (day), 'w' (week), 'm' (month), 'y' (year)
 * @param {number} [options.timeoutMs=20000]
 * @returns {Promise<Object>}
 */
async function searchDuckDuckGo(query, options = {}) {
    if (!query || typeof query !== "string") {
        throw new Error("Search query must be a non-empty string.");
    }

    const maxResults = typeof options.maxResults === "number" ? options.maxResults : (typeof options === "number" ? options : 10);
    const includeAiOverview = options.includeAiOverview !== false;
    const includeKnowledgeBox = options.includeKnowledgeBox !== false;
    const includeRelatedSearches = options.includeRelatedSearches !== false;
    const timeoutMs = options.timeoutMs || 20000;

    let searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    if (options.dateFilter && ["d", "w", "m", "y"].includes(options.dateFilter.toLowerCase())) {
        searchUrl += `&df=${options.dateFilter.toLowerCase()}`;
    }

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
        "--metrics-recording-only",
        "--no-first-run",
        `--user-agent=${userAgent}`,
        "--dump-dom",
        searchUrl
    ];

    try {
        const html = await new Promise((resolve, reject) => {
            execFile("chromium", args, {
                maxBuffer: 15 * 1024 * 1024,
                timeout: timeoutMs,
                encoding: "utf8"
            }, (err, stdout) => {
                if (err) return reject(err);
                resolve(stdout || "");
            });
        });

        const parsed = parseRichDuckDuckGo(html, {
            maxResults,
            includeAiOverview,
            includeKnowledgeBox,
            includeRelatedSearches
        });
        
        if (!parsed.organic_results || parsed.organic_results.length === 0) {
            console.warn("[DuckDuckGo] Rich DOM returned 0 organic results, falling back to lite HTML...");
            return await searchDuckDuckGoLite(query, maxResults);
        }

        return {
            engine: "duckduckgo",
            query,
            date_filter: options.dateFilter || null,
            ai_overview: parsed.ai_overview,
            knowledge_box: parsed.knowledge_box,
            related_searches: parsed.related_searches,
            definition: parsed.definition,
            organic_results: parsed.organic_results
        };
    } catch (err) {
        console.warn(`[DuckDuckGo] Full browser search error: ${err.message}. Falling back to lite HTML...`);
        return await searchDuckDuckGoLite(query, maxResults);
    }
}

/**
 * Fallback to html.duckduckgo.com for zero-browser / mobile environments.
 */
async function searchDuckDuckGoLite(query, maxResults = 10) {
    const liteUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

    const args = [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--blink-settings=imagesEnabled=false",
        `--user-agent=${userAgent}`,
        "--dump-dom",
        liteUrl
    ];

    const html = await new Promise((resolve, reject) => {
        execFile("chromium", args, {
            maxBuffer: 15 * 1024 * 1024,
            timeout: 15000,
            encoding: "utf8"
        }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout || "");
        });
    });

    const parsed = parseLiteHtml(html, maxResults);
    return {
        engine: "duckduckgo_lite",
        query,
        date_filter: null,
        ai_overview: null,
        knowledge_box: null,
        related_searches: [],
        definition: null,
        organic_results: parsed.organic_results
    };
}

module.exports = {
    searchDuckDuckGo,
    searchDuckDuckGoLite
};
