const fs = require("fs");
const path = require("path");

function isBinaryBuffer(buffer) {
    const checkLen = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function generateUnifiedDiff(oldStr, newStr, filename = "file") {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");

    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
        prefix++;
    }

    let suffix = 0;
    while (
        suffix < oldLines.length - prefix &&
        suffix < newLines.length - prefix &&
        oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
        suffix++;
    }

    const startContext = Math.max(0, prefix - 2);
    const endContextOld = Math.min(oldLines.length, oldLines.length - suffix + 2);
    const endContextNew = Math.min(newLines.length, newLines.length - suffix + 2);

    const oldRangeLen = endContextOld - startContext;
    const newRangeLen = endContextNew - startContext;

    const diffLines = [];
    diffLines.push(`--- a/${filename}`);
    diffLines.push(`+++ b/${filename}`);
    diffLines.push(`@@ -${startContext + 1},${oldRangeLen} +${startContext + 1},${newRangeLen} @@`);

    for (let i = startContext; i < prefix; i++) {
        diffLines.push(`  ${oldLines[i]}`);
    }

    for (let i = prefix; i < oldLines.length - suffix; i++) {
        diffLines.push(`- ${oldLines[i]}`);
    }

    for (let i = prefix; i < newLines.length - suffix; i++) {
        diffLines.push(`+ ${newLines[i]}`);
    }

    for (let i = oldLines.length - suffix; i < endContextOld; i++) {
        diffLines.push(`  ${oldLines[i]}`);
    }

    return diffLines.join("\n");
}

function countOccurrences(source, search) {
    if (!search) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = source.indexOf(search, pos)) !== -1) {
        count++;
        pos += search.length;
    }
    return count;
}

async function handleCodeGrep(args, chatId, { resolveSafePath }) {
    throw new Error("grep_search tool is being rebuilt with clean modular architecture.");
}

async function handleReplaceFileContent(args, chatId, { resolveSafePath }) {
    const rawPath = args.path || args.TargetFile || args.target_file;
    if (!rawPath) {
        throw new Error("Missing required parameter 'path'.");
    }

    const targetContent = args.target_content !== undefined ? args.target_content : args.TargetContent;
    if (targetContent === undefined || targetContent === null) {
        throw new Error("Missing required parameter 'target_content'.");
    }

    const replacementContent = args.replacement_content !== undefined ? args.replacement_content : args.ReplacementContent;
    if (replacementContent === undefined || replacementContent === null) {
        throw new Error("Missing required parameter 'replacement_content'.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File not found: ${rawPath}`);
    }

    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
        throw new Error(`Target path '${rawPath}' is a directory, not a file.`);
    }

    const rawBuffer = await fs.promises.readFile(targetPath);
    if (isBinaryBuffer(rawBuffer)) {
        throw new Error(`Cannot edit binary file: ${rawPath}`);
    }

    const originalContent = rawBuffer.toString("utf-8");
    const hasCRLF = originalContent.includes("\r\n");
    const content = originalContent.replace(/\r\n/g, "\n");
    const target = String(targetContent).replace(/\r\n/g, "\n");
    const replacement = String(replacementContent).replace(/\r\n/g, "\n");

    const allowMultiple = Boolean(args.allow_multiple || args.AllowMultiple);
    const startLineRaw = args.start_line !== undefined ? args.start_line : args.StartLine;
    const endLineRaw = args.end_line !== undefined ? args.end_line : args.EndLine;

    let newContent;
    let matchedLines = null;

    if (startLineRaw !== undefined || endLineRaw !== undefined) {
        const lines = content.split("\n");
        const totalLines = lines.length;
        const startLine = Math.max(1, parseInt(startLineRaw, 10) || 1);
        const endLine = Math.min(totalLines, Math.max(startLine, parseInt(endLineRaw, 10) || totalLines));

        const before = lines.slice(0, startLine - 1).join("\n");
        const windowSlice = lines.slice(startLine - 1, endLine).join("\n");
        const after = lines.slice(endLine).join("\n");

        const occurrences = countOccurrences(windowSlice, target);
        if (occurrences === 0) {
            throw new Error(
                `Target content not found in lines ${startLine}-${endLine} of ${rawPath}. ` +
                `Ensure exact line numbers and matching indentation/whitespace.`
            );
        }
        if (occurrences > 1 && !allowMultiple) {
            throw new Error(
                `Found ${occurrences} occurrences of target content in lines ${startLine}-${endLine} of ${rawPath}. ` +
                `Specify more surrounding context lines or set 'allow_multiple: true'.`
            );
        }

        const replacedSlice = allowMultiple
            ? windowSlice.split(target).join(replacement)
            : windowSlice.replace(target, replacement);

        const parts = [];
        if (startLine > 1) parts.push(before);
        parts.push(replacedSlice);
        if (endLine < totalLines) parts.push(after);
        newContent = parts.join("\n");
        matchedLines = { start: startLine, end: endLine };
    } else {
        const occurrences = countOccurrences(content, target);
        if (occurrences === 0) {
            throw new Error(
                `Target content not found in ${rawPath}. Please ensure exact matching including whitespace and indentation.`
            );
        }
        if (occurrences > 1 && !allowMultiple) {
            throw new Error(
                `Found ${occurrences} occurrences of target content in ${rawPath}. ` +
                `Specify 'start_line'/'end_line', provide more surrounding context lines, or set 'allow_multiple: true'.`
            );
        }

        newContent = allowMultiple
            ? content.split(target).join(replacement)
            : content.replace(target, replacement);
    }

    const finalContent = hasCRLF ? newContent.replace(/\n/g, "\r\n") : newContent;
    await fs.promises.writeFile(targetPath, finalContent, "utf-8");

    const oldLinesCount = content.split("\n").length;
    const newLinesCount = newContent.split("\n").length;
    const diff = generateUnifiedDiff(content, newContent, path.basename(rawPath));

    return {
        status: "success",
        path: rawPath,
        resolved_path: targetPath,
        matched_window: matchedLines,
        lines_before: oldLinesCount,
        lines_after: newLinesCount,
        lines_diff: newLinesCount - oldLinesCount,
        bytes_written: Buffer.byteLength(finalContent, "utf-8"),
        instruction: args.instruction || args.Instruction || null,
        description: args.description || args.Description || null,
        diff,
        message: `Successfully replaced content in ${rawPath}`
    };
}

async function handleMultiReplaceFileContent(args, chatId, { resolveSafePath }) {
    const rawPath = args.path || args.TargetFile || args.target_file;
    if (!rawPath) {
        throw new Error("Missing required parameter 'path'.");
    }

    const chunks = args.replacement_chunks || args.ReplacementChunks;
    if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new Error("Missing or empty 'replacement_chunks' array.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File not found: ${rawPath}`);
    }

    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
        throw new Error(`Target path '${rawPath}' is a directory, not a file.`);
    }

    const rawBuffer = await fs.promises.readFile(targetPath);
    if (isBinaryBuffer(rawBuffer)) {
        throw new Error(`Cannot edit binary file: ${rawPath}`);
    }

    const originalContent = rawBuffer.toString("utf-8");
    const hasCRLF = originalContent.includes("\r\n");
    let currentContent = originalContent.replace(/\r\n/g, "\n");

    // Pre-normalize chunks
    const normalizedChunks = chunks.map((c, index) => {
        const target = c.target_content !== undefined ? c.target_content : c.TargetContent;
        const replacement = c.replacement_content !== undefined ? c.replacement_content : c.ReplacementContent;
        if (target === undefined || target === null) {
            throw new Error(`Chunk #${index + 1} is missing 'target_content'.`);
        }
        if (replacement === undefined || replacement === null) {
            throw new Error(`Chunk #${index + 1} is missing 'replacement_content'.`);
        }
        const sLine = c.start_line !== undefined ? parseInt(c.start_line, 10) : (c.StartLine !== undefined ? parseInt(c.StartLine, 10) : undefined);
        const eLine = c.end_line !== undefined ? parseInt(c.end_line, 10) : (c.EndLine !== undefined ? parseInt(c.EndLine, 10) : undefined);
        const allowMultiple = Boolean(c.allow_multiple || c.AllowMultiple);

        return {
            index: index + 1,
            target: String(target).replace(/\r\n/g, "\n"),
            replacement: String(replacement).replace(/\r\n/g, "\n"),
            startLine: isNaN(sLine) ? undefined : sLine,
            endLine: isNaN(eLine) ? undefined : eLine,
            allowMultiple
        };
    });

    const allHaveLineNumbers = normalizedChunks.every(c => c.startLine !== undefined);

    let sortedChunks;
    if (allHaveLineNumbers) {
        sortedChunks = [...normalizedChunks].sort((a, b) => (b.startLine || 0) - (a.startLine || 0));
    } else {
        const located = [];
        for (const chunk of normalizedChunks) {
            const count = countOccurrences(currentContent, chunk.target);
            if (count === 0) {
                throw new Error(
                    `Chunk #${chunk.index} target content not found in ${rawPath}. ` +
                    `Ensure exact match including whitespace and indentation.`
                );
            }
            if (count > 1 && !chunk.allowMultiple) {
                throw new Error(
                    `Chunk #${chunk.index} has ${count} matches in ${rawPath}. ` +
                    `Specify 'start_line'/'end_line' or set 'allow_multiple: true'.`
                );
            }
            const pos = currentContent.indexOf(chunk.target);
            located.push({ ...chunk, pos });
        }
        located.sort((a, b) => a.pos - b.pos);
        for (let i = 0; i < located.length - 1; i++) {
            if (located[i].pos + located[i].target.length > located[i + 1].pos) {
                throw new Error(
                    `Overlapping replacement chunks detected between Chunk #${located[i].index} and Chunk #${located[i + 1].index}.`
                );
            }
        }
        sortedChunks = located.sort((a, b) => b.pos - a.pos);
    }

    // Execute edits bottom-up
    for (const chunk of sortedChunks) {
        if (chunk.startLine !== undefined) {
            const lines = currentContent.split("\n");
            const totalLines = lines.length;
            const startLine = Math.max(1, chunk.startLine);
            const endLine = Math.min(totalLines, Math.max(startLine, chunk.endLine || totalLines));

            const before = lines.slice(0, startLine - 1).join("\n");
            const windowSlice = lines.slice(startLine - 1, endLine).join("\n");
            const after = lines.slice(endLine).join("\n");

            const count = countOccurrences(windowSlice, chunk.target);
            if (count === 0) {
                throw new Error(
                    `Chunk #${chunk.index} target content not found in lines ${startLine}-${endLine} of ${rawPath}.`
                );
            }
            if (count > 1 && !chunk.allowMultiple) {
                throw new Error(
                    `Chunk #${chunk.index} has ${count} matches in lines ${startLine}-${endLine} of ${rawPath}. ` +
                    `Disambiguate with more surrounding lines or enable allow_multiple.`
                );
            }

            const replacedSlice = chunk.allowMultiple
                ? windowSlice.split(chunk.target).join(chunk.replacement)
                : windowSlice.replace(chunk.target, chunk.replacement);

            const parts = [];
            if (startLine > 1) parts.push(before);
            parts.push(replacedSlice);
            if (endLine < totalLines) parts.push(after);
            currentContent = parts.join("\n");
        } else {
            const count = countOccurrences(currentContent, chunk.target);
            if (count === 0) {
                throw new Error(`Chunk #${chunk.index} target content not found in ${rawPath}.`);
            }
            if (count > 1 && !chunk.allowMultiple) {
                throw new Error(
                    `Chunk #${chunk.index} has ${count} matches in ${rawPath}. Enable allow_multiple or provide line numbers.`
                );
            }
            currentContent = chunk.allowMultiple
                ? currentContent.split(chunk.target).join(chunk.replacement)
                : currentContent.replace(chunk.target, chunk.replacement);
        }
    }

    const finalContent = hasCRLF ? currentContent.replace(/\n/g, "\r\n") : currentContent;
    await fs.promises.writeFile(targetPath, finalContent, "utf-8");

    const oldLinesCount = originalContent.replace(/\r\n/g, "\n").split("\n").length;
    const newLinesCount = currentContent.split("\n").length;
    const diff = generateUnifiedDiff(originalContent.replace(/\r\n/g, "\n"), currentContent, path.basename(rawPath));

    return {
        status: "success",
        path: rawPath,
        resolved_path: targetPath,
        chunks_applied: chunks.length,
        lines_before: oldLinesCount,
        lines_after: newLinesCount,
        lines_diff: newLinesCount - oldLinesCount,
        bytes_written: Buffer.byteLength(finalContent, "utf-8"),
        instruction: args.instruction || args.Instruction || null,
        description: args.description || args.Description || null,
        diff,
        message: `Successfully applied ${chunks.length} replacement chunks in ${rawPath}`
    };
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
    handleSearchAndReplace: handleReplaceFileContent,
    handleReplaceFileContent,
    handleMultiReplaceFileContent,
    handleWriteFile
};
