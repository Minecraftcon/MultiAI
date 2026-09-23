/**
 * code_tools.js (Clean Slate)
 * ==========================
 * Minimal placeholder stubs for filesystem tool handlers.
 * Ready to be replaced by new modular / MCP tool implementations.
 */

async function handleCodeGrep(args, chatId, { resolveSafePath }) {
    throw new Error("grep_search tool is being rebuilt with clean modular architecture.");
}

async function handleSearchAndReplace(args, chatId, { resolveSafePath }) {
    throw new Error("search_and_replace tool is being rebuilt with clean modular architecture.");
}

async function handleWriteFile(args, chatId, { resolveSafePath }) {
    throw new Error("write_file tool is being rebuilt with clean modular architecture.");
}

module.exports = {
    handleCodeGrep,
    handleSearchAndReplace,
    handleWriteFile
};
