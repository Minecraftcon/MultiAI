/**
 * services/deepsearch/engines/google_grounding.js
 * ===============================================
 * Ultra-lightweight Google Grounding Engine for DeepSearch.
 * Uses 0MB browser overhead via pure HTTP fetch.
 * Provides live search query expansions and breaking real-time news topics.
 */

/**
 * Fetch Google query completions & search expansions.
 * @param {string} query
 * @returns {Promise<Array<string>>}
 */
async function fetchGoogleSuggestions(query) {
    if (!query || typeof query !== "string") return [];

    try {
        const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
            }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data[1]) ? data[1] : [];
    } catch (err) {
        console.warn(`[Google Grounding] Suggestions error: ${err.message}`);
        return [];
    }
}

/**
 * Fetch real-time topical news grounding from Google News RSS.
 * @param {string} query
 * @param {number} maxItems
 * @returns {Promise<Array<{title: string, link: string, pubDate: string}>>}
 */
async function fetchGoogleNewsGrounding(query, maxItems = 5) {
    if (!query || typeof query !== "string") return [];

    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
            }
        });
        if (!res.ok) return [];
        const xml = await res.text();

        const items = [];
        const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gi;
        let m;
        while ((m = itemRegex.exec(xml)) !== null && items.length < maxItems) {
            items.push({
                title: m[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim(),
                link: m[2].trim(),
                pubDate: m[3].trim()
            });
        }
        return items;
    } catch (err) {
        console.warn(`[Google Grounding] News error: ${err.message}`);
        return [];
    }
}

/**
 * Ground a search topic with Google live expansions and recent news.
 * @param {string} query
 * @param {Object} [options]
 * @param {boolean} [options.includeSuggestions=true]
 * @param {boolean} [options.includeNews=true]
 * @returns {Promise<Object>}
 */
async function groundWithGoogle(query, options = {}) {
    const includeSuggestions = options.includeSuggestions !== false;
    const includeNews = options.includeNews !== false;

    const [suggestions, news] = await Promise.all([
        includeSuggestions ? fetchGoogleSuggestions(query) : Promise.resolve([]),
        includeNews ? fetchGoogleNewsGrounding(query, options.maxNews || 5) : Promise.resolve([])
    ]);

    return {
        engine: "google_grounding",
        query,
        suggestions,
        recent_news: news
    };
}

module.exports = {
    fetchGoogleSuggestions,
    fetchGoogleNewsGrounding,
    groundWithGoogle
};
