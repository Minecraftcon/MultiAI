const { sendJSON } = require("../utils");
const { getConfig } = require("../../core/config_manager");
const { searchDuckDuckGo } = require("../../services/deepsearch/engines/duckduckgo");
const { fetchWebpage } = require("../../services/deepsearch/engines/fetch_page");
const { extractRagPassages } = require("../../services/search/rag_extractor");

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
 * Unified search handler with Pair DeepSearch (Heuristic RAG) support.
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
    const normalizedResults = rawList.map(r => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.snippet || r.text || r.content || ""
    }));

    let excerpts = [];

    // Pair DeepSearch (Heuristic RAG): Fetch top pages in parallel & extract key passages
    if (shouldPairDeepSearch && normalizedResults.length > 0) {
        const topPagesToFetch = normalizedResults.slice(0, 2);
        try {
            const fetchedPages = await Promise.all(
                topPagesToFetch.map(async (r) => {
                    try {
                        return await fetchWebpage(r.url, { timeoutMs: 3500 });
                    } catch (_) {
                        return { url: r.url, title: r.title, content: r.snippet || "" };
                    }
                })
            );

            excerpts = extractRagPassages(query, fetchedPages, { maxExcerpts: 4 });
        } catch (ragErr) {
            console.warn("[SEARCH] Heuristic RAG extraction error:", ragErr.message);
        }
    }

    return {
        provider: effectiveProvider,
        type: "search",
        query,
        pair_deepsearch: shouldPairDeepSearch,
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
            // First attempt TinyFish if key configured; otherwise fallback to local fetchWebpage
            const apiKey = getTinyFishApiKey();
            if (apiKey) {
                try {
                    const result = await tinyfishFetch(args);
                    return sendJSON(res, 200, result);
                } catch (fetchErr) {
                    console.warn(`[SEARCH] TinyFish fetch failed (${fetchErr.message}). Using local fetcher.`);
                }
            }

            const targetUrl = args.url || (Array.isArray(args.urls) ? args.urls[0] : "");
            if (!targetUrl) throw new Error("No URL provided to fetch");
            const page = await fetchWebpage(targetUrl, { timeoutMs: 8000 });
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
    duckduckgoSearch
};
