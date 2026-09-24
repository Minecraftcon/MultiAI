import { toolFetch } from "../http.js";
import { state } from "../../state/index.js";

/* =========================================================
   FILESYSTEM TOOLS (READ_FILE, WRITE_FILE)
   ========================================================= */

export const readFileTool = {
    name: "read_file",
    schema: {
        type: "function",
        function: {
            name: "read_file",
            description: "Read contents from a file or directory. Lines are 1-indexed and capped at max 400 lines per read (with a 45KB byte limit). Supports bidirectional slicing: specify start_line only (next 400 lines), end_line only (preceding 400 lines), or both. If content exceeds 45KB, use content_offset to paginate.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file or directory to inspect."
                    },
                    start_line: {
                        type: "integer",
                        description: "Optional 1-based start line. If specified without end_line, reads up to 400 lines forward."
                    },
                    end_line: {
                        type: "integer",
                        description: "Optional 1-based end line. If specified without start_line, reads up to 400 lines preceding it."
                    },
                    content_offset: {
                        type: "integer",
                        description: "Optional byte offset into the content. Use this to view content beyond the 45KB limit when truncated."
                    }
                },
                required: ["path"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            path: args.path || args.AbsolutePath || args.target_file || args.file_path,
            start_line: args.start_line !== undefined ? args.start_line : args.StartLine,
            end_line: args.end_line !== undefined ? args.end_line : args.EndLine,
            content_offset: args.content_offset !== undefined ? args.content_offset : (args.ContentOffset !== undefined ? args.ContentOffset : args.offset),
            chatId: state.currentChatId
        };
        return await toolFetch("/api/file/read", { method: "POST", body: payload, genState });
    }
};

export const writeFileTool = {
    name: "write_file",
    schema: {
        type: "function",
        function: {
            name: "write_file",
            description: "Write or overwrite content to a file at the specified path. Automatically creates parent directories if they do not exist.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Target file path to write to."
                    },
                    content: {
                        type: "string",
                        description: "The exact text or code content to write."
                    }
                },
                required: ["path", "content"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            path: args.path,
            content: args.content,
            chatId: state.currentChatId
        };
        return await toolFetch("/api/file/write", { method: "POST", body: payload, genState });
    }
};

export const replaceFileContentTool = {
    name: "replace_file_content",
    schema: {
        type: "function",
        function: {
            name: "replace_file_content",
            description: "Surgically edit a file by replacing a single block of text with new content. Can be constrained to a line range for precise disambiguation.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the target file."
                    },
                    target_content: {
                        type: "string",
                        description: "The exact lines/block of code to replace (must match whitespace and indentation exactly)."
                    },
                    replacement_content: {
                        type: "string",
                        description: "The new content to insert in place of target_content."
                    },
                    start_line: {
                        type: "integer",
                        description: "Optional 1-based start line of the search window."
                    },
                    end_line: {
                        type: "integer",
                        description: "Optional 1-based end line of the search window."
                    },
                    allow_multiple: {
                        type: "boolean",
                        description: "If true, replaces all occurrences in the window. If false, errors if multiple matches exist (default: false)."
                    },
                    instruction: {
                        type: "string",
                        description: "Optional explanation of the changes being made."
                    },
                    description: {
                        type: "string",
                        description: "Optional user-facing summary of why this change is made."
                    }
                },
                required: ["path", "target_content", "replacement_content"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            path: args.path || args.TargetFile || args.target_file,
            target_content: args.target_content !== undefined ? args.target_content : args.TargetContent,
            replacement_content: args.replacement_content !== undefined ? args.replacement_content : args.ReplacementContent,
            start_line: args.start_line !== undefined ? args.start_line : args.StartLine,
            end_line: args.end_line !== undefined ? args.end_line : args.EndLine,
            allow_multiple: args.allow_multiple !== undefined ? args.allow_multiple : args.AllowMultiple,
            instruction: args.instruction || args.Instruction,
            description: args.description || args.Description,
            chatId: state.currentChatId
        };
        return await toolFetch("/api/file/replace", { method: "POST", body: payload, genState });
    }
};

export const multiReplaceFileContentTool = {
    name: "multi_replace_file_content",
    schema: {
        type: "function",
        function: {
            name: "multi_replace_file_content",
            description: "Apply multiple non-contiguous edits to a single file in a single atomic pass. Validates all chunks before applying any changes.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the target file."
                    },
                    replacement_chunks: {
                        type: "array",
                        description: "Array of non-contiguous replacement chunks.",
                        items: {
                            type: "object",
                            properties: {
                                target_content: {
                                    type: "string",
                                    description: "Exact content to be replaced."
                                },
                                replacement_content: {
                                    type: "string",
                                    description: "Content to replace target_content with."
                                },
                                start_line: {
                                    type: "integer",
                                    description: "Optional 1-based start line."
                                },
                                end_line: {
                                    type: "integer",
                                    description: "Optional 1-based end line."
                                },
                                allow_multiple: {
                                    type: "boolean",
                                    description: "Allow multiple replacements if matched."
                                }
                            },
                            required: ["target_content", "replacement_content"]
                        }
                    },
                    instruction: {
                        type: "string",
                        description: "Optional explanation of the changes being made."
                    },
                    description: {
                        type: "string",
                        description: "Optional user-facing summary of why this change is made."
                    }
                },
                required: ["path", "replacement_chunks"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            path: args.path || args.TargetFile || args.target_file,
            replacement_chunks: args.replacement_chunks || args.ReplacementChunks,
            instruction: args.instruction || args.Instruction,
            description: args.description || args.Description,
            chatId: state.currentChatId
        };
        return await toolFetch("/api/file/multi-replace", { method: "POST", body: payload, genState });
    }
};

export const grepSearchTool = {
    name: "grep_search",
    schema: {
        type: "function",
        function: {
            name: "grep_search",
            description: "Use ripgrep to find exact pattern matches within files or directories. Results are returned in JSON format and for each match you will receive: Filename, LineNumber (only when MatchPerLine is true), LineContent (only when MatchPerLine is true). Total results are capped at 50 matches. Use the Includes option to filter by file type or specific paths.",
            parameters: {
                type: "object",
                properties: {
                    SearchPath: {
                        type: "string",
                        description: "The path to search. Must be an absolute path or relative path to a directory or file."
                    },
                    Query: {
                        type: "string",
                        description: "The search term or pattern to look for within files."
                    },
                    IsRegex: {
                        type: "boolean",
                        description: "If true, treats Query as a regular expression pattern. If false, treats Query as a literal string where all characters are matched exactly."
                    },
                    CaseInsensitive: {
                        type: "boolean",
                        description: "If true, performs a case-insensitive search."
                    },
                    MatchPerLine: {
                        type: "boolean",
                        description: "If true, returns each line that matches the query, including line numbers and snippets of matching lines. If false, only returns the names of files containing the query."
                    },
                    Includes: {
                        type: "array",
                        items: { type: "string" },
                        description: "Glob patterns to filter files found within the SearchPath (e.g. ['*.js', '!**/vendor/*'])."
                    }
                },
                required: ["SearchPath", "Query"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            SearchPath: args.SearchPath || args.search_path || args.path || ".",
            Query: args.Query !== undefined ? args.Query : (args.query !== undefined ? args.query : args.pattern),
            IsRegex: args.IsRegex !== undefined ? args.IsRegex : args.is_regex,
            CaseInsensitive: args.CaseInsensitive !== undefined ? args.CaseInsensitive : args.case_insensitive,
            MatchPerLine: args.MatchPerLine !== undefined ? args.MatchPerLine : args.match_per_line,
            Includes: args.Includes || args.includes || args.glob,
            chatId: state.currentChatId
        };
        return await toolFetch("/api/code/grep", { method: "POST", body: payload, genState });
    }
};

export const filesystemTools = [
    readFileTool,
    writeFileTool,
    replaceFileContentTool,
    multiReplaceFileContentTool,
    grepSearchTool
];
