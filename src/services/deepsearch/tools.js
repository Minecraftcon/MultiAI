/**
 * services/deepsearch/tools.js
 * ============================
 * Modular Toolset for MultiAI DeepSearch Engine.
 * Provides granular search and source-digging tools with selective extraction flags.
 */

const { searchGoogle } = require("./engines/google");
const { searchDuckDuckGo } = require("./engines/duckduckgo");
const { fetchWebpage } = require("./engines/fetch_page");
const { groundWithGoogle } = require("./engines/google_grounding");

/**
 * OpenAI / LangChain compatible JSON schemas for DeepSearch tools.
 */
const deepSearchToolSchemas = [
    {
        type: "function",
        function: {
            name: "Duckduckgo_Search",
            description: "Search DuckDuckGo headlessly for organic web results and instant DuckAssist AI Overview with source citations.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query keywords."
                    },
                    max_results: {
                        type: "integer",
                        description: "Number of organic results to return (default: 10).",
                        default: 10
                    },
                    include_ai_overview: {
                        type: "boolean",
                        description: "Whether to capture DuckDuckGo's DuckAssist AI Overview and citations if generated.",
                        default: true
                    },
                    include_knowledge_box: {
                        type: "boolean",
                        description: "Whether to extract entity Knowledge Box summary and Wikipedia links if available.",
                        default: true
                    },
                    include_related_searches: {
                        type: "boolean",
                        description: "Whether to capture DuckDuckGo's suggested related search queries.",
                        default: true
                    },
                    date_filter: {
                        type: "string",
                        enum: ["d", "w", "m", "y"],
                        description: "Optional recency filter: 'd' (past day), 'w' (past week), 'm' (past month), 'y' (past year)."
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "Google_Grounding",
            description: "Ground research topics using Google's live autocomplete expansions and real-time news stream with zero browser overhead.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The topic or question to ground."
                    },
                    include_suggestions: {
                        type: "boolean",
                        description: "Whether to fetch high-intent Google query completions and expansions.",
                        default: true
                    },
                    include_news: {
                        type: "boolean",
                        description: "Whether to fetch breaking real-time news items related to the query.",
                        default: true
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "Google_Search",
            description: "Search Google headlessly with rich extraction flags. Models can selectively request AI Overview, People Also Ask, Knowledge Graph, or standard organic results.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query keywords."
                    },
                    max_results: {
                        type: "integer",
                        description: "Number of organic results to return (default: 10, max: 30).",
                        default: 10
                    },
                    include_ai_overview: {
                        type: "boolean",
                        description: "Whether to capture Google's AI Overview / AI Mode summary and citations.",
                        default: true
                    },
                    include_paa: {
                        type: "boolean",
                        description: "Whether to capture 'People Also Ask' related research questions.",
                        default: true
                    },
                    include_knowledge_graph: {
                        type: "boolean",
                        description: "Whether to extract entity Knowledge Graph facts if available.",
                        default: true
                    },
                    include_related_searches: {
                        type: "boolean",
                        description: "Whether to extract suggested related search queries.",
                        default: true
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "Fetch_Webpage",
            description: "Source-Digger tool to fetch, clean, and distill textual content and outbound hyperlinks from a specific URL.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The full http/https URL of the webpage or document to fetch."
                    },
                    max_chars: {
                        type: "integer",
                        description: "Maximum number of content characters to extract (default: 15000).",
                        default: 15000
                    },
                    extract_links: {
                        type: "boolean",
                        description: "Whether to extract outbound links for recursive source digging.",
                        default: false
                    }
                },
                required: ["url"]
            }
        }
    }
];

/**
 * Execute a DeepSearch tool call.
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @returns {Promise<Object>}
 */
async function executeDeepSearchTool(name, args = {}) {
    switch (name) {
        case "Duckduckgo_Search": {
            return await searchDuckDuckGo(args.query, {
                maxResults: args.max_results || 10,
                includeAiOverview: args.include_ai_overview !== false,
                includeKnowledgeBox: args.include_knowledge_box !== false,
                includeRelatedSearches: args.include_related_searches !== false,
                dateFilter: args.date_filter || null
            });
        }

        case "Google_Grounding": {
            return await groundWithGoogle(args.query, {
                includeSuggestions: args.include_suggestions !== false,
                includeNews: args.include_news !== false
            });
        }

        case "Google_Search": {
            return await searchGoogle(args.query, {
                maxResults: args.max_results || 10,
                includeAiOverview: args.include_ai_overview !== false,
                includePaa: args.include_paa !== false,
                includeKnowledgeGraph: args.include_knowledge_graph !== false,
                includeRelatedSearches: args.include_related_searches !== false
            });
        }

        case "Fetch_Webpage": {
            return await fetchWebpage(args.url, {
                maxChars: args.max_chars || 15000,
                extractLinks: args.extract_links === true
            });
        }

        default:
            throw new Error(`Unknown DeepSearch tool: ${name}`);
    }
}

module.exports = {
    deepSearchToolSchemas,
    executeDeepSearchTool
};
