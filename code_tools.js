/**
 * code_tools.js
 * =============
 * Modular Code & Filesystem Tool Engine for MultiAI.
 * 
 * Contains:
 * - handleCodeGrep (Tier 1 Ripgrep -> Tier 2 Python fast scan -> Tier 3 Node scan)
 * - handleSearchAndReplace (4-stage cascade, atomic write, syntax check, safe line splicing)
 * - handleWriteFile (write, replace, inject, batch operations)
 * - spliceLines (non-destructive line assembly preserving blank lines)
 * - validateSyntax (child_process.execFile for JS, JSON, and Python)
 */

const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

// ---------------------------------------------------------
// Helper: Safe Line Splicer (preserves all empty lines)
// ---------------------------------------------------------
function spliceLines(lines, s, e, replacementText) {
    if (s < 0) s = 0;
    if (e > lines.length) e = lines.length;
    if (s > e) {
        throw new Error(`Invalid line bounds: start_line (${s + 1}) must be <= end_line (${e})`);
    }
    // Split replacement into lines and splice into the array — avoids double-newline
    // artifacts at join boundaries caused by string concatenation.
    const replLines = replacementText.split("\n");
    const result = [...lines.slice(0, s), ...replLines, ...lines.slice(e)];
    return result.join("\n");
}

// ---------------------------------------------------------
// Helper: Atomic File Writer
// ---------------------------------------------------------
async function writeAtomic(filePath, text) {
    const tmpPath = filePath + ".tmp." + Math.random().toString(36).substring(2, 9);
    await fs.promises.writeFile(tmpPath, text, "utf-8");
    await fs.promises.rename(tmpPath, filePath);
}

// ---------------------------------------------------------
// Helper: Post-Write Syntax Validation
// ---------------------------------------------------------
async function validateSyntax(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if ([".js", ".mjs", ".cjs"].includes(ext)) {
            await new Promise((resolve, reject) => {
                execFile("node", ["-c", filePath], (err, stdout, stderr) => {
                    if (err) return reject(new Error(stderr || err.message));
                    resolve();
                });
            });
            return { valid: true };
        }
        if (ext === ".json") {
            const raw = await fs.promises.readFile(filePath, "utf-8");
            JSON.parse(raw);
            return { valid: true };
        }
        if (ext === ".py") {
            await new Promise((resolve, reject) => {
                execFile("python3", ["-m", "py_compile", filePath], (err, stdout, stderr) => {
                    if (err) return reject(new Error(stderr || err.message));
                    resolve();
                });
            });
            return { valid: true };
        }
    } catch (e) {
        return { valid: false, error: e.message };
    }
    return { valid: true };
}

// ---------------------------------------------------------
// File Writing / Mutation Handler
// ---------------------------------------------------------
async function handleWriteFile(args, chatId, { resolveSafePath }) {
    const targetPath = resolveSafePath(args.path, chatId);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
    const isScratch = targetPath.includes(path.sep + "scratch" + path.sep) || targetPath.endsWith(path.sep + "scratch");

    let action = args.action;
    if (!action) {
        if (Array.isArray(args.operations)) action = "batch";
        else if (args.target !== undefined || args.old_string !== undefined || args.old_text !== undefined) action = "replace";
        else if (args.line !== undefined) action = "inject";
        else action = "write";
    }

    if (action === "write") {
        if (fs.existsSync(targetPath) && args.overwrite === false) {
            throw new Error(`File already exists: ${args.path} and overwrite is false`);
        }
        const textToWrite = args.content ?? "";
        await writeAtomic(targetPath, textToWrite);
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            is_scratch: isScratch,
            action: "write",
            bytes_written: Buffer.byteLength(textToWrite),
            status: "success",
            message: isScratch
                ? `Successfully wrote file to conversation scratch directory: ${args.path}`
                : `Successfully wrote file: ${args.path}`
        };
    }

    if (action === "replace") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for replace: ${args.path}`);
        }
        const current = await fs.promises.readFile(targetPath, "utf-8");
        const target = args.target !== undefined ? args.target : (args.old_string !== undefined ? args.old_string : args.old_text);
        if (target === undefined || target === null || target === "") {
            throw new Error("Missing 'target' string to replace");
        }
        const replacement = args.replacement !== undefined ? args.replacement : (args.new_string !== undefined ? args.new_string : (args.new_text ?? ""));

        if (args.start_line !== undefined || args.end_line !== undefined) {
            const lines = current.split("\n");
            const s = Math.max(1, parseInt(args.start_line, 10) || 1) - 1;
            const e = args.end_line ? Math.min(lines.length, parseInt(args.end_line, 10)) : lines.length;
            const chunk = lines.slice(s, e).join("\n");
            const count = chunk.split(target).length - 1;
            if (count === 0) {
                throw new Error(`Target string not found within lines ${s + 1}-${e} of ${args.path}.`);
            }
            if (count > 1 && !args.all) {
                throw new Error(`Found ${count} occurrences of target string within lines ${s + 1}-${e} of ${args.path}. Specify 'all: true' or provide more context.`);
            }
            const replacedChunk = args.all ? chunk.replaceAll(target, replacement) : chunk.replace(target, replacement);
            const newContent = spliceLines(lines, s, e, replacedChunk);
            await writeAtomic(targetPath, newContent);
            return {
                success: true,
                path: args.path,
                resolved_path: targetPath,
                action: "replace",
                matches: count,
                occurrences_replaced: args.all ? count : 1,
                status: "success",
                message: `Successfully replaced text in ${args.path} (lines ${s + 1}-${e})`
            };
        } else {
            const count = current.split(target).length - 1;
            if (count === 0) {
                throw new Error(`Target string not found in ${args.path}. Please verify the exact text to replace.`);
            }
            if (count > 1 && !args.all) {
                throw new Error(`Found ${count} occurrences of target string in ${args.path}. Specify 'all: true' or provide more surrounding context to make the match unique.`);
            }
            const newContent = args.all ? current.replaceAll(target, replacement) : current.replace(target, replacement);
            await writeAtomic(targetPath, newContent);
            return {
                success: true,
                path: args.path,
                resolved_path: targetPath,
                action: "replace",
                matches: count,
                occurrences_replaced: args.all ? count : 1,
                status: "success",
                message: `Successfully replaced ${args.all ? count : 1} occurrence(s) in ${args.path}`
            };
        }
    }

    if (action === "inject") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for line injection: ${args.path}`);
        }
        const current = await fs.promises.readFile(targetPath, "utf-8");
        const lines = current.split("\n");
        const targetLine = parseInt(args.line, 10);
        const injectContent = String(args.content ?? "");

        if (targetLine === -1 || isNaN(targetLine) || targetLine > lines.length) {
            lines.push(injectContent); // append
        } else if (targetLine <= 1) {
            lines.unshift(injectContent); // prepend (line:0 and line:1 both prepend)
        } else {
            lines.splice(targetLine, 0, injectContent);
        }
        await writeAtomic(targetPath, lines.join("\n"));
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "inject",
            line_injected: targetLine,
            status: "success",
            message: `Successfully injected content at line ${targetLine} in ${args.path}`
        };
    }

    if (action === "batch") {
        if (!fs.existsSync(targetPath)) {
            throw new Error(`File not found for batch operations: ${args.path}`);
        }
        const ops = Array.isArray(args.operations) ? args.operations : [];
        if (ops.length === 0) {
            throw new Error("No operations provided for batch action");
        }
        let current = await fs.promises.readFile(targetPath, "utf-8");

        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const opAction = op.action || (op.target !== undefined || op.old_string !== undefined || op.old_text !== undefined ? "replace" : (op.line !== undefined ? "inject" : "write"));

            if (opAction === "replace") {
                const target = op.target !== undefined ? op.target : (op.old_string !== undefined ? op.old_string : op.old_text);
                if (target === undefined || target === null) throw new Error(`Batch operation #${i + 1}: Missing 'target' string`);
                const replacement = op.replacement !== undefined ? op.replacement : (op.new_string !== undefined ? op.new_string : (op.new_text ?? ""));
                const count = current.split(target).length - 1;
                if (count === 0) throw new Error(`Batch operation #${i + 1}: Target string not found in ${args.path}`);
                if (count > 1 && !op.all) throw new Error(`Batch operation #${i + 1}: Found ${count} occurrences of target string in ${args.path}. Specify 'all: true' or provide more surrounding context.`);
                current = op.all ? current.replaceAll(target, replacement) : current.replace(target, replacement);
            } else if (opAction === "inject") {
                const lines = current.split("\n");
                const targetLine = parseInt(op.line, 10);
                const injectContent = String(op.content ?? "");
                if (targetLine === -1 || isNaN(targetLine) || targetLine > lines.length) {
                    lines.push(injectContent); // append
                } else if (targetLine <= 1) {
                    lines.unshift(injectContent); // prepend
                } else {
                    lines.splice(targetLine, 0, injectContent);
                }
                current = lines.join("\n");
            } else if (opAction === "write") {
                current = op.content ?? "";
            } else {
                throw new Error(`Batch operation #${i + 1}: Unsupported action '${opAction}'`);
            }
        }

        await writeAtomic(targetPath, current);
        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "batch",
            operations_applied: ops.length,
            status: "success",
            message: `Successfully applied ${ops.length} batch operations to ${args.path}`
        };
    }

    throw new Error(`Unknown action: '${action}' for write_file`);
}

// ---------------------------------------------------------
// Grep Scanner: Ripgrep Process Engine
// ---------------------------------------------------------
function runRipgrep({ searchPath, query, isRegex, caseSensitive, include, filesOnly, maxResults }) {
    return new Promise((resolve, reject) => {
        const args = ["--color=never", "--no-heading", "--max-columns=500"];
        if (!caseSensitive) args.push("-i");
        if (!isRegex) args.push("-F");
        if (filesOnly) {
            args.push("-l");
        } else {
            args.push("-n");
            args.push("--with-filename");
        }

        if (include) {
            const globs = include.split(",").map(s => s.trim()).filter(Boolean);
            for (const g of globs) {
                args.push("-g", g);
            }
        }

        args.push("-g", "!.git/**");
        args.push("-g", "!node_modules/**");
        args.push("-g", "!dist/**");
        args.push("-g", "!.venv/**");

        args.push("-e", query);
        args.push(searchPath);

        const startTime = Date.now();
        const proc = spawn("rg", args);
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", data => { stdout += data; });
        proc.stderr.on("data", data => { stderr += data; });

        proc.on("error", err => {
            reject(err);
        });

        proc.on("close", code => {
            if (code === 0 || code === 1) {
                const elapsed = Date.now() - startTime;
                const rawLines = stdout.trim().split("\n").filter(Boolean);
                if (filesOnly) {
                    const files = rawLines.slice(0, maxResults).map(f => {
                        return path.relative(searchPath === "." ? process.cwd() : searchPath, f) || f;
                    });
                    return resolve({
                        engine_used: "ripgrep",
                        elapsed_ms: elapsed,
                        query,
                        is_regex: isRegex,
                        case_sensitive: caseSensitive,
                        total_files: files.length,
                        files
                    });
                }

                const matches = [];
                for (const line of rawLines) {
                    if (matches.length >= maxResults) break;
                    // Robust parser supporting Windows (C:\path:line:...) and Unix (/path:line:...)
                    const match = line.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):(.*)$/);
                    if (!match) continue;

                    const filePath = match[1];
                    const lineNum = parseInt(match[2], 10);
                    let lineContent = match[3];
                    if (lineContent.length > 500) {
                        lineContent = lineContent.slice(0, 500) + "…";
                    }

                    const relPath = path.relative(searchPath === "." ? process.cwd() : searchPath, filePath) || filePath;
                    matches.push({
                        file: relPath,
                        line_number: lineNum,
                        line_content: lineContent
                    });
                }

                return resolve({
                    engine_used: "ripgrep",
                    elapsed_ms: elapsed,
                    query,
                    is_regex: isRegex,
                    case_sensitive: caseSensitive,
                    total_matches: matches.length,
                    matches
                });
            } else {
                reject(new Error(stderr || `ripgrep process exited with code ${code}`));
            }
        });
    });
}

// ---------------------------------------------------------
// Grep Scanner: Pure Node.js Recursive Scanner (Tier 3)
// ---------------------------------------------------------
async function nodeGrepScan({ searchPath, query, isRegex, caseSensitive, include, filesOnly, maxResults }) {
    const ignoreDirs = new Set([".git", "node_modules", "dist", ".venv", "venv", "__pycache__", ".mitm", ".idea", ".vscode"]);
    let regex;
    try {
        const flags = caseSensitive ? "g" : "gi";
        const pat = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(pat, flags);
    } catch (e) {
        throw new Error(`Invalid regular expression: ${e.message}`);
    }

    const globs = include ? include.split(",").map(s => s.trim()).filter(Boolean) : [];
    function matchGlobs(fname, fullPath) {
        if (globs.length === 0) return true;
        return globs.some(g => {
            try {
                const escaped = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
                const re = new RegExp(`^${escaped}$`, "i");
                return re.test(fname) || re.test(fullPath);
            } catch (_) {
                return false;
            }
        });
    }

    const matches = [];
    const filesMatched = [];
    let filesScanned = 0;
    const startTime = Date.now();

    async function walk(currentPath) {
        if (matches.length >= maxResults || (filesOnly && filesMatched.length >= maxResults)) return;

        let entries;
        try {
            entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            if (matches.length >= maxResults || (filesOnly && filesMatched.length >= maxResults)) break;

            const full = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (ignoreDirs.has(entry.name) || entry.name.startsWith(".")) continue;
                await walk(full);
            } else if (entry.isFile()) {
                if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
                if (!matchGlobs(entry.name, full)) continue;

                try {
                    const st = await fs.promises.stat(full);
                    if (st.size > 5 * 1024 * 1024) continue;

                    const fd = await fs.promises.open(full, "r");
                    const buf = Buffer.alloc(512);
                    const { bytesRead } = await fd.read(buf, 0, 512, 0);
                    await fd.close();
                    if (buf.subarray(0, bytesRead).includes(0)) continue;

                    filesScanned++;
                    const content = await fs.promises.readFile(full, "utf-8");
                    const relPath = path.relative(searchPath === "." ? process.cwd() : searchPath, full) || full;

                    if (filesOnly) {
                        regex.lastIndex = 0;
                        if (regex.test(content)) {
                            filesMatched.push(relPath);
                        }
                    } else {
                        const lines = content.split("\n");
                        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                            const line = lines[lineIdx];
                            regex.lastIndex = 0;
                            if (regex.test(line)) {
                                let displayLine = line;
                                if (displayLine.length > 500) {
                                    displayLine = displayLine.slice(0, 500) + "…";
                                }
                                matches.push({
                                    file: relPath,
                                    line_number: lineIdx + 1,
                                    line_content: displayLine
                                });
                                if (matches.length >= maxResults) break;
                            }
                        }
                    }
                } catch (_) {}
            }
        }
    }

    const stat = await fs.promises.stat(searchPath);
    if (stat.isFile()) {
        const full = path.resolve(searchPath);
        const content = await fs.promises.readFile(full, "utf-8");
        const relPath = path.basename(full);
        if (filesOnly) {
            if (regex.test(content)) filesMatched.push(relPath);
        } else {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    let displayLine = lines[i];
                    if (displayLine.length > 500) displayLine = displayLine.slice(0, 500) + "…";
                    matches.push({ file: relPath, line_number: i + 1, line_content: displayLine });
                    if (matches.length >= maxResults) break;
                }
            }
        }
    } else {
        await walk(searchPath);
    }

    const elapsed = Date.now() - startTime;
    const res = {
        engine_used: "node_scanner",
        elapsed_ms: elapsed,
        files_scanned: filesScanned,
        query,
        is_regex: isRegex,
        case_sensitive: caseSensitive
    };

    if (filesOnly) {
        res.total_files = filesMatched.length;
        res.files = filesMatched;
    } else {
        res.total_matches = matches.length;
        res.matches = matches;
    }
    return res;
}

// ---------------------------------------------------------
// Grep Router: Tier 1 -> Tier 2 -> Tier 3
// ---------------------------------------------------------
async function handleCodeGrep(args, chatId, { resolveSafePath, postJSON }) {
    const rawPath = args.path || ".";
    const searchPath = resolveSafePath(rawPath, chatId);
    const query = args.query;
    if (!query || typeof query !== "string") {
        throw new Error("Parameter 'query' is required");
    }

    const isRegex = Boolean(args.is_regex !== undefined ? args.is_regex : args.isRegex);
    const caseSensitive = Boolean(args.case_sensitive !== undefined ? args.case_sensitive : args.caseSensitive);
    const filesOnly = Boolean(args.files_only !== undefined ? args.files_only : args.filesOnly);
    const include = args.include || args.glob || null;
    const maxResults = Math.min(100, Math.max(1, parseInt(args.max_results, 10) || 50));

    if (!fs.existsSync(searchPath)) {
        throw new Error(`Path not found: ${rawPath}`);
    }

    const scanOpts = { searchPath, query, isRegex, caseSensitive, include, filesOnly, maxResults };

    const executeScan = async (opts) => {
        // Tier 1: Try system ripgrep
        try {
            return await runRipgrep(opts);
        } catch (_) {}

        // Tier 2: Try Python fast scanner at port 5000
        try {
            const pyResult = await postJSON(5000, "/api/code/grep", {
                path: opts.searchPath,
                query: opts.query,
                is_regex: opts.isRegex,
                case_sensitive: opts.caseSensitive,
                include: opts.include,
                files_only: opts.filesOnly,
                max_results: opts.maxResults
            }, 10000);
            return pyResult;
        } catch (_) {}

        // Tier 3: Pure in-process Node.js recursive scanner
        return await nodeGrepScan(opts);
    };

    const result = await executeScan(scanOpts);

    // Auto-regex fallback: if 0 literal matches found but query contains regex syntax, try regex
    const hasZeroMatches = (result.matches && result.matches.length === 0) || (result.files && result.files.length === 0);
    if (!isRegex && hasZeroMatches && /[|]|\.\*|\.\+|\^\w|\w\$/.test(query)) {
        try {
            new RegExp(query);
            const regexResult = await executeScan({ ...scanOpts, isRegex: true });
            const hasRegexMatches = (regexResult.matches && regexResult.matches.length > 0) || (regexResult.files && regexResult.files.length > 0);
            if (hasRegexMatches) {
                regexResult.note = "0 literal matches found, but regex syntax was detected in query. Automatically matched as regular expression.";
                return regexResult;
            }
        } catch (_) {}
    }

    return result;
}

// ---------------------------------------------------------
// Fuzzy Matching & Indentation-Tolerant Replacement Engine
// ---------------------------------------------------------
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;
    const s1 = str1.replace(/\s+/g, " ").trim();
    const s2 = str2.replace(/\s+/g, " ").trim();
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1.0 : 0.0;

    const getBigrams = (str) => {
        const bigrams = new Map();
        for (let i = 0; i < str.length - 1; i++) {
            const gram = str.substring(i, i + 2);
            bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
        }
        return bigrams;
    };

    const b1 = getBigrams(s1);
    const b2 = getBigrams(s2);
    let intersection = 0;
    for (const [gram, count1] of b1.entries()) {
        if (b2.has(gram)) {
            intersection += Math.min(count1, b2.get(gram));
        }
    }
    const totalBigrams = (s1.length - 1) + (s2.length - 1);
    return totalBigrams > 0 ? (2.0 * intersection) / totalBigrams : 0.0;
}

function performCascadeReplace(sourceText, target, replacement, allowMultiple = false, lineOffset = 0, filePath = "") {
    const isCRLF = sourceText.includes("\r\n");

    // Stage 1: Exact Match (Fast Path)
    const exactMatches = [];
    let idx = 0;
    while ((idx = sourceText.indexOf(target, idx)) !== -1) {
        exactMatches.push(idx);
        idx += target.length;
    }

    if (exactMatches.length > 0) {
        if (exactMatches.length > 1 && !allowMultiple) {
            const lineNumbers = exactMatches.map(pos => lineOffset + sourceText.substring(0, pos).split("\n").length);
            throw new Error(`Found ${exactMatches.length} exact occurrences of target text in ${filePath || "file"} at line(s): ${lineNumbers.join(", ")}. Specify 'allow_multiple: true' to replace all occurrences, or include more surrounding context.`);
        }
        const newContent = allowMultiple ? sourceText.replaceAll(target, replacement) : sourceText.replace(target, replacement);
        return {
            newContent,
            matches: exactMatches.length,
            stage: "exact",
            matchedLines: exactMatches.map(pos => lineOffset + sourceText.substring(0, pos).split("\n").length)
        };
    }

    // Stage 2: Line-Ending Normalization (CRLF vs LF)
    const normSource = sourceText.replace(/\r\n/g, "\n");
    const normTarget = target.replace(/\r\n/g, "\n");
    const normRepl = replacement.replace(/\r\n/g, "\n");

    const leMatches = [];
    idx = 0;
    while ((idx = normSource.indexOf(normTarget, idx)) !== -1) {
        leMatches.push(idx);
        idx += normTarget.length;
    }

    if (leMatches.length > 0) {
        if (leMatches.length > 1 && !allowMultiple) {
            const lineNumbers = leMatches.map(pos => lineOffset + normSource.substring(0, pos).split("\n").length);
            throw new Error(`Found ${leMatches.length} occurrences (matched via line-ending normalization) in ${filePath || "file"} at line(s): ${lineNumbers.join(", ")}. Specify 'allow_multiple: true' to replace all.`);
        }
        let replacedNorm = allowMultiple ? normSource.replaceAll(normTarget, normRepl) : normSource.replace(normTarget, normRepl);
        if (isCRLF) replacedNorm = replacedNorm.replace(/\n/g, "\r\n");
        return {
            newContent: replacedNorm,
            matches: leMatches.length,
            stage: "line_endings",
            note: "Matched via line-ending normalization (CRLF/LF)",
            matchedLines: leMatches.map(pos => lineOffset + normSource.substring(0, pos).split("\n").length)
        };
    }

    // Stage 3: Whitespace & Relative Indentation Normalization
    const fileLines = normSource.split("\n");
    const targetLines = normTarget.split("\n");
    const replLines = normRepl.split("\n");

    if (normTarget.trim().length > 0 && targetLines.length > 0 && targetLines.length <= fileLines.length) {
        const indentMatches = [];
        const tLen = targetLines.length;

        for (let i = 0; i <= fileLines.length - tLen; i++) {
            let matches = true;
            for (let j = 0; j < tLen; j++) {
                if (fileLines[i + j].trim() !== targetLines[j].trim()) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                indentMatches.push(i);
            }
        }

        if (indentMatches.length > 0) {
            if (indentMatches.length > 1 && !allowMultiple) {
                const lineNumbers = indentMatches.map(i => lineOffset + i + 1);
                throw new Error(`Found ${indentMatches.length} occurrences matching trimmed code lines in ${filePath || "file"} at line(s): ${lineNumbers.join(", ")}. Include more surrounding context or specify 'allow_multiple: true'.`);
            }

            const adaptReplacement = (matchLineIndex) => {
                const fileBaseIndent = (fileLines[matchLineIndex].match(/^\s*/) || [""])[0];
                const targetBaseIndent = (targetLines[0].match(/^\s*/) || [""])[0];

                return replLines.map(line => {
                    if (!line.trim()) return "";
                    if (line.startsWith(targetBaseIndent)) {
                        return fileBaseIndent + line.slice(targetBaseIndent.length);
                    }
                    const lineIndent = (line.match(/^\s*/) || [""])[0];
                    const relDelta = lineIndent.length - targetBaseIndent.length;
                    const newIndentLen = Math.max(0, fileBaseIndent.length + relDelta);
                    return " ".repeat(newIndentLen) + line.trimStart();
                });
            };

            const reversedMatches = [...indentMatches].reverse();
            let modifiedLines = [...fileLines];
            for (const mIdx of reversedMatches) {
                const adaptedRepl = adaptReplacement(mIdx);
                modifiedLines.splice(mIdx, tLen, ...adaptedRepl);
                if (!allowMultiple) break;
            }

            let resultText = modifiedLines.join("\n");
            if (isCRLF) resultText = resultText.replace(/\n/g, "\r\n");

            return {
                newContent: resultText,
                matches: indentMatches.length,
                stage: "indentation_tolerant",
                note: `Matched via relative indentation tolerance at line ${lineOffset + indentMatches[0] + 1}. Replacement was automatically re-indented to match file structure.`,
                matchedLines: indentMatches.map(i => lineOffset + i + 1)
            };
        }
    }

    // Stage 4: Fuzzy Similarity Matching
    if (normTarget.trim().length > 0 && targetLines.length > 0 && targetLines.length <= fileLines.length) {
        const tLen = targetLines.length;
        const candidates = [];
        const minThreshold = 0.85;

        for (let i = 0; i <= fileLines.length - tLen; i++) {
            const windowText = fileLines.slice(i, i + tLen).join("\n");
            const sim = calculateSimilarity(windowText, normTarget);
            if (sim >= minThreshold) {
                candidates.push({ index: i, similarity: sim, lineCount: tLen });
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.similarity - a.similarity);
            const best = candidates[0];

            if (candidates.length > 1) {
                const second = candidates.find(c => Math.abs(c.index - best.index) > 2);
                if (second && (best.similarity - second.similarity) < 0.12 && !allowMultiple) {
                    throw new Error(`Ambiguous fuzzy matches detected in ${filePath || "file"} at line ${lineOffset + best.index + 1} (${Math.round(best.similarity * 100)}%) and line ${lineOffset + second.index + 1} (${Math.round(second.similarity * 100)}%). Please provide more surrounding lines to uniquely identify the target.`);
                }
            }

            const fileBaseIndent = (fileLines[best.index].match(/^\s*/) || [""])[0];
            const targetBaseIndent = (targetLines[0].match(/^\s*/) || [""])[0];

            const adaptedRepl = replLines.map(line => {
                if (!line.trim()) return "";
                if (line.startsWith(targetBaseIndent)) {
                    return fileBaseIndent + line.slice(targetBaseIndent.length);
                }
                const lineIndent = (line.match(/^\s*/) || [""])[0];
                const relDelta = lineIndent.length - targetBaseIndent.length;
                const newIndentLen = Math.max(0, fileBaseIndent.length + relDelta);
                return " ".repeat(newIndentLen) + line.trimStart();
            });

            const modifiedLines = [...fileLines];
            modifiedLines.splice(best.index, best.lineCount, ...adaptedRepl);
            let resultText = modifiedLines.join("\n");
            if (isCRLF) resultText = resultText.replace(/\n/g, "\r\n");

            return {
                newContent: resultText,
                matches: 1,
                stage: "fuzzy",
                similarity: best.similarity,
                note: `Fuzzy matched block at line ${lineOffset + best.index + 1} with ${Math.round(best.similarity * 100)}% similarity. Replaced successfully.`,
                matchedLines: [lineOffset + best.index + 1]
            };
        }
    }

    // Stage 5: Intelligent Failure Diagnostics
    let bestNearScore = 0;
    let bestNearLine = 1;
    let bestNearSnippet = "";

    const tLen = Math.max(1, targetLines.length);
    for (let i = 0; i <= Math.max(0, fileLines.length - tLen); i++) {
        const windowText = fileLines.slice(i, i + tLen).join("\n");
        const sim = calculateSimilarity(windowText, normTarget);
        if (sim > bestNearScore) {
            bestNearScore = sim;
            bestNearLine = lineOffset + i + 1;
            bestNearSnippet = fileLines[i]?.trim() || "";
        }
    }

    const nearPercent = Math.round(bestNearScore * 100);
    const hint = bestNearScore >= 0.4
        ? ` Nearest potential match found around line ${bestNearLine} (${nearPercent}% similarity: "${bestNearSnippet.slice(0, 60)}…").`
        : "";

    throw new Error(`Target text not found in ${filePath || "file"}.${hint} Please verify exact code, characters, or line numbers.`);
}

// ---------------------------------------------------------
// Search and Replace Handler
// ---------------------------------------------------------
async function handleSearchAndReplace(args, chatId, { resolveSafePath }) {
    const targetPath = resolveSafePath(args.path, chatId);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`File not found: ${args.path}`);
    }

    const target = args.target !== undefined ? args.target : (args.old_string !== undefined ? args.old_string : args.old_text);
    if (target === undefined || target === null || target === "") {
        throw new Error("Missing 'old_string' or 'target' to replace");
    }

    const replacement = args.replacement !== undefined ? args.replacement : (args.new_string !== undefined ? args.new_string : (args.new_text ?? ""));
    const allowMultiple = Boolean(args.allow_multiple || args.all);

    const current = await fs.promises.readFile(targetPath, "utf-8");

    // Line scoping if start_line or end_line provided
    if (args.start_line !== undefined || args.end_line !== undefined) {
        const lines = current.split("\n");
        const s = Math.max(1, parseInt(args.start_line, 10) || 1) - 1;
        const e = args.end_line !== undefined ? Math.min(lines.length, parseInt(args.end_line, 10)) : lines.length;
        if (s >= e) {
            throw new Error(`Invalid line bounds: start_line (${s + 1}) must be <= end_line (${e})`);
        }
        const chunk = lines.slice(s, e).join("\n");

        const replaceRes = performCascadeReplace(chunk, target, replacement, allowMultiple, s, args.path);
        const newContent = spliceLines(lines, s, e, replaceRes.newContent);

        await writeAtomic(targetPath, newContent);
        const syntaxRes = await validateSyntax(targetPath);

        return {
            success: true,
            path: args.path,
            resolved_path: targetPath,
            action: "search_and_replace",
            matches: replaceRes.matches,
            stage: replaceRes.stage,
            occurrences_replaced: allowMultiple ? replaceRes.matches : 1,
            syntax_valid: syntaxRes.valid,
            syntax_warning: syntaxRes.valid ? undefined : syntaxRes.error,
            status: "success",
            message: replaceRes.note || `Successfully replaced ${allowMultiple ? replaceRes.matches : 1} occurrence(s) in ${args.path} (scoped to lines ${s + 1}-${e})`
        };
    }

    const replaceRes = performCascadeReplace(current, target, replacement, allowMultiple, 0, args.path);
    await writeAtomic(targetPath, replaceRes.newContent);
    const syntaxRes = await validateSyntax(targetPath);

    return {
        success: true,
        path: args.path,
        resolved_path: targetPath,
        action: "search_and_replace",
        matches: replaceRes.matches,
        stage: replaceRes.stage,
        occurrences_replaced: allowMultiple ? replaceRes.matches : 1,
        syntax_valid: syntaxRes.valid,
        syntax_warning: syntaxRes.valid ? undefined : syntaxRes.error,
        status: "success",
        message: replaceRes.note || `Successfully replaced ${allowMultiple ? replaceRes.matches : 1} occurrence(s) in ${args.path}`
    };
}

module.exports = {
    spliceLines,
    writeAtomic,
    validateSyntax,
    handleWriteFile,
    runRipgrep,
    nodeGrepScan,
    handleCodeGrep,
    calculateSimilarity,
    performCascadeReplace,
    handleSearchAndReplace
};
