const fs = require("fs");
const path = require("path");
const { execFile, execSync } = require("child_process");
const shadowGit = require("../../core/shadow_git_manager");

function getWorkspaceForFile(targetPath, chatId) {
    let ws = null;
    if (chatId) {
        try {
            const { getChatWorkspace } = require("../../server/utils");
            const wsContext = getChatWorkspace(chatId);
            if (wsContext && wsContext.project && wsContext.project.rootPath) {
                ws = path.resolve(wsContext.project.rootPath);
            }
        } catch (_) {}
    }
    const resolvedTarget = path.resolve(targetPath);

    // 1. If chat is bound to a specific build project:
    if (ws) {
        const rel = path.relative(ws, resolvedTarget);
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
            return {
                workspaceRoot: ws,
                relativePath: rel
            };
        }
        // Target is outside build project workspace: do not track
        return null;
    }

    // 2. Active server workspace (configured by --workspace or MULTIAI_WORKSPACE_DIR or process.cwd()):
    const primaryWs = path.resolve(process.env.MULTIAI_WORKSPACE_DIR || process.cwd());
    const cwdRel = path.relative(primaryWs, resolvedTarget);
    if (!cwdRel.startsWith("..") && !path.isAbsolute(cwdRel)) {
        return {
            workspaceRoot: primaryWs,
            relativePath: cwdRel
        };
    }

    // 3. Target is outside the active workspace:
    // Do NOT track files outside the workspace for diffs!
    return null;
}

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
        diffLines.push(` ${oldLines[i]}`);
    }

    let deletions = 0;
    for (let i = prefix; i < oldLines.length - suffix; i++) {
        diffLines.push(`-${oldLines[i]}`);
        deletions++;
    }

    let additions = 0;
    for (let i = prefix; i < newLines.length - suffix; i++) {
        diffLines.push(`+${newLines[i]}`);
        additions++;
    }

    for (let i = oldLines.length - suffix; i < endContextOld; i++) {
        diffLines.push(` ${oldLines[i]}`);
    }

    const diffStr = diffLines.join("\n");
    return {
        diff: diffStr,
        additions,
        deletions,
        toString() { return diffStr; }
    };
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

function extractArtifactMetadata(args) {
    if (!args || typeof args !== "object") return null;
    return args.ArtifactMetadata || args.artifact_metadata || args.metadata || args.Metadata || null;
}

function isArtifactTarget(rawPath, resolvedPath, chatId, metadata) {
    const raw = String(rawPath || "").trim();
    if (
        raw === "$SCRATCH" ||
        raw === "${SCRATCH}" ||
        raw.startsWith("$SCRATCH/") ||
        raw.startsWith("${SCRATCH}/") ||
        raw.startsWith("$SCRATCH\\") ||
        raw.startsWith("${SCRATCH}\\")
    ) {
        return false;
    }
    const normLower = raw.replace(/\\/g, "/").toLowerCase();
    if (normLower === "scratch" || normLower.startsWith("scratch/") || normLower.startsWith("./scratch/")) {
        return false;
    }
    if (resolvedPath) {
        const normRes = path.resolve(resolvedPath).replace(/\\/g, "/");
        if (normRes.includes("/scratch/")) {
            return false;
        }
    }

    if (metadata && typeof metadata === "object") return true;
    if (
        raw === "$ARTIFACTS" ||
        raw === "${ARTIFACTS}" ||
        raw.startsWith("$ARTIFACTS/") ||
        raw.startsWith("${ARTIFACTS}/") ||
        raw.startsWith("$ARTIFACTS\\") ||
        raw.startsWith("${ARTIFACTS}\\")
    ) {
        return true;
    }
    if (normLower === "artifacts" || normLower.startsWith("artifacts/") || normLower.startsWith("./artifacts/")) {
        return true;
    }
    if (chatId) {
        try {
            const { getChatArtifactsDir } = require("../../server/utils");
            const artifactsDir = path.resolve(getChatArtifactsDir(chatId));
            if (resolvedPath) {
                const res = path.resolve(resolvedPath);
                if (res === artifactsDir || res.startsWith(artifactsDir + path.sep)) {
                    return true;
                }
            }
        } catch (_) {}
    }
    if (resolvedPath) {
        const normRes = path.resolve(resolvedPath).replace(/\\/g, "/");
        if (normRes.includes("/artifacts/")) {
            return true;
        }
    }
    return false;
}

const isArtifactPath = isArtifactTarget;

async function recordArtifactInCatalog({ rawPath, resolvedPath, chatId, metadata, content }) {
    try {
        let artifactsDir = null;
        if (chatId) {
            try {
                const { getChatArtifactsDir } = require("../../server/utils");
                artifactsDir = getChatArtifactsDir(chatId);
            } catch (_) {}
        }
        if (!artifactsDir && resolvedPath) {
            const dir = path.dirname(path.resolve(resolvedPath));
            if (path.basename(dir) === "artifacts") {
                artifactsDir = dir;
            } else {
                const norm = path.resolve(resolvedPath).replace(/\\/g, "/");
                const artIdx = norm.lastIndexOf("/artifacts/");
                if (artIdx !== -1) {
                    artifactsDir = norm.slice(0, artIdx + "/artifacts".length);
                }
            }
        }
        if (!artifactsDir) {
            try {
                const conversationsManager = require("../../core/conversations_manager");
                artifactsDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
            } catch (_) {}
        }
        if (!artifactsDir) return null;

        if (!fs.existsSync(artifactsDir)) {
            await fs.promises.mkdir(artifactsDir, { recursive: true });
        }

        const catalogPath = path.join(artifactsDir, "artifacts.json");
        let catalog = { artifacts: [] };
        if (fs.existsSync(catalogPath)) {
            try {
                const raw = await fs.promises.readFile(catalogPath, "utf-8");
                catalog = JSON.parse(raw);
                if (!Array.isArray(catalog.artifacts)) {
                    catalog.artifacts = [];
                }
            } catch (_) {
                catalog = { artifacts: [] };
            }
        }

        const resolved = path.resolve(resolvedPath || rawPath);
        const filename = path.basename(resolved);
        const relToArtifacts = path.relative(path.resolve(artifactsDir), resolved).replace(/\\/g, "/");
        const canonicalPath = (rawPath && (rawPath.startsWith("$ARTIFACTS") || rawPath.startsWith("${ARTIFACTS}")))
            ? rawPath
            : `$ARTIFACTS/${relToArtifacts.startsWith("./") ? relToArtifacts.slice(2) : relToArtifacts}`;

        const rawMeta = (metadata && typeof metadata === "object") ? metadata : {};
        const userFacing = rawMeta.UserFacing !== undefined
            ? Boolean(rawMeta.UserFacing)
            : (rawMeta.userFacing !== undefined ? Boolean(rawMeta.userFacing) : true);
        const summary = (rawMeta.Summary !== undefined && rawMeta.Summary !== null && String(rawMeta.Summary).trim() !== "")
            ? String(rawMeta.Summary)
            : ((rawMeta.summary !== undefined && rawMeta.summary !== null && String(rawMeta.summary).trim() !== "")
                ? String(rawMeta.summary)
                : filename);
        const requestFeedback = rawMeta.RequestFeedback !== undefined
            ? Boolean(rawMeta.RequestFeedback)
            : (rawMeta.requestFeedback !== undefined ? Boolean(rawMeta.requestFeedback) : false);

        let size = 0;
        if (content !== undefined && content !== null) {
            size = Buffer.byteLength(String(content), "utf-8");
        } else if (fs.existsSync(resolved)) {
            const stat = await fs.promises.stat(resolved);
            size = stat.size;
        }

        const updatedAt = Date.now();

        // Check if artifact already exists in catalog
        const existingIdx = catalog.artifacts.findIndex(a =>
            a.resolvedPath === resolved ||
            a.name === filename ||
            a.path === canonicalPath
        );

        let artifactId;
        const entryRecord = {
            id: "",
            name: filename,
            path: canonicalPath,
            resolvedPath: resolved,
            summary,
            Summary: summary,
            userFacing,
            UserFacing: userFacing,
            requestFeedback,
            RequestFeedback: requestFeedback,
            size,
            updatedAt
        };

        if (existingIdx >= 0) {
            artifactId = catalog.artifacts[existingIdx].id || `art-${existingIdx + 1}`;
            entryRecord.id = artifactId;
            catalog.artifacts[existingIdx] = entryRecord;
        } else {
            let maxNum = 0;
            for (const a of catalog.artifacts) {
                const m = String(a.id || "").match(/^art-(\d+)$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (!isNaN(n) && n > maxNum) maxNum = n;
                }
            }
            artifactId = `art-${maxNum + 1}`;
            entryRecord.id = artifactId;
            catalog.artifacts.push(entryRecord);
        }

        await fs.promises.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");

        return {
            id: artifactId,
            UserFacing: userFacing,
            Summary: summary,
            RequestFeedback: requestFeedback,
            userFacing,
            summary,
            requestFeedback
        };
    } catch (err) {
        console.error(`[ARTIFACTS] Error updating catalog:`, err.message);
        return null;
    }
}

async function handleReplaceFileContent(args, chatId, { resolveSafePath }) {
    const rawPath = args.path || args.Path || args.TargetFile || args.target_file || args.targetFile;
    if (!rawPath) {
        throw new Error("Missing required parameter 'path'.");
    }

    const targetContent = args.target_content !== undefined
        ? args.target_content
        : (args.TargetContent !== undefined
            ? args.TargetContent
            : (args.target !== undefined
                ? args.target
                : (args.Target !== undefined
                    ? args.Target
                    : (args.targetContent !== undefined ? args.targetContent : undefined))));
    if (targetContent === undefined || targetContent === null) {
        throw new Error("Missing required parameter 'target_content'.");
    }

    const replacementContent = args.replacement_content !== undefined
        ? args.replacement_content
        : (args.ReplacementContent !== undefined
            ? args.ReplacementContent
            : (args.replacement !== undefined
                ? args.replacement
                : (args.Replacement !== undefined
                    ? args.Replacement
                    : (args.replacementContent !== undefined ? args.replacementContent : undefined))));
    if (replacementContent === undefined || replacementContent === null) {
        throw new Error("Missing required parameter 'replacement_content'.");
    }

    const artifactMeta = extractArtifactMetadata(args);

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
    const wsInfo = getWorkspaceForFile(targetPath, chatId);
    if (wsInfo && wsInfo.relativePath) {
        try { shadowGit.recordPreEditBaseline(wsInfo.workspaceRoot, wsInfo.relativePath, { chatId }); } catch (_) {}
    }

    await fs.promises.writeFile(targetPath, finalContent, "utf-8");

    if (wsInfo && wsInfo.relativePath) {
        try {
            shadowGit.recordPostEditCommit(wsInfo.workspaceRoot, wsInfo.relativePath, {
                chatId,
                tool: "replace_file_content",
                instruction: args.instruction || args.description || "Replaced file content"
            });
        } catch (_) {}
    }

    const oldLinesCount = content.split("\n").length;
    const newLinesCount = newContent.split("\n").length;
    const diffRes = generateUnifiedDiff(content, newContent, path.basename(rawPath));

    const isArtifact = isArtifactPath(rawPath, targetPath, chatId);
    const rawMeta = args.ArtifactMetadata || args.artifact_metadata || args.artifactMetadata || null;
    let artifactMetadata = null;
    if (isArtifact) {
        const record = await recordArtifactInCatalog({
            rawPath,
            resolvedPath: targetPath,
            chatId,
            metadata: rawMeta,
            content: finalContent
        });
        if (record) {
            artifactMetadata = record;
        }
    }

    const result = {
        status: "success",
        path: rawPath,
        resolved_path: targetPath,
        matched_window: matchedLines,
        lines_before: oldLinesCount,
        lines_after: newLinesCount,
        lines_diff: newLinesCount - oldLinesCount,
        lines_added: diffRes.additions,
        lines_removed: diffRes.deletions,
        bytes_written: Buffer.byteLength(finalContent, "utf-8"),
        instruction: args.instruction || args.Instruction || null,
        description: args.description || args.Description || null,
        diff: diffRes.diff,
        message: `Successfully replaced content in ${rawPath}`
    };

    if (isArtifact) {
        result.is_artifact = true;
        result.artifact_metadata = artifactMetadata || rawMeta || { UserFacing: true, Summary: path.basename(targetPath), RequestFeedback: false };
    }

    return result;
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
    const wsInfo = getWorkspaceForFile(targetPath, chatId);
    if (wsInfo && wsInfo.relativePath) {
        try { shadowGit.recordPreEditBaseline(wsInfo.workspaceRoot, wsInfo.relativePath, { chatId }); } catch (_) {}
    }

    await fs.promises.writeFile(targetPath, finalContent, "utf-8");

    if (wsInfo && wsInfo.relativePath) {
        try {
            shadowGit.recordPostEditCommit(wsInfo.workspaceRoot, wsInfo.relativePath, {
                chatId,
                tool: "multi_replace_file_content",
                instruction: args.instruction || args.description || `Applied ${chunks.length} chunks`
            });
        } catch (_) {}
    }

    const oldLinesCount = originalContent.replace(/\r\n/g, "\n").split("\n").length;
    const newLinesCount = currentContent.split("\n").length;
    const diffRes = generateUnifiedDiff(originalContent.replace(/\r\n/g, "\n"), currentContent, path.basename(rawPath));

    return {
        status: "success",
        path: rawPath,
        resolved_path: targetPath,
        chunks_applied: chunks.length,
        lines_before: oldLinesCount,
        lines_after: newLinesCount,
        lines_diff: newLinesCount - oldLinesCount,
        lines_added: diffRes.additions,
        lines_removed: diffRes.deletions,
        bytes_written: Buffer.byteLength(finalContent, "utf-8"),
        instruction: args.instruction || args.Instruction || null,
        description: args.description || args.Description || null,
        diff: diffRes.diff,
        message: `Successfully applied ${chunks.length} replacement chunks in ${rawPath}`
    };
}

async function handleWriteFile(args, chatId, { resolveSafePath }) {
    const rawPath = args.path || args.Path || args.FilePath || args.filePath;
    if (!rawPath) {
        throw new Error("Missing 'path' parameter for write_file.");
    }
    const rawContent = args.content !== undefined ? args.content : (args.Content !== undefined ? args.Content : null);
    if (rawContent === undefined || rawContent === null) {
        throw new Error("Missing 'content' parameter for write_file.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    const parentDir = path.dirname(targetPath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    let existingContent = null;
    let isOverwrite = false;
    if (fs.existsSync(targetPath)) {
        try {
            existingContent = await fs.promises.readFile(targetPath, "utf-8");
            isOverwrite = true;
        } catch {}
    }

    const contentStr = String(rawContent);
    const wsInfo = getWorkspaceForFile(targetPath, chatId);
    if (wsInfo && wsInfo.relativePath && isOverwrite) {
        try { shadowGit.recordPreEditBaseline(wsInfo.workspaceRoot, wsInfo.relativePath, { chatId, isNew: !isOverwrite }); } catch (_) {}
    }

    await fs.promises.writeFile(targetPath, contentStr, "utf-8");

    if (wsInfo && wsInfo.relativePath) {
        try {
            shadowGit.recordPostEditCommit(wsInfo.workspaceRoot, wsInfo.relativePath, {
                chatId,
                tool: "write_file",
                instruction: isOverwrite ? "Overwrote file" : "Created new file"
            });
        } catch (_) {}
    }

    const lineCount = contentStr.split("\n").length;
    const byteCount = Buffer.byteLength(contentStr, "utf-8");

    let diff = null;
    let linesAdded = lineCount;
    let linesRemoved = 0;

    if (isOverwrite && existingContent !== null) {
        const diffRes = generateUnifiedDiff(existingContent.replace(/\r\n/g, "\n"), contentStr.replace(/\r\n/g, "\n"), path.basename(rawPath));
        diff = diffRes.diff;
        linesAdded = diffRes.additions;
        linesRemoved = diffRes.deletions;
    }

    const isArtifact = isArtifactPath(rawPath, targetPath, chatId);
    const rawMeta = args.ArtifactMetadata || args.artifact_metadata || args.artifactMetadata || null;
    let artifactMetadata = null;
    if (isArtifact) {
        const record = await recordArtifactInCatalog({
            rawPath,
            resolvedPath: targetPath,
            chatId,
            metadata: rawMeta,
            content: contentStr
        });
        if (record) {
            artifactMetadata = record;
        }
    }

    const result = {
        path: rawPath,
        resolved_path: targetPath,
        bytes_written: byteCount,
        line_count: lineCount,
        lines_added: linesAdded,
        lines_removed: linesRemoved,
        is_overwrite: isOverwrite,
        diff,
        status: "success",
        message: `Successfully wrote ${byteCount} bytes (${lineCount} lines) to ${rawPath}`
    };

    if (isArtifact) {
        result.is_artifact = true;
        result.artifact_metadata = artifactMetadata || rawMeta || { UserFacing: true, Summary: path.basename(targetPath), RequestFeedback: false };
    }

    return result;
}

async function handleListDir(args, chatId, { resolveSafePath }) {
    const rawPath = args.DirectoryPath || args.path || args.dir_path || args.dirPath || ".";
    if (!rawPath) {
        throw new Error("Missing required parameter 'DirectoryPath'.");
    }

    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Directory not found: ${rawPath}`);
    }

    const stat = await fs.promises.stat(targetPath);
    if (!stat.isDirectory()) {
        throw new Error(`Path '${rawPath}' is a file, not a directory. Use the 'read_file' tool to view file contents.`);
    }

    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });

    // Sort directories first, then alphabetical
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    let subDirCount = 0;
    let fileCount = 0;
    const formattedEntries = [];
    const jsonLines = [];

    for (const entry of entries) {
        const fullChildPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            subDirCount++;
            let childCount = 0;
            try {
                const subChildren = fs.readdirSync(fullChildPath);
                childCount = subChildren.length;
            } catch (_) {}

            formattedEntries.push({
                name: entry.name,
                isDir: true,
                children: childCount
            });
            jsonLines.push(JSON.stringify({
                name: entry.name,
                isDir: true,
                children: childCount
            }));
        } else {
            fileCount++;
            let size = 0;
            try {
                const s = fs.statSync(fullChildPath);
                size = s.size;
            } catch (_) {}

            formattedEntries.push({
                name: entry.name,
                sizeBytes: String(size)
            });
            jsonLines.push(JSON.stringify({
                name: entry.name,
                sizeBytes: String(size)
            }));
        }
    }

    const summary = `Summary: This directory contains ${subDirCount} subdirectories and ${fileCount} files.`;
    const output = jsonLines.length > 0 ? `${jsonLines.join("\n")}\n\n${summary}` : summary;

    return {
        path: rawPath,
        resolved_path: targetPath,
        entries: formattedEntries,
        subdirectories: subDirCount,
        files: fileCount,
        output
    };
}

async function handleFindFiles(args, chatId, { resolveSafePath }) {
    const rawPath = args.DirectoryPath || args.path || args.dir_path || ".";
    const query = (args.query || args.pattern || "").trim().toLowerCase();
    const targetPath = resolveSafePath(rawPath, chatId);
    if (!fs.existsSync(targetPath)) {
        return { results: [], total: 0 };
    }

    const stat = await fs.promises.stat(targetPath);
    if (!stat.isDirectory()) {
        return { results: [], total: 0 };
    }

    const IGNORE_DIRS = new Set([
        "node_modules", ".git", ".gemini", ".next", "dist", "build", ".cache", ".turbo", ".svelte-kit", ".backups", ".MultiAI", ".history"
    ]);

    const results = [];
    const MAX_RESULTS = 120;

    async function walk(currentDir, relDir) {
        if (results.length >= MAX_RESULTS) return;
        let entries;
        try {
            entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch (_) {
            return;
        }

        // Sort: dirs first, then alphabetical
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break;
            const fullRel = relDir ? `${relDir}/${entry.name}` : entry.name;
            const isDir = entry.isDirectory();

            if (isDir) {
                if (IGNORE_DIRS.has(entry.name)) continue;
                const matches = !query || entry.name.toLowerCase().includes(query) || fullRel.toLowerCase().includes(query);
                if (matches) {
                    results.push({ name: entry.name, path: fullRel, isDir: true });
                }
                await walk(path.join(currentDir, entry.name), fullRel);
            } else {
                const matches = !query || entry.name.toLowerCase().includes(query) || fullRel.toLowerCase().includes(query);
                if (matches) {
                    results.push({ name: entry.name, path: fullRel, isDir: false });
                }
            }
        }
    }

    await walk(targetPath, "");
    return { results, total: results.length };
}

module.exports = {
    handleCodeGrep,
    handleSearchAndReplace: handleReplaceFileContent,
    handleReplaceFileContent,
    handleMultiReplaceFileContent,
    handleWriteFile,
    handleListDir,
    handleFindFiles
};
