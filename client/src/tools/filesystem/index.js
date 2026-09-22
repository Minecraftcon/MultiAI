import { toolFetch } from "../http.js";
import { grepSearchTool } from "./grep.js";
import { searchAndReplaceTool } from "./replace.js";

/* =========================================================
   FILESYSTEM TOOLS (READ, WRITE, GREP, REPLACE)
   ========================================================= */

export const filesystemTools = [
    {
        name: "read_file",
        schema: {
            type: "function",
            function: {
                name: "read_file",
                description: "Inspect, read, or view file content and metadata. Supports line range pagination with line numbers, metadata inspection, media/binary viewing, and scratchpad files ('$SCRATCH/<filename>').",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Relative or absolute file or directory path. Use '$SCRATCH/' or '$SCRATCH/<filename>' to read files from the isolated conversation scratch directory."
                        },
                        action: {
                            type: "string",
                            enum: ["read", "info", "view"],
                            description: "'read' (default: text content with line numbers), 'info' (metadata, size, line count, permissions), 'view' (for images, pdfs, binary)"
                        },
                        start_line: {
                            type: "integer",
                            description: "1-indexed starting line number for reading (default: 1)"
                        },
                        end_line: {
                            type: "integer",
                            description: "1-indexed ending line number for reading (default: start_line + 400)"
                        },
                        numbered: {
                            type: "boolean",
                            description: "Whether to prefix line numbers (e.g. '1 | content'). Default: true"
                        }
                    },
                    required: ["path"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/file/read", { method: "POST", body: args, genState });
        }
    },
    {
        name: "write_file",
        schema: {
            type: "function",
            function: {
                name: "write_file",
                description: "Create, overwrite, replace text, inject lines, or execute batched/nested atomic file modifications. Use '$SCRATCH/<filename>' for temporary scripts, or '$ARTIFACTS/<filename>' for persistent milestone archives and state snapshots.",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Relative or absolute target file path. Supports '$SCRATCH/<filename>' for temporary scratch files, or '$ARTIFACTS/<filename>' for permanent milestone artifacts."
                        },
                        action: {
                            type: "string",
                            enum: ["write", "replace", "inject", "batch"],
                            description: "'write' (overwrite/create), 'replace' (search and replace exact text), 'inject' (insert at line number), 'batch' (run array of nested operations)"
                        },
                        content: {
                            type: "string",
                            description: "Content to write (for 'write') or content to insert (for 'inject')"
                        },
                        target: {
                            type: "string",
                            description: "Exact text string to find and replace (for 'replace')"
                        },
                        replacement: {
                            type: "string",
                            description: "Replacement text string (for 'replace')"
                        },
                        line: {
                            type: "integer",
                            description: "Target line number for 'inject' (1-indexed. 1 = prepend, -1 = append, N = insert after line N)"
                        },
                        start_line: {
                            type: "integer",
                            description: "Optional starting line constraint for 'replace'"
                        },
                        end_line: {
                            type: "integer",
                            description: "Optional ending line constraint for 'replace'"
                        },
                        all: {
                            type: "boolean",
                            description: "If true, replaces all occurrences. If false, ensures target is unique. Default: false"
                        },
                        overwrite: {
                            type: "boolean",
                            description: "For 'write': whether to allow overwriting an existing file. Default: true"
                        },
                        operations: {
                            type: "array",
                            description: "For 'batch': list of nested edit operations to execute atomically in sequence",
                            items: {
                                type: "object",
                                properties: {
                                    action: { type: "string", enum: ["replace", "inject", "write"] },
                                    target: { type: "string" },
                                    replacement: { type: "string" },
                                    content: { type: "string" },
                                    line: { type: "integer" },
                                    start_line: { type: "integer" },
                                    end_line: { type: "integer" },
                                    all: { type: "boolean" }
                                }
                            }
                        }
                    },
                    required: ["path"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/file/write", { method: "POST", body: args, genState });
        }
    },
    grepSearchTool,
    searchAndReplaceTool
];

export { grepSearchTool, searchAndReplaceTool };
