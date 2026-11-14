import { toolFetch } from "../http.js";
import { state } from "../../state/index.js";

/* =========================================================
   FILESYSTEM TOOLS (LIST_DIR, READ_FILE, WRITE_FILE)
   ========================================================= */

export const listDirTool = {
    name: "list_dir",
    schema: {
        type: "function",
        function: {
            name: "list_dir",
            description: "List the contents of a directory, including all files and subdirectories with sizes and child counts.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the directory to inspect (e.g. '.' for project workspace root)."
                    }
                },
                required: ["path"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            DirectoryPath: args.path || args.DirectoryPath || args.dir_path || args.dirPath || ".",
            chatId: state.currentChatId
        };
        return await toolFetch("/api/file/list-dir", { method: "POST", body: payload, genState });
    }
};

export const readFileTool = {
    name: "read_file",
    schema: {
        type: "function",
        function: {
            name: "read_file",
            description: "Read contents from a file. Supports text/source code files and image files (PNG, JPG, WEBP, GIF, SVG, etc.). When reading an image file, the image is automatically attached to your vision context so you can visually view, inspect, and analyze it. For text files, lines are 1-indexed and capped at max 400 lines per read (with a 45KB byte limit). Supports bidirectional slicing: specify start_line only (next 400 lines), end_line only (preceding 400 lines), or both. If content exceeds 45KB, use content_offset to paginate. NOTE: Do not use read_file on directories; use list_dir to inspect directory contents.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file to inspect."
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
        const result = await toolFetch("/api/file/write", { method: "POST", body: payload, genState });
        if (result && !result.error) {
            try { document.dispatchEvent(new CustomEvent("changesUpdated", { detail: { chatId: state.currentChatId } })); } catch (_) {}
        }
        return result;
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
        const result = await toolFetch("/api/file/replace", { method: "POST", body: payload, genState });
        if (result && !result.error) {
            try { document.dispatchEvent(new CustomEvent("changesUpdated", { detail: { chatId: state.currentChatId } })); } catch (_) {}
        }
        return result;
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
        const result = await toolFetch("/api/file/multi-replace", { method: "POST", body: payload, genState });
        if (result && !result.error) {
            try { document.dispatchEvent(new CustomEvent("changesUpdated", { detail: { chatId: state.currentChatId } })); } catch (_) {}
        }
        return result;
    }
};

export const grepSearchTool = {
    name: "grep_search",
    schema: {
        type: "function",
        function: {
            name: "grep_search",
            description: "Search for regex or literal patterns within files or directories. Results include filename, line numbers, and matching content snippets (capped at 50 matches).",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The path to search in (e.g. '.' for workspace root, or a directory/file path)."
                    },
                    query: {
                        type: "string",
                        description: "The search term or regex pattern to look for within files."
                    },
                    is_regex: {
                        type: "boolean",
                        description: "If true, treats query as a regular expression pattern. If false (default), treats query as a literal string."
                    },
                    case_sensitive: {
                        type: "boolean",
                        description: "If true, performs a case-sensitive search. If false (default), search is case-insensitive."
                    },
                    match_per_line: {
                        type: "boolean",
                        description: "If true (default), returns each matching line with numbers and snippets. If false, returns only filenames."
                    },
                    includes: {
                        type: "array",
                        items: { type: "string" },
                        description: "Glob patterns to filter files found within path (e.g. ['*.js', '!**/vendor/*'])."
                    }
                },
                required: ["path", "query"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const pathVal = args.path || args.SearchPath || args.search_path || ".";
        const queryVal = args.query !== undefined ? args.query : (args.Query !== undefined ? args.Query : args.pattern);
        const isRegex = args.is_regex !== undefined ? args.is_regex : (args.IsRegex !== undefined ? args.IsRegex : false);
        const caseInsensitive = args.case_sensitive !== undefined ? !args.case_sensitive : (args.CaseInsensitive !== undefined ? args.CaseInsensitive : (args.case_insensitive !== undefined ? args.case_insensitive : true));
        const matchPerLine = args.match_per_line !== undefined ? args.match_per_line : (args.MatchPerLine !== undefined ? args.MatchPerLine : true);
        const includesVal = args.includes || args.Includes || args.glob;

        const payload = {
            SearchPath: pathVal,
            Query: queryVal,
            IsRegex: isRegex,
            CaseInsensitive: caseInsensitive,
            MatchPerLine: matchPerLine,
            Includes: includesVal,
            chatId: state.currentChatId
        };
        return await toolFetch("/api/code/grep", { method: "POST", body: payload, genState });
    }
};

export const filesystemTools = [
    listDirTool,
    readFileTool,
    writeFileTool,
    replaceFileContentTool,
    multiReplaceFileContentTool,
    grepSearchTool
];
