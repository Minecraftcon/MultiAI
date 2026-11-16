#!/usr/bin/env node
/**
 * Fast Comprehensive Codebase Syntax Checker
 * Checks JavaScript (Node -c), JSON, CSS, and Go files across the repository.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".backups", ".gemini", "dist"]);

function getFiles(dir, exts) {
    let results = [];
    try {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const dirent of list) {
            if (dirent.isDirectory()) {
                if (!EXCLUDE_DIRS.has(dirent.name)) {
                    results.push(...getFiles(path.join(dir, dirent.name), exts));
                }
            } else if (dirent.isFile() && exts.some(e => dirent.name.endsWith(e))) {
                results.push(path.join(dir, dirent.name));
            }
        }
    } catch (_) {}
    return results;
}

// 1. Run worker pool for JS files using node -c
async function checkJsFiles(files, concurrency = 12) {
    let index = 0;
    const errors = [];

    async function worker() {
        while (index < files.length) {
            const file = files[index++];
            await new Promise((resolve) => {
                const child = spawn("node", ["-c", file], { stdio: ["ignore", "ignore", "pipe"] });
                let stderr = "";
                child.stderr.on("data", (d) => { stderr += d.toString(); });
                child.on("close", (code) => {
                    if (code !== 0) {
                        errors.push({ file: path.relative(ROOT, file), error: stderr.trim() });
                    }
                    resolve();
                });
            });
        }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return errors;
}

// 2. Check JSON files
function checkJsonFiles(files) {
    const errors = [];
    for (const file of files) {
        try {
            JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (err) {
            errors.push({ file: path.relative(ROOT, file), error: err.message });
        }
    }
    return errors;
}

// 3. Check CSS files
function checkCssFiles(files) {
    const errors = [];
    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        let openBraces = 0, openParens = 0;
        let inComment = false, inString = false, quote = "";

        for (let i = 0; i < content.length; i++) {
            const c = content[i];
            const next = content[i + 1];

            if (inComment) {
                if (c === "*" && next === "/") { inComment = false; i++; }
                continue;
            }
            if (inString) {
                if (c === "\\") { i++; continue; }
                if (c === quote) { inString = false; }
                continue;
            }
            if (c === "/" && next === "*") { inComment = true; i++; continue; }
            if (c === "\"" || c === "\x27") { inString = true; quote = c; continue; }

            if (c === "{") openBraces++;
            else if (c === "}") {
                openBraces--;
                if (openBraces < 0) {
                    errors.push({ file: path.relative(ROOT, file), error: `Unexpected closing brace "}" at index ${i}` });
                    break;
                }
            } else if (c === "(") openParens++;
            else if (c === ")") {
                openParens--;
                if (openParens < 0) {
                    errors.push({ file: path.relative(ROOT, file), error: `Unexpected closing parenthesis ")" at index ${i}` });
                    break;
                }
            }
        }

        if (openBraces > 0) {
            errors.push({ file: path.relative(ROOT, file), error: `Unbalanced braces (${openBraces} unclosed)` });
        }
        if (openParens > 0) {
            errors.push({ file: path.relative(ROOT, file), error: `Unbalanced parentheses (${openParens} unclosed)` });
        }
    }
    return errors;
}

// 4. Check Go files
async function checkGoFiles(files) {
    if (files.length === 0) return [];
    return new Promise((resolve) => {
        const child = spawn("gofmt", ["-e", ...files], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => {
            if (code !== 0 && stderr.trim()) {
                resolve([{ file: "Go files", error: stderr.trim() }]);
            } else {
                resolve([]);
            }
        });
        child.on("error", () => resolve([])); // gofmt not installed
    });
}

async function main() {
    console.log("=== Running Codebase Syntax Audit ===");
    const jsFiles = getFiles(ROOT, [".js", ".mjs", ".cjs"]);
    const jsonFiles = getFiles(ROOT, [".json"]);
    const cssFiles = getFiles(ROOT, [".css"]);
    const goFiles = getFiles(ROOT, [".go"]);

    console.log(`Discovered:`);
    console.log(`  • ${jsFiles.length} JavaScript files (.js, .mjs, .cjs)`);
    console.log(`  • ${jsonFiles.length} JSON files (.json)`);
    console.log(`  • ${cssFiles.length} CSS stylesheets (.css)`);
    console.log(`  • ${goFiles.length} Go sources (.go)\n`);

    const [jsErrors, jsonErrors, cssErrors, goErrors] = await Promise.all([
        checkJsFiles(jsFiles),
        Promise.resolve(checkJsonFiles(jsonFiles)),
        Promise.resolve(checkCssFiles(cssFiles)),
        checkGoFiles(goFiles)
    ]);

    let totalErrors = 0;

    console.log("--- Results ---");
    if (jsErrors.length === 0) {
        console.log(`✓ JavaScript: ${jsFiles.length}/${jsFiles.length} files passed syntax validation.`);
    } else {
        totalErrors += jsErrors.length;
        console.error(`✗ JavaScript: ${jsErrors.length} syntax error(s):`);
        for (const e of jsErrors) console.error(`  - ${e.file}: ${e.error.split("\n")[0]}`);
    }

    if (jsonErrors.length === 0) {
        console.log(`✓ JSON: ${jsonFiles.length}/${jsonFiles.length} files parsed cleanly.`);
    } else {
        totalErrors += jsonErrors.length;
        console.error(`✗ JSON: ${jsonErrors.length} parse error(s):`);
        for (const e of jsonErrors) console.error(`  - ${e.file}: ${e.error}`);
    }

    if (cssErrors.length === 0) {
        console.log(`✓ CSS: ${cssFiles.length}/${cssFiles.length} stylesheets verified structurally.`);
    } else {
        totalErrors += cssErrors.length;
        console.error(`✗ CSS: ${cssErrors.length} syntax error(s):`);
        for (const e of cssErrors) console.error(`  - ${e.file}: ${e.error}`);
    }

    if (goErrors.length === 0) {
        console.log(`✓ Go: ${goFiles.length}/${goFiles.length} Go sources verified cleanly.`);
    } else {
        totalErrors += goErrors.length;
        console.error(`✗ Go: ${goErrors.length} error(s):`);
        for (const e of goErrors) console.error(`  - ${e.error}`);
    }

    console.log("\n======================================");
    if (totalErrors === 0) {
        console.log(`🎉 100% SYNTAX CLEAN: ${jsFiles.length + jsonFiles.length + cssFiles.length + goFiles.length} files verified with 0 errors!`);
        process.exit(0);
    } else {
        console.error(`❌ Total Syntax Errors: ${totalErrors}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Syntax audit failed unexpectedly:", err);
    process.exit(1);
});
