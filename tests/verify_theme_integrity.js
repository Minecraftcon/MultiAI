/**
 * verify_theme_integrity.js
 *
 * Automated verification check for UI Theme and Right Panel Integrity.
 * Scans stylesheets in UI/webui/styles/ and source files in UI/webui/src/ for:
 * 1. Prohibited typefaces (Roboto, Inter, Open Sans).
 * 2. Missing global scrollbar rules in base.css / variables.css.
 * 3. Undefined CSS variables referenced via var(--...).
 * 4. Hardcoded hex colors (#fff, #123456, etc.) outside variables.css.
 * 5. Hardcoded rgb/rgba colors (rgb(...), rgba(...)) outside variables.css.
 * 6. Hardcoded inline styles in JavaScript components.
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const STYLES_DIR = path.join(ROOT_DIR, "UI", "webui", "styles");
const SRC_DIR = path.join(ROOT_DIR, "UI", "webui", "src");
const VARIABLES_CSS = path.join(STYLES_DIR, "variables.css");
const BASE_CSS = path.join(STYLES_DIR, "base.css");

// Prohibited fonts per project guidelines and user rules
const PROHIBITED_FONTS = ["Roboto", "Inter", "Open Sans"];

/**
 * Extracts all CSS variable definitions from variables.css
 */
function getDefinedCssVariables() {
    if (!fs.existsSync(VARIABLES_CSS)) {
        return new Set();
    }
    const content = fs.readFileSync(VARIABLES_CSS, "utf-8");
    // Match --var-name:
    const matches = content.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g);
    const defined = new Set();
    for (const m of matches) {
        defined.add(m[1]);
    }
    return defined;
}

/**
 * Strips comments from CSS string while preserving line numbers.
 */
function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (match) => {
        const lineCount = (match.match(/\n/g) || []).length;
        return "\n".repeat(lineCount);
    });
}

/**
 * Strips JS block and line comments while preserving line breaks.
 */
function stripJsComments(js) {
    return js
        .replace(/\/\*[\s\S]*?\*\//g, (match) => "\n".repeat((match.match(/\n/g) || []).length))
        .replace(/\/\/[^\n]*/g, "");
}

/**
 * Collects all files in a directory matching extensions.
 */
function collectFiles(dir, extensions) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    function walk(current) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
                results.push(fullPath);
            }
        }
    }
    walk(dir);
    return results;
}

/**
 * Runs theme integrity verification.
 */
function runThemeIntegrityCheck(options = {}) {
    const verbose = options.verbose !== false;
    const violations = [];
    const definedVars = getDefinedCssVariables();

    // 1. Check global scrollbar styling in base.css or variables.css
    let scrollbarFound = false;
    const baseContent = fs.existsSync(BASE_CSS) ? fs.readFileSync(BASE_CSS, "utf-8") : "";
    const varsContent = fs.existsSync(VARIABLES_CSS) ? fs.readFileSync(VARIABLES_CSS, "utf-8") : "";
    if (
        baseContent.includes("::-webkit-scrollbar") ||
        baseContent.includes("scrollbar-width") ||
        varsContent.includes("::-webkit-scrollbar") ||
        varsContent.includes("scrollbar-width")
    ) {
        scrollbarFound = true;
    }

    if (!scrollbarFound) {
        violations.push({
            type: "UNSTYLED_SCROLLBAR",
            file: "UI/webui/styles/base.css",
            line: 1,
            message: "Global scrollbar styling (::-webkit-scrollbar / scrollbar-width) is missing from base.css and variables.css."
        });
    }

    // 2. Scan CSS files
    const cssFiles = collectFiles(STYLES_DIR, [".css"]);
    for (const filePath of cssFiles) {
        const relPath = path.relative(ROOT_DIR, filePath);
        const isVariablesFile = path.resolve(filePath) === path.resolve(VARIABLES_CSS);
        const rawContent = fs.readFileSync(filePath, "utf-8");
        const cleanContent = stripCssComments(rawContent);
        const lines = cleanContent.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const line = lines[i];

            // 2.1 Prohibited Typefaces
            for (const font of PROHIBITED_FONTS) {
                const fontRegex = new RegExp(`(?:"|'|\\b)${font}(?:"|'|\\b)`, "i");
                if (fontRegex.test(line)) {
                    violations.push({
                        type: "PROHIBITED_FONT",
                        file: relPath,
                        line: lineNum,
                        detail: font,
                        snippet: line.trim(),
                        message: `Prohibited typeface '${font}' found.`
                    });
                }
            }

            // 2.2 Undefined CSS Variables: var(--var-name)
            const varMatches = line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g);
            for (const vm of varMatches) {
                const varName = vm[1];
                if (!definedVars.has(varName)) {
                    violations.push({
                        type: "UNDEFINED_CSS_VAR",
                        file: relPath,
                        line: lineNum,
                        detail: varName,
                        snippet: line.trim(),
                        message: `Referenced CSS variable '${varName}' is not defined in variables.css.`
                    });
                }
            }

            // If this is variables.css, token definitions are allowed to specify hex/rgb values
            if (isVariablesFile) {
                continue;
            }

            // 2.3 Hardcoded Hex Colors: #([0-9a-fA-F]{3,8})
            // Ignore SVG url(#clip-path), url('#id')
            const hexMatches = line.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
            for (const hm of hexMatches) {
                const fullMatch = hm[0];
                const hexVal = hm[1];
                // Only 3, 4, 6, or 8 characters are valid hex colors
                if ([3, 4, 6, 8].includes(hexVal.length)) {
                    // Check if part of url(#...)
                    const idx = hm.index;
                    const prevSub = line.slice(Math.max(0, idx - 6), idx);
                    if (/url\(['"]?$/i.test(prevSub)) {
                        continue;
                    }
                    violations.push({
                        type: "HARDCODED_HEX_COLOR",
                        file: relPath,
                        line: lineNum,
                        detail: fullMatch,
                        snippet: line.trim(),
                        message: `Hardcoded hex color '${fullMatch}' found. Must use var(--...) theme token.`
                    });
                }
            }

            // 2.4 Hardcoded rgb/rgba colors: rgba?(...)
            const rgbMatches = line.matchAll(/\brgba?\s*\([^)]+\)/gi);
            for (const rm of rgbMatches) {
                const fullMatch = rm[0];
                violations.push({
                    type: "HARDCODED_RGB_COLOR",
                    file: relPath,
                    line: lineNum,
                    detail: fullMatch,
                    snippet: line.trim(),
                    message: `Hardcoded color '${fullMatch}' found. Must use var(--...) theme token.`
                });
            }
        }
    }

    // 3. Scan JavaScript files in UI/webui/src/
    const jsFiles = collectFiles(SRC_DIR, [".js"]);
    for (const filePath of jsFiles) {
        const relPath = path.relative(ROOT_DIR, filePath);
        const rawContent = fs.readFileSync(filePath, "utf-8");
        const cleanContent = stripJsComments(rawContent);
        const lines = cleanContent.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const line = lines[i];

            // 3.1 Prohibited Fonts in JS
            for (const font of PROHIBITED_FONTS) {
                const fontRegex = new RegExp(`(?:"|'|\\b)${font}(?:"|'|\\b)`, "i");
                if (fontRegex.test(line)) {
                    violations.push({
                        type: "PROHIBITED_FONT",
                        file: relPath,
                        line: lineNum,
                        detail: font,
                        snippet: line.trim(),
                        message: `Prohibited typeface '${font}' found in JS source.`
                    });
                }
            }

            // 3.2 Inline CSS hex colors in style attributes or style template strings
            // e.g. style="...color: #...;" or style='...#...' or `background: #...`
            const inlineStyleHexMatch = line.match(/(?:style\s*=\s*["'][^"']*)#([0-9a-fA-F]{3,8})\b/i) ||
                                       line.match(/(?:(?:background|color|border(?:-color)?|fill|stroke)\s*:\s*["'`])#([0-9a-fA-F]{3,8})\b/i) ||
                                       line.match(/(?:(?:style\.)?(?:backgroundColor|color|borderColor)\s*=\s*["'])#([0-9a-fA-F]{3,8})\b/i);
            if (inlineStyleHexMatch) {
                const hexVal = inlineStyleHexMatch[1];
                if ([3, 4, 6, 8].includes(hexVal.length)) {
                    violations.push({
                        type: "HARDCODED_HEX_COLOR",
                        file: relPath,
                        line: lineNum,
                        detail: `#${hexVal}`,
                        snippet: line.trim(),
                        message: `Hardcoded inline hex color '#${hexVal}' found in JS component.`
                    });
                }
            }

            // 3.3 Undefined CSS Variables in JS: var(--var-name)
            const jsVarMatches = line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g);
            for (const vm of jsVarMatches) {
                const varName = vm[1];
                if (!definedVars.has(varName)) {
                    violations.push({
                        type: "UNDEFINED_CSS_VAR",
                        file: relPath,
                        line: lineNum,
                        detail: varName,
                        snippet: line.trim(),
                        message: `Referenced CSS variable '${varName}' in JS is not defined in variables.css.`
                    });
                }
            }
        }
    }

    // Group violations by type
    const summary = {
        totalFilesScanned: cssFiles.length + jsFiles.length,
        cssFilesScanned: cssFiles.length,
        jsFilesScanned: jsFiles.length,
        definedTokensCount: definedVars.size,
        violationsCount: violations.length,
        byType: {
            PROHIBITED_FONT: violations.filter(v => v.type === "PROHIBITED_FONT").length,
            UNSTYLED_SCROLLBAR: violations.filter(v => v.type === "UNSTYLED_SCROLLBAR").length,
            UNDEFINED_CSS_VAR: violations.filter(v => v.type === "UNDEFINED_CSS_VAR").length,
            HARDCODED_HEX_COLOR: violations.filter(v => v.type === "HARDCODED_HEX_COLOR").length,
            HARDCODED_RGB_COLOR: violations.filter(v => v.type === "HARDCODED_RGB_COLOR").length
        },
        violations
    };

    if (verbose) {
        console.log("================================================================================");
        console.log(" THEME INTEGRITY & DESIGN TOKENS VERIFICATION");
        console.log("================================================================================");
        console.log(`Files scanned: ${summary.totalFilesScanned} (${summary.cssFilesScanned} CSS, ${summary.jsFilesScanned} JS)`);
        console.log(`Defined theme tokens in variables.css: ${summary.definedTokensCount}`);
        console.log(`Total theme violations: ${summary.violationsCount}`);
        console.log("--------------------------------------------------------------------------------");
        console.log(`- Prohibited Fonts:        ${summary.byType.PROHIBITED_FONT}`);
        console.log(`- Unstyled Scrollbars:     ${summary.byType.UNSTYLED_SCROLLBAR}`);
        console.log(`- Undefined CSS Variables: ${summary.byType.UNDEFINED_CSS_VAR}`);
        console.log(`- Hardcoded Hex Colors:    ${summary.byType.HARDCODED_HEX_COLOR}`);
        console.log(`- Hardcoded RGB Colors:    ${summary.byType.HARDCODED_RGB_COLOR}`);
        console.log("--------------------------------------------------------------------------------");

        if (violations.length > 0) {
            console.log("\nTop Violations Sample (up to 20):");
            violations.slice(0, 20).forEach((v, idx) => {
                console.log(`  ${idx + 1}. [${v.type}] ${v.file}:${v.line} -> ${v.message}`);
                if (v.snippet) console.log(`     Snippet: ${v.snippet.slice(0, 100)}`);
            });
            if (violations.length > 20) {
                console.log(`  ... and ${violations.length - 20} more violations.`);
            }
        }
        console.log("================================================================================");
        if (summary.violationsCount === 0) {
            console.log("RESULT: PASS - Theme integrity is 100% compliant.");
        } else {
            console.log(`RESULT: FAIL - ${summary.violationsCount} theme violations detected.`);
        }
        console.log("================================================================================");
    }

    return summary;
}

if (require.main === module) {
    const result = runThemeIntegrityCheck({ verbose: true });
    process.exit(result.violationsCount === 0 ? 0 : 1);
}

module.exports = {
    runThemeIntegrityCheck,
    getDefinedCssVariables
};
