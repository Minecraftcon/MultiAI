import { toolFetch } from "../http.js";

/* =========================================================
   SEARCH AND REPLACE TOOL
   ========================================================= */

export const searchAndReplaceTool = {
    name: "search_and_replace",
    schema: {
        type: "function",
        function: {
            name: "search_and_replace",
            description: "Surgically find and replace text in a file. Matches exact character sequences (including whitespace and indentation). Validates that the target string is unique in the file (or within the specified line range) to prevent accidental overwrites. Performs atomic writes and syntax validation.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative or absolute file path to modify. Supports '$SCRATCH/<filename>'."
                    },
                    old_string: {
                        type: "string",
                        description: "The exact text or code snippet to replace. Must match character-for-character including indentation."
                    },
                    new_string: {
                        type: "string",
                        description: "The replacement text to insert in place of old_string."
                    },
                    allow_multiple: {
                        type: "boolean",
                        description: "Whether to allow replacing multiple occurrences. If false (default), the operation errors if old_string matches more than once."
                    },
                    start_line: {
                        type: "integer",
                        description: "Optional 1-indexed starting line number to constrain the search scope."
                    },
                    end_line: {
                        type: "integer",
                        description: "Optional 1-indexed ending line number to constrain the search scope."
                    }
                },
                required: ["path", "old_string", "new_string"]
            }
        }
    },
    handler: async (args, { genState }) => {
        return await toolFetch("/api/file/search-replace", { method: "POST", body: args, genState });
    }
};
