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
            description: "Read contents from a file or directory. Automatically formats text with line numbers (capped at 400 lines), returns visual previews for images, and provides clean metadata for binary files.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file or directory to inspect."
                    },
                    start_line: {
                        type: "integer",
                        description: "Optional 1-based starting line number for text files."
                    },
                    end_line: {
                        type: "integer",
                        description: "Optional ending line number (inclusive). Max 400 lines per read window."
                    }
                },
                required: ["path"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const payload = {
            path: args.path,
            start_line: args.start_line,
            end_line: args.end_line,
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

export const filesystemTools = [
    readFileTool,
    writeFileTool
];
