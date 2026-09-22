const fs = require("fs");
const path = require("path");
const { resolveSafePath, formatBytes, getMimeType, sendJSON, postJSON } = require("../utils");
const { handleCodeGrep, handleSearchAndReplace, handleWriteFile } = require("../../tools/filesystem/code_tools");

async function handleFileRead(args, chatId) {
    const targetPath = resolveSafePath(args.path, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File or directory not found: ${args.path}`);
    }

    const stat = await fs.promises.stat(targetPath);
    const action = args.action || "read";

    if (action === "info") {
        if (stat.isDirectory()) {
            const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
            return {
                path: args.path,
                resolved_path: targetPath,
                exists: true,
                is_dir: true,
                is_file: false,
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                entry_count: entries.length,
                entries: entries.slice(0, 100).map(e => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" })),
                modified_time: stat.mtime
            };
        }
        let lineCount = 0;
        try {
            const raw = await fs.promises.readFile(targetPath, "utf-8");
            lineCount = raw.split("\n").length;
        } catch {
            lineCount = null;
        }
        return {
            path: args.path,
            resolved_path: targetPath,
            exists: true,
            is_dir: false,
            is_file: true,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            line_count: lineCount,
            mime_type: getMimeType(path.extname(targetPath)),
            modified_time: stat.mtime
        };
    }

    if (action === "view") {
        const ext = path.extname(targetPath).toLowerCase();
        const isImg = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".ico", ".avif"].includes(ext);
        if (isImg) {
            const buf = await fs.promises.readFile(targetPath);
            const mime = getMimeType(ext);
            if (stat.size <= 4 * 1024 * 1024) {
                const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
                return {
                    path: args.path,
                    resolved_path: targetPath,
                    action: "view",
                    type: "image",
                    mime,
                    size_bytes: stat.size,
                    human_size: formatBytes(stat.size),
                    data_url: dataUrl,
                    markdown: `![${path.basename(targetPath)}](${dataUrl})`
                };
            } else {
                return {
                    path: args.path,
                    resolved_path: targetPath,
                    action: "view",
                    type: "image",
                    mime,
                    size_bytes: stat.size,
                    human_size: formatBytes(stat.size),
                    message: "Image exceeds 4MB inline viewing limit"
                };
            }
        }
        if (ext === ".pdf") {
            return {
                path: args.path,
                resolved_path: targetPath,
                action: "view",
                type: "pdf",
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                message: `PDF Document (${formatBytes(stat.size)})`
            };
        }
    }

    // Default: action === "read"
    if (stat.isDirectory()) {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        return {
            path: args.path,
            resolved_path: targetPath,
            is_dir: true,
            entry_count: entries.length,
            content: entries.map(e => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`).join("\n")
        };
    }

    // Guard: detect binary files before reading as UTF-8
    const BINARY_EXTS = new Set([
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".tiff", ".tif",
        ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".mpg", ".mpeg", ".flv", ".3gp",
        ".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wma",
        ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
        ".wasm", ".pyc", ".class", ".o", ".obj", ".pdb",
        ".ttf", ".otf", ".woff", ".woff2", ".eot",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".sqlite", ".db"
    ]);
    const fileExt = path.extname(targetPath).toLowerCase();
    if (BINARY_EXTS.has(fileExt)) {
        const mime = getMimeType(fileExt);
        const viewable = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".pdf"].includes(fileExt);
        return {
            path: args.path,
            resolved_path: targetPath,
            is_binary: true,
            mime_type: mime,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            message: `Binary file (${mime}, ${formatBytes(stat.size)}). Cannot read as text.${viewable ? ' Use action: "view" to render as embedded preview.' : ' Use action: "info" for metadata only.'}`
        };
    }

    const raw = await fs.promises.readFile(targetPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const startLine = Math.max(1, parseInt(args.start_line, 10) || 1);
    const endLine = args.end_line ? Math.min(totalLines, Math.max(startLine, parseInt(args.end_line, 10))) : Math.min(totalLines, startLine + 400 - 1);
    const isNumbered = args.numbered !== false;

    const sliced = lines.slice(startLine - 1, endLine);
    const content = sliced.map((line, idx) => isNumbered ? `${String(startLine + idx).padStart(5, " ")} | ${line}` : line).join("\n");

    return {
        path: args.path,
        resolved_path: targetPath,
        content,
        start_line: startLine,
        end_line: endLine,
        total_lines: totalLines,
        is_truncated: (startLine > 1 || endLine < totalLines)
    };
}

async function handleFilesRoute(req, res) {
    const reqUrl = req.url.split("?")[0];
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const args = JSON.parse(body || "{}");
        const chatId = req.headers["x-chat-id"] || args.chatId || args.chat_id || "";

        if (reqUrl === "/api/file/read") {
            const result = await handleFileRead(args, chatId);
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/file/write") {
            const result = await handleWriteFile(args, chatId, { resolveSafePath });
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/file/search-replace") {
            const result = await handleSearchAndReplace(args, chatId, { resolveSafePath });
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/code/grep") {
            const result = await handleCodeGrep(args, chatId, { resolveSafePath, postJSON });
            return sendJSON(res, 200, result);
        }

        res.writeHead(404);
        res.end();
    } catch (error) {
        return sendJSON(res, 500, { error: error.message });
    }
}

module.exports = {
    handleFilesRoute,
    handleFileRead
};
