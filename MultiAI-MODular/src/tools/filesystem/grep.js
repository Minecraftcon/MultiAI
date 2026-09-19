import { toolFetch } from "../http.js";

/* =========================================================
   GREP CODE SEARCH TOOL
   ========================================================= */

export const grepSearchTool = {
    name: "grep_search",
    schema: {
        type: "function",
        function: {
            name: "grep_search",
            description: "Fast code search across files and directories using regex or literal patterns. Returns matching lines with line numbers and file paths. Use this to locate function definitions, variable usages, imports, or text across the project.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The pattern or exact text to search for."
                    },
                    path: {
                        type: "string",
                        description: "Relative or absolute directory or file path to search within (default: '.' for workspace root). Can also target '$SCRATCH'."
                    },
                    case_sensitive: {
                        type: "boolean",
                        description: "Whether the search should be case-sensitive. Default: false."
                    },
                    is_regex: {
                        type: "boolean",
                        description: "Whether to treat 'query' as a regular expression. Default: false (literal exact match)."
                    },
                    include: {
                        type: "string",
                        description: "File glob filter to restrict search, e.g. '*.js', '*.py', or comma-separated '*.ts,*.tsx'."
                    },
                    files_only: {
                        type: "boolean",
                        description: "If true, only returns file paths that contain matching occurrences without line details. Default: false."
                    },
                    max_results: {
                        type: "integer",
                        description: "Maximum number of matches or matching files to return (default: 50, max: 100)."
                    }
                },
                required: ["query"]
            }
        }
    },
    handler: async (args, { genState }) => {
        return await toolFetch("/api/code/grep", { method: "POST", body: args, genState });
    }
};
