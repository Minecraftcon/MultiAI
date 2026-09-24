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

    // 1. Directory inspection
    if (stat.isDirectory()) {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const formattedEntries = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file"
        }));
        return {
            path: args.path,
            resolved_path: targetPath,
            type: "directory",
            is_dir: true,
            entry_count: entries.length,
            entries: formattedEntries.slice(0, 100),
            content: entries.map(e => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`).join("\n")
        };
    }

    // 2. Automatic Image Detection & Multimodal Preview
    const ext = path.extname(targetPath).toLowerCase();
    const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".ico", ".avif"]);
    if (IMAGE_EXTS.has(ext)) {
        const mime = getMimeType(ext);
        const buf = await fs.promises.readFile(targetPath);
        if (stat.size <= 5 * 1024 * 1024) {
            const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
            return {
                path: args.path,
                resolved_path: targetPath,
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
                type: "image",
                mime,
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                message: `Image exceeds 5MB inline preview limit (${formatBytes(stat.size)})`
            };
        }
    }

    if (ext === ".pdf") {
        return {
            path: args.path,
            resolved_path: targetPath,
            type: "pdf",
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            message: `PDF Document (${formatBytes(stat.size)})`
        };
    }

    // 3. Binary File Guard
    const BINARY_EXTS = new Set([
        ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".mpg", ".mpeg", ".flv", ".3gp",
        ".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wma",
        ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
        ".wasm", ".pyc", ".class", ".o", ".obj", ".pdb",
        ".ttf", ".otf", ".woff", ".woff2", ".eot",
        ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".sqlite", ".db"
    ]);
    if (BINARY_EXTS.has(ext)) {
        const mime = getMimeType(ext);
        return {
            path: args.path,
            resolved_path: targetPath,
            type: "binary",
            is_binary: true,
            mime_type: mime,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            message: `Binary file (${mime}, ${formatBytes(stat.size)}). Cannot read as text.`
        };
    }

    // 4. Text File Inspection with Line Numbers & Windowing
    const raw = await fs.promises.readFile(targetPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const startLine = Math.max(1, parseInt(args.start_line, 10) || 1);
    const endLine = args.end_line 
        ? Math.min(totalLines, Math.max(startLine, parseInt(args.end_line, 10))) 
        : Math.min(totalLines, startLine + 400 - 1);
    const isNumbered = args.numbered !== false;

    const sliced = lines.slice(startLine - 1, endLine);
    let content = sliced.map((line, idx) => isNumbered ? `${String(startLine + idx).padStart(5, " ")} | ${line}` : line).join("\n");

    const isTruncated = (startLine > 1 || endLine < totalLines);
    if (isTruncated) {
        content += `\n\n[File truncated: showing lines ${startLine}-${endLine} of ${totalLines}. Use start_line/end_line to read further sections.]`;
    }

    return {
        path: args.path,
        resolved_path: targetPath,
        type: "text",
        content,
        start_line: startLine,
        end_line: endLine,
        total_lines: totalLines,
        is_truncated: isTruncated
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

        if (reqUrl === "/api/file/resolve") {
            const rawPath = args.path || "$ARTIFACTS/checkpoint.md";
            const targetPath = resolveSafePath(rawPath, chatId);
            return sendJSON(res, 200, {
                path: rawPath,
                resolved_path: targetPath,
                exists: fs.existsSync(targetPath)
            });
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
