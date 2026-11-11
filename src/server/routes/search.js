const { sendJSON } = require("../utils");
const { getConfig } = require("../../core/config_manager");
const { searchDuckDuckGo } = require("../../services/deepsearch/engines/duckduckgo");
const { extractRagPassages, tokenize } = require("../../services/search/rag_extractor");

function getTinyFishApiKey() {
    return process.env.TINYFISH_API_KEY || getConfig().General?.TinyFishApiKey;
}

async function tinyfishSearch(args) {
    const apiKey = getTinyFishApiKey();
    if (!apiKey) {
        throw new Error("TINYFISH_API_KEY is not set in the server environment.");
    }
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Search query is empty");
    const url = new URL("https://api.search.tinyfish.ai");
    url.searchParams.set("query", query);
    if (args.location) url.searchParams.set("location", args.location);
    if (args.language) url.searchParams.set("language", args.language);
    if (args.page !== undefined) url.searchParams.set("page", String(args.page));

    const response = await fetch(url, { headers: { "X-API-Key": apiKey } });
    const text = await response.text();
    if (!response.ok) throw new Error(`TinyFish HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
}

async function tinyfishFetch(args) {
    const apiKey = getTinyFishApiKey();
    if (!apiKey) {
        throw new Error("TINYFISH_API_KEY is not set in the server environment.");
    }
    let urls = [];
    if (Array.isArray(args.urls)) {
        urls = args.urls.map(u => String(u || "").trim()).filter(Boolean);
    } else if (typeof args.url === "string" && args.url.trim()) {
        urls = [args.url.trim()];
    }
    if (urls.length === 0) throw new Error("No URL(s) provided to fetch");
    if (urls.length > 10) urls = urls.slice(0, 10);

    const format = (args.format === "html" || args.format === "json") ? args.format : "markdown";
    const response = await fetch("https://api.fetch.tinyfish.ai", {
        method: "POST",
        headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ urls, format })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TinyFish Fetch HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
}

async function duckduckgoSearch(args) {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Search query is empty");
    const maxResults = Number(args.max_results || getConfig().Search?.MaxSearchResults || 5);
    const ddgRes = await searchDuckDuckGo(query, { max_results: maxResults });
    const organic = ddgRes?.organic_results || [];
    return {
        provider: "duckduckgo",
        results: organic.slice(0, maxResults).map(r => ({
            title: r.title || "",
            url: r.url || "",
            snippet: r.snippet || ""
        }))
    };
}

/**
 * Fast stream webpage fetcher.
 * - Downloads text with 3500ms hard timeout.
 * - Strips scripts, styles, SVGs, headers, navs, and footers in memory.
 * - Zero Chromium subprocesses (runs smoothly on Termux / low-end Android).
 */
async function fetchWebpageFast(url, timeoutMs = 3500, maxChars = 25000) {
    if (!url || !url.startsWith("http")) {
        return { url, title: "", content: "" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
            },
            signal: controller.signal
        });

        clearTimeout(timer);
        if (!res.ok) {
            return { url, title: "", content: "" };
        }

        const raw = await res.text();
        const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

        // Fast clean: strip heavy non-content sections
        let cleaned = raw
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<svg[\s\S]*?<\/svg>/gi, "")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "");

        // Convert structural markers
        cleaned = cleaned
            .replace(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, "\n\n# $1\n\n")
            .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n")
            .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1")
            .replace(/<br\s*[\/]?>/gi, "\n")
            .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

        let text = cleaned
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        if (text.length > maxChars) {
            text = text.slice(0, maxChars);
        }

        return {
            url,
            title,
            content: text
        };
    } catch (_) {
        clearTimeout(timer);
        return { url, title: "", content: "" };
    }
}

/**
 * Automatically relaxes over-specific queries that returned 0 results.
 */
function relaxQuery(rawQuery) {
    if (!rawQuery) return "";
    let relaxed = rawQuery.replace(/["']/g, " ").trim();
    relaxed = relaxed.replace(/\b(and|or|not)\b/gi, " ");
    const words = tokenize(relaxed);
    if (words.length > 4) {
        return words.slice(0, 4).join(" ");
    }
    return words.join(" ");
}

/**
 * Unified search handler with PAS-BM25 Positional Attention Soft-BM25 RAG.
 */
async function unifiedSearch(args) {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Search query is empty");

    const searchConfig = getConfig().Search || {};
    const configuredProvider = (args.provider || searchConfig.Provider || "tinyfish").toLowerCase();
    const shouldPairDeepSearch = args.pair_deepsearch !== undefined 
        ? Boolean(args.pair_deepsearch) 
        : (searchConfig.PairDeepSearch !== false);

    let searchResult = null;
    let effectiveProvider = configuredProvider;

    if (configuredProvider === "tinyfish") {
        try {
            searchResult = await tinyfishSearch(args);
        } catch (err) {
            console.warn(`[SEARCH] TinyFish search failed or key missing (${err.message}). Falling back to DuckDuckGo.`);
            searchResult = await duckduckgoSearch(args);
            effectiveProvider = "duckduckgo";
        }
    } else {
        searchResult = await duckduckgoSearch(args);
        effectiveProvider = "duckduckgo";
    }

    const rawList = searchResult?.results || [];
    let normalizedResults = rawList.map(r => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.snippet || r.text || r.content || ""
    }));

    // Auto-Relaxation fallback if over-constrained query returned zero results
    if (normalizedResults.length === 0 && query.length > 12) {
        const relaxed = relaxQuery(query);
        if (relaxed && relaxed !== query) {
            try {
                const retryRes = effectiveProvider === "tinyfish"
                    ? await tinyfishSearch({ ...args, query: relaxed }).catch(() => duckduckgoSearch({ ...args, query: relaxed }))
                    : await duckduckgoSearch({ ...args, query: relaxed });
                const retryList = retryRes?.results || [];
                if (retryList.length > 0) {
                    normalizedResults = retryList.map(r => ({
                        title: r.title || "",
                        url: r.url || "",
                        snippet: r.snippet || r.text || r.content || ""
                    }));
                }
            } catch (_) {}
        }
    }

    let excerpts = [];

    // Pair DeepSearch (PAS-BM25): Fast concurrent stream-capped fetch & positional attention RAG
    if (shouldPairDeepSearch && normalizedResults.length > 0) {
        const topPagesToFetch = normalizedResults.slice(0, 3);
        try {
            const fetchedPages = await Promise.all(
                topPagesToFetch.map(async (r) => {
                    const page = await fetchWebpageFast(r.url, 3000, 80000);
                    if (!page.content || page.content.length < 80) {
                        return {
                            url: r.url,
                            title: r.title,
                            content: r.snippet ? `${r.title}\n\n${r.snippet}` : ""
                        };
                    }
                    return page;
                })
            );

            excerpts = extractRagPassages(query, fetchedPages, {
                maxExcerpts: 3,
                maxPerSource: 2,
                maxTotalWords: 450
            });
        } catch (ragErr) {
            console.warn("[SEARCH] PAS-BM25 extraction error:", ragErr.message);
        }
    }

    return {
        provider: effectiveProvider,
        type: "search",
        query,
        pair_deepsearch: shouldPairDeepSearch,
        engine: "PAS-BM25",
        results: normalizedResults,
        excerpts
    };
}

async function handleSearchRoute(req, res) {
    const reqUrl = req.url.split("?")[0];
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const args = JSON.parse(body || "{}");

        if (reqUrl === "/api/search") {
            const result = await unifiedSearch(args);
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/fetch") {
            const apiKey = getTinyFishApiKey();
            if (apiKey) {
                try {
                    const result = await tinyfishFetch(args);
                    return sendJSON(res, 200, result);
                } catch (fetchErr) {
                    console.warn(`[SEARCH] TinyFish fetch failed (${fetchErr.message}). Using local fast fetcher.`);
                }
            }

            const targetUrl = args.url || (Array.isArray(args.urls) ? args.urls[0] : "");
            if (!targetUrl) throw new Error("No URL provided to fetch");
            const page = await fetchWebpageFast(targetUrl, 6000, 150000);
            return sendJSON(res, 200, {
                provider: "local",
                url: page.url,
                title: page.title,
                markdown: page.content
            });
        }

        res.writeHead(404);
        res.end();
    } catch (error) {
        return sendJSON(res, 500, { error: error.message });
    }
}

module.exports = {
    handleSearchRoute,
    unifiedSearch,
    tinyfishSearch,
    tinyfishFetch,
    duckduckgoSearch,
    fetchWebpageFast
};
