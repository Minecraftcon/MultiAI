import { toolFetch } from "../http.js";

/* =========================================================
   MODULAR & REPLACEABLE WEB SEARCH PROVIDER ARCHITECTURE
   =========================================================
   Designed like a swappable MCP tool provider adapter.
   Can be easily modified, extended, or replaced at runtime.
   ========================================================= */

/**
 * Interface contract for web search & fetch providers.
 */
export class BaseWebSearchProvider {
    constructor(name = "base") {
        this.name = name;
    }

    async search(query, options = {}, context = {}) {
        throw new Error(`search() not implemented for provider ${this.name}`);
    }

    async fetch(urlOrQuery, options = {}, context = {}) {
        throw new Error(`fetch() not implemented for provider ${this.name}`);
    }
}

/**
 * TinyFish Web Provider Implementation
 * Connects to TinyFish Search & Fetch APIs through the MultiAI server proxy.
 */
export class TinyFishProvider extends BaseWebSearchProvider {
    constructor(config = {}) {
        super("tinyfish");
        this.searchEndpoint = config.searchEndpoint || "/api/search";
        this.fetchEndpoint = config.fetchEndpoint || "/api/fetch";
    }

    async search(query, options = {}, { genState } = {}) {
        const payload = {
            query: String(query || "").trim(),
            location: options.location,
            language: options.language,
            page: options.page
        };

        const res = await toolFetch(this.searchEndpoint, {
            method: "POST",
            body: payload,
            genState
        });

        return this.formatSearchResults(res);
    }

    async fetch(urlOrQuery, options = {}, { genState } = {}) {
        const url = String(urlOrQuery || options.url || "").trim();
        const payload = {
            urls: [url],
            format: options.format || "markdown"
        };

        const res = await toolFetch(this.fetchEndpoint, {
            method: "POST",
            body: payload,
            genState
        });

        return this.formatFetchResults(res, url);
    }

    formatSearchResults(res) {
        if (!res) return { provider: "tinyfish", results: [] };
        if (res.results && Array.isArray(res.results)) {
            return {
                provider: "tinyfish",
                type: "search",
                results: res.results.map(r => ({
                    title: r.title || "",
                    url: r.url || "",
                    snippet: r.snippet || r.text || r.content || ""
                }))
            };
        }
        return res;
    }

    formatFetchResults(res, url) {
        if (!res) return { provider: "tinyfish", type: "fetch", url, content: "" };
        return {
            provider: "tinyfish",
            type: "fetch",
            url,
            ...res
        };
    }
}

// Active replaceable provider instance
export let activeWebProvider = new TinyFishProvider();

/**
 * Replaces or reconfigures the active web search provider at runtime.
 * Allows swapping TinyFish with an MCP server or alternative provider.
 */
export function setWebProvider(provider) {
    if (!provider || typeof provider.search !== "function" || typeof provider.fetch !== "function") {
        throw new Error("Invalid web search provider: must implement search() and fetch()");
    }
    activeWebProvider = provider;
}
