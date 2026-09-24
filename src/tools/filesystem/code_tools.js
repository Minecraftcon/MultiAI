const fs = require("fs");
const path = require("path");
const { execFile, execSync } = require("child_process");

let rgBinaryPath = null;
try {
    const whichOut = execSync("which rg || which ripgrep", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (whichOut && fs.existsSync(whichOut)) {
        rgBinaryPath = whichOut;
    }
} catch {
    rgBinaryPath = null;
}

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

function executeRipgrep(opts) {
    return new Promise((resolve, reject) => {
        const args = ["--json"];

        if (!opts.isRegex) {
            args.push("-F"); // exact literal match
        }
        if (opts.caseInsensitive) {
            args.push("-i");
        }
        for (const g of opts.globList) {
            if (g && typeof g === "string") {
                args.push("-g", g);
            }
        }

        args.push("--max-count", String(opts.maxMatches));
        args.push("--", opts.query, opts.targetPath);

        execFile(opts.rgPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            // rg exits with 1 if no matches found, which is a normal result
            if (err && err.code !== 1 && err.code !== 0) {
                return reject(new Error(`Ripgrep error: ${stderr || err.message}`));
            }

            const lines = (stdout || "").split("\n");
            const matches = [];
            const files = new Set();
            let isTruncated = false;

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === "match" && parsed.data) {
                        const fileText = parsed.data.path?.text || "";
                        const relativeFile = path.relative(process.cwd(), fileText) || fileText;
                        files.add(relativeFile);

                        if (matches.length < opts.maxMatches) {
                            matches.push({
                                filename: relativeFile,
                                line_number: parsed.data.line_number,
                                line_content: (parsed.data.lines?.text || "").replace(/\r?\n$/, "")
                            });
                        } else {
                            isTruncated = true;
                        }
                    }
                } catch {
                    // Ignore malformed lines
                }
            }

            if (opts.matchPerLine) {
                resolve({
                    status: "success",
                    engine: "ripgrep",
                    query: opts.query,
                    search_path: opts.displayPath,
                    total_matches: matches.length,
                    is_truncated: isTruncated || matches.length >= opts.maxMatches,
                    matches
                });
            } else {
                const uniqueFiles = Array.from(files).slice(0, opts.maxMatches);
                resolve({
                    status: "success",
                    engine: "ripgrep",
                    query: opts.query,
                    search_path: opts.displayPath,
                    total_files: uniqueFiles.length,
                    is_truncated: files.size > opts.maxMatches,
                    files: uniqueFiles
                });
            }
        });
    });
}

async function executeNodeGrep(opts) {
    const matches = [];
    const files = new Set();
    let isTruncated = false;

    let regex;
    try {
        const flags = opts.caseInsensitive ? "i" : "";
        regex = opts.isRegex
            ? new RegExp(opts.query, flags)
            : new RegExp(opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch (e) {
        throw new Error(`Invalid regular expression: ${opts.query} (${e.message})`);
    }

    async function walk(currentDir) {
        if (matches.length >= opts.maxMatches) {
            isTruncated = true;
            return;
        }

        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (matches.length >= opts.maxMatches) {
                isTruncated = true;
                break;
            }

            const fullPath = path.join(currentDir, entry.name);
            const relativePath = path.relative(process.cwd(), fullPath);

            if (entry.isDirectory()) {
                if (["node_modules", ".git", ".next", "dist", "build", ".venv", "__pycache__"].includes(entry.name)) {
                    continue;
                }
                await walk(fullPath);
            } else if (entry.isFile()) {
                if (opts.globList.length > 0) {
                    const matchesGlob = opts.globList.some(g => {
                        if (g.startsWith("*.")) {
                            return entry.name.endsWith(g.slice(1));
                        }
                        return entry.name.includes(g);
                    });
                    if (!matchesGlob) continue;
                }

                try {
                    const stat = await fs.promises.stat(fullPath);
                    if (stat.size > 2 * 1024 * 1024) continue; // Skip files > 2MB

                    const buffer = await fs.promises.readFile(fullPath);
                    if (isBinaryBuffer(buffer)) continue;

                    const content = buffer.toString("utf-8");
                    if (!regex.test(content)) continue;

                    files.add(relativePath);

                    if (opts.matchPerLine) {
                        const fileLines = content.split(/\r?\n/);
                        for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
                            const lineText = fileLines[lineIdx];
                            if (regex.test(lineText)) {
                                matches.push({
                                    filename: relativePath,
                                    line_number: lineIdx + 1,
                                    line_content: lineText
                                });
                                if (matches.length >= opts.maxMatches) {
                                    isTruncated = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch {
                    // Ignore unreadable files
                }
            }
        }
    }

    const stat = await fs.promises.stat(opts.targetPath);
    if (stat.isDirectory()) {
        await walk(opts.targetPath);
    } else {
        const buffer = await fs.promises.readFile(opts.targetPath);
        if (!isBinaryBuffer(buffer)) {
            const content = buffer.toString("utf-8");
            const relativePath = path.relative(process.cwd(), opts.targetPath);
            if (regex.test(content)) {
                files.add(relativePath);
                if (opts.matchPerLine) {
                    const fileLines = content.split(/\r?\n/);
                    for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
                        if (regex.test(fileLines[lineIdx])) {
                            matches.push({
                                filename: relativePath,
                                line_number: lineIdx + 1,
                                line_content: fileLines[lineIdx]
                            });
                            if (matches.length >= opts.maxMatches) {
                                isTruncated = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if (opts.matchPerLine) {
        return {
            status: "success",
            engine: "node-scanner",
            query: opts.query,
            search_path: opts.displayPath,
            total_matches: matches.length,
            is_truncated: isTruncated || matches.length >= opts.maxMatches,
            matches
        };
    } else {
        const uniqueFiles = Array.from(files).slice(0, opts.maxMatches);
        return {
            status: "success",
            engine: "node-scanner",
            query: opts.query,
            search_path: opts.displayPath,
            total_files: uniqueFiles.length,
            is_truncated: files.size > opts.maxMatches,
            files: uniqueFiles
        };
    }
}

async function handleCodeGrep(args, chatId, { resolveSafePath }) {
    const rawPath = args.SearchPath || args.search_path || args.path || ".";
    const query = args.Query !== undefined ? args.Query : (args.query !== undefined ? args.query : (args.pattern !== undefined ? args.pattern : ""));

    if (!query) {
        throw new Error("Missing required parameter 'Query'.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Search path not found: ${rawPath}`);
    }

    const isRegex = Boolean(args.IsRegex || args.is_regex);
    const caseInsensitive = Boolean(args.CaseInsensitive || args.case_insensitive);
    const matchPerLine = args.MatchPerLine !== undefined ? Boolean(args.MatchPerLine) : (args.match_per_line !== undefined ? Boolean(args.match_per_line) : true);
    const includes = args.Includes || args.includes || args.glob || [];
    const globList = Array.isArray(includes) ? includes : (typeof includes === "string" ? [includes] : []);

    const MAX_MATCHES = 50;

    if (rgBinaryPath) {
        return await executeRipgrep({
            rgPath: rgBinaryPath,
            targetPath,
            displayPath: rawPath,
            query,
            isRegex,
            caseInsensitive,
            matchPerLine,
            globList,
            maxMatches: MAX_MATCHES
        });
    }

    return await executeNodeGrep({
        targetPath,
        displayPath: rawPath,
        query,
        isRegex,
        caseInsensitive,
        matchPerLine,
        globList,
        maxMatches: MAX_MATCHES
    });
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
