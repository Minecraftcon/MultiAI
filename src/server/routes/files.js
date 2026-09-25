const fs = require("fs");
const path = require("path");
const { resolveSafePath, formatBytes, getMimeType, sendJSON, postJSON } = require("../utils");
const { handleCodeGrep, handleSearchAndReplace, handleReplaceFileContent, handleMultiReplaceFileContent, handleWriteFile } = require("../../tools/filesystem/code_tools");

async function handleFileRead(args, chatId) {
    const rawPath = args.path || args.AbsolutePath || args.target_file || args.file_path;
    if (!rawPath) {
        throw new Error("Missing required parameter 'path'.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File or directory not found: ${rawPath}`);
    }

    const stat = await fs.promises.stat(targetPath);

    // 1. Directory inspection (with 100-entry truncation cap)
    if (stat.isDirectory()) {
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const formattedEntries = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file"
        }));
        const slicedEntries = entries.slice(0, 100);
        const isDirTruncated = entries.length > 100;
        let content = slicedEntries.map(e => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`).join("\n");
        if (isDirTruncated) {
            content += `\n\n[Directory truncated: showing first 100 of ${entries.length} items.]`;
        }
        return {
            path: rawPath,
            resolved_path: targetPath,
            type: "directory",
            is_dir: true,
            entry_count: entries.length,
            entries: formattedEntries.slice(0, 100),
            content,
            is_truncated: isDirTruncated
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
                path: rawPath,
                resolved_path: targetPath,
                type: "image",
                mime,
                size_bytes: stat.size,
                human_size: formatBytes(stat.size),
                data_url: dataUrl,
                markdown: `![${path.basename(targetPath)}](${rawPath})`
            };
        } else {
            return {
                path: rawPath,
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
            path: rawPath,
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
            path: rawPath,
            resolved_path: targetPath,
            type: "binary",
            is_binary: true,
            mime_type: mime,
            size_bytes: stat.size,
            human_size: formatBytes(stat.size),
            message: `Binary file (${mime}, ${formatBytes(stat.size)}). Cannot read as text.`
        };
    }

    // 4. Text File Inspection with Strict 400-Line Window & 45KB Byte Limit
    const MAX_WINDOW = 400;
    const MAX_BYTES = 46080; // 45 KB hard limit per view

    const raw = await fs.promises.readFile(targetPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const rawStartLine = args.start_line !== undefined ? args.start_line : args.StartLine;
    const rawEndLine = args.end_line !== undefined ? args.end_line : args.EndLine;
    const contentOffset = Math.max(0, parseInt(args.content_offset || args.ContentOffset || args.offset, 10) || 0);

    let startLine = 1;
    let endLine = Math.min(totalLines, MAX_WINDOW);

    const hasStart = rawStartLine !== undefined && rawStartLine !== null && !isNaN(parseInt(rawStartLine, 10));
    const hasEnd = rawEndLine !== undefined && rawEndLine !== null && !isNaN(parseInt(rawEndLine, 10));

    if (hasStart && hasEnd) {
        const reqStart = Math.max(1, Math.min(totalLines, parseInt(rawStartLine, 10)));
        const reqEnd = Math.min(totalLines, Math.max(reqStart, parseInt(rawEndLine, 10)));
        startLine = reqStart;
        endLine = Math.min(reqEnd, startLine + MAX_WINDOW - 1);
    } else if (hasStart) {
        startLine = Math.max(1, Math.min(totalLines, parseInt(rawStartLine, 10)));
        endLine = Math.min(totalLines, startLine + MAX_WINDOW - 1);
    } else if (hasEnd) {
        endLine = Math.min(totalLines, Math.max(1, parseInt(rawEndLine, 10)));
        startLine = Math.max(1, endLine - MAX_WINDOW + 1);
    }

    const isNumbered = args.numbered !== false;
    const sliced = lines.slice(startLine - 1, endLine);
    let formattedContent = sliced.map((line, idx) => {
        const lineNum = startLine + idx;
        return isNumbered ? `${String(lineNum).padStart(5, " ")} | ${line}` : line;
    }).join("\n");

    const contentBuffer = Buffer.from(formattedContent, "utf8");
    const fullByteLength = contentBuffer.length;

    let finalContent = formattedContent;
    let isByteTruncated = false;

    if (contentOffset > 0 || fullByteLength > MAX_BYTES) {
        if (contentOffset < fullByteLength) {
            const endOffset = Math.min(fullByteLength, contentOffset + MAX_BYTES);
            const slicedBuf = contentBuffer.subarray(contentOffset, endOffset);
            finalContent = slicedBuf.toString("utf8");
            isByteTruncated = endOffset < fullByteLength;

            let byteNotice = `\n\n[Content truncated: showing bytes ${contentOffset} to ${endOffset} of ${fullByteLength} (${MAX_BYTES} bytes limit per view).`;
            if (isByteTruncated) {
                byteNotice += ` Use content_offset=${endOffset} to view the next chunk.]`;
            } else {
                byteNotice += ` Reached end of line slice.]`;
            }
            finalContent += byteNotice;
        } else {
            finalContent = `[Content offset ${contentOffset} exceeds available slice bytes (${fullByteLength}).]`;
        }
    }

    const isLineTruncated = (startLine > 1 || endLine < totalLines);
    if (isLineTruncated && !isByteTruncated && contentOffset === 0) {
        finalContent += `\n\n[File truncated: showing lines ${startLine}-${endLine} of ${totalLines} (max 400 lines per read). Use start_line/end_line to read further sections.]`;
    }

    return {
        path: rawPath,
        resolved_path: targetPath,
        type: "text",
        content: finalContent,
        start_line: startLine,
        end_line: endLine,
        total_lines: totalLines,
        content_offset: contentOffset,
        byte_length: fullByteLength,
        is_truncated: isLineTruncated || isByteTruncated
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

        if (reqUrl === "/api/file/replace" || reqUrl === "/api/file/search-replace") {
            const result = await handleReplaceFileContent(args, chatId, { resolveSafePath });
            return sendJSON(res, 200, result);
        }

        if (reqUrl === "/api/file/multi-replace") {
            const result = await handleMultiReplaceFileContent(args, chatId, { resolveSafePath });
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
