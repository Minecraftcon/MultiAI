import { activeWebProvider, TinyFishProvider, setWebProvider } from "./provider.js";

/* =========================================================
   UNIFIED WEB SEARCH TOOL
   =========================================================
   Tool: web_search
     type: Search, Query
     type: Fetch, Query
   ========================================================= */

export const webSearchTool = {
    name: "web_search",
    schema: {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the live web or fetch full content from a webpage URL using TinyFish.",
            parameters: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: ["search", "fetch"],
                        description: "The action type: 'search' to query the web, or 'fetch' to read full page content from a URL."
                    },
                    query: {
                        type: "string",
                        description: "Search query keywords (for search) or target webpage URL (for fetch)."
                    }
                },
                required: ["type", "query"]
            }
        }
    },
    handler: async (args, ctx) => {
        const rawType = String(args.type || "").toLowerCase().trim();
        const query = String(args.query || args.url || "").trim();

        if (!query) {
            throw new Error("Missing 'query' parameter for web_search.");
        }

        // Auto-detect type if ambiguous: URLs default to fetch, text defaults to search
        const isUrl = /^https?:\/\//i.test(query);
        const actionType = (rawType === "fetch" || (!rawType && isUrl)) ? "fetch" : "search";

        if (actionType === "fetch") {
            return await activeWebProvider.fetch(query, args, ctx);
        } else {
            return await activeWebProvider.search(query, args, ctx);
        }
    }
};

export const webTools = [
    webSearchTool
];

export { activeWebProvider, TinyFishProvider, setWebProvider };
