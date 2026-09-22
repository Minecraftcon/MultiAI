const { sendJSON } = require("../utils");
const { getConfig } = require("../../core/config_manager");

function getTinyFishApiKey() {
    return process.env.TINYFISH_API_KEY || getConfig().General?.TinyFishApiKey;
}

async function tinyfishSearch(args) {
    const apiKey = getTinyFishApiKey();
    if (!apiKey) {
        throw new Error("TINYFISH_API_KEY is not set in the server environment. Web search is unavailable.");
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
        throw new Error("TINYFISH_API_KEY is not set in the server environment. Web fetch is unavailable.");
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

async function handleSearchRoute(req, res) {
    const reqUrl = req.url.split("?")[0];
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const args = JSON.parse(body || "{}");

        if (reqUrl === "/api/search") {
            const result = await tinyfishSearch(args);
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/fetch") {
            const result = await tinyfishFetch(args);
            return sendJSON(res, 200, result);
        }

        res.writeHead(404);
        res.end();
    } catch (error) {
        return sendJSON(res, 500, { error: error.message });
    }
}

module.exports = {
    handleSearchRoute,
    tinyfishSearch,
    tinyfishFetch
};
