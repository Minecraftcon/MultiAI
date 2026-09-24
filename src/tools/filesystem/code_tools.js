const fs = require("fs");
const path = require("path");

async function handleCodeGrep(args, chatId, { resolveSafePath }) {
    throw new Error("grep_search tool is being rebuilt with clean modular architecture.");
}

async function handleSearchAndReplace(args, chatId, { resolveSafePath }) {
    throw new Error("search_and_replace tool is being rebuilt with clean modular architecture.");
}

async function handleWriteFile(args, chatId, { resolveSafePath }) {
    if (!args.path) {
        throw new Error("Missing 'path' parameter for write_file.");
    }
    if (args.content === undefined || args.content === null) {
        throw new Error("Missing 'content' parameter for write_file.");
    }

    const targetPath = resolveSafePath(args.path, chatId);
    const parentDir = path.dirname(targetPath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    const contentStr = String(args.content);
    await fs.promises.writeFile(targetPath, contentStr, "utf-8");

    const lineCount = contentStr.split("\n").length;
    const byteCount = Buffer.byteLength(contentStr, "utf-8");

    return {
        path: args.path,
        resolved_path: targetPath,
        bytes_written: byteCount,
        line_count: lineCount,
        status: "success",
        message: `Successfully wrote ${byteCount} bytes (${lineCount} lines) to ${args.path}`
    };
}

module.exports = {
    handleCodeGrep,
    handleSearchAndReplace,
    handleWriteFile
};
