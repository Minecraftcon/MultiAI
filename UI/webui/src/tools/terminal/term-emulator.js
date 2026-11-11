/**
 * Virtual Terminal Screen & ANSI Sequence Emulator
 * =================================================
 * Provides lightweight, zero-dependency ANSI escape parsing, SGR color styling,
 * and interactive cursor/line overwrite emulation (carriage returns \r, backspaces \b,
 * line clears \x1b[2K, cursor moves).
 */

/**
 * Parses raw terminal text or stream buffer into HTML with ANSI styling classes
 * and properly evaluated in-place line overwrites.
 *
 * @param {string} text - Raw terminal text with ANSI codes and control characters.
 * @returns {{ html: string, text: string }} Formatted HTML and clean plain text.
 */
export function parseTerminal(text) {
    if (!text) return { html: "", text: "" };

    // If text does not contain explicit \r, detect inline progress bar updates (e.g. copied text or unbuffered logs)
    if (!text.includes("\r")) {
        text = text.replace(
            /(?<=\%\](?:\x1b?\[0m)?|\x1b?\[0m)\s*(?=(?:\x1b?\[[0-9;]*m)?\s*(?:Progress|\d+\%|\bDownloading|\bFetching|\bExtracting))/gi,
            "\r"
        );
    }

    const lines = [[]];
    let row = 0;
    let col = 0;
    let style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };

    // Matches standard ANSI / VT100 escapes:
    const csiRegex = /(?:\x1b|\u001b)?\[(?:\?|\>|\!)?([0-9;]*)([a-zA-Z])/g;

    function appendChar(ch) {
        if (!lines[row]) lines[row] = [];
        while (lines[row].length < col) {
            lines[row].push({ char: " ", style: {} });
        }
        lines[row][col] = { char: ch, style: { ...style } };
        col++;
    }

    let i = 0;
    const len = text.length;

    while (i < len) {
        const ch = text[i];
        if (ch === "\r") {
            if (i + 1 < len && text[i + 1] === "\n") {
                // \r\n newline
                i += 2;
                row++;
                if (!lines[row]) lines[row] = [];
                col = 0;
            } else {
                // \r carriage return (move cursor to start of current line)
                i++;
                col = 0;
            }
        } else if (ch === "\n") {
            i++;
            row++;
            if (!lines[row]) lines[row] = [];
            col = 0;
        } else if (ch === "\b") {
            i++;
            col = Math.max(0, col - 1);
        } else if (ch === "\t") {
            i++;
            const nextTab = (Math.floor(col / 8) + 1) * 8;
            while (col < nextTab) appendChar(" ");
        } else if (ch === "\x1b" || ch === "\u001b" || (ch === "[" && /\d+m/.test(text.slice(i, i + 6)))) {
            csiRegex.lastIndex = i;
            const m = csiRegex.exec(text);
            if (m && m.index === i) {
                const paramStr = m[1];
                const cmd = m[2];
                const rawMatch = m[0];

                if (rawMatch.includes("?") || rawMatch.includes(">") || rawMatch.includes("!")) {
                    // Ignore private mode sequences like ?25l (hide cursor), ?25h (show cursor)
                    i += rawMatch.length;
                    continue;
                }

                const params = paramStr ? paramStr.split(";").map(Number) : [0];

                if (cmd === "m") {
                    // SGR styling
                    let pIdx = 0;
                    if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
                        style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
                    }
                    while (pIdx < params.length) {
                        const p = params[pIdx++];
                        if (p === 0) {
                            style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
                        } else if (p === 1) style.bold = true;
                        else if (p === 2) style.dim = true;
                        else if (p === 3) style.italic = true;
                        else if (p === 4) style.underline = true;
                        else if (p === 22) { style.bold = false; style.dim = false; }
                        else if (p === 23) style.italic = false;
                        else if (p === 24) style.underline = false;
                        else if (p === 39) style.fg = null;
                        else if (p === 49) style.bg = null;
                        else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) {
                            style.fg = p;
                        } else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) {
                            style.bg = p;
                        } else if (p === 38 || p === 48) {
                            const isFg = (p === 38);
                            const mode = params[pIdx++];
                            if (mode === 5 && pIdx < params.length) {
                                const colorIdx = params[pIdx++];
                                if (isFg) style.fg = `256_${colorIdx}`;
                                else style.bg = `256_${colorIdx}`;
                            } else if (mode === 2 && pIdx + 2 < params.length) {
                                const r = params[pIdx++];
                                const g = params[pIdx++];
                                const b = params[pIdx++];
                                if (isFg) style.fg = `rgb(${r},${g},${b})`;
                                else style.bg = `rgb(${r},${g},${b})`;
                            }
                        }
                    }
                } else if (cmd === "K") {
                    // Erase in line
                    const mode = params[0] || 0;
                    if (lines[row]) {
                        if (mode === 0) lines[row].length = col;
                        else if (mode === 1) {
                            for (let k = 0; k < col && k < lines[row].length; k++) {
                                lines[row][k] = { char: " ", style: {} };
                            }
                        } else if (mode === 2) {
                            lines[row] = [];
                            col = 0;
                        }
                    }
                } else if (cmd === "A") {
                    // Cursor up
                    row = Math.max(0, row - (params[0] || 1));
                } else if (cmd === "B") {
                    // Cursor down
                    row = Math.min(lines.length - 1, row + (params[0] || 1));
                } else if (cmd === "C") {
                    // Cursor forward
                    col += (params[0] || 1);
                } else if (cmd === "D") {
                    // Cursor backward
                    col = Math.max(0, col - (params[0] || 1));
                } else if (cmd === "G") {
                    // Cursor horizontal absolute
                    col = Math.max(0, (params[0] || 1) - 1);
                }

                i += rawMatch.length;
            } else {
                appendChar(ch);
                i++;
            }
        } else {
            appendChar(ch);
            i++;
        }
    }

    const html = lines.map(line => {
        if (!line) return "";
        let res = "";
        let curKey = "";
        let openSpan = false;

        function getStyleKey(s) {
            if (!s) return "";
            return `${s.fg || ""}|${s.bg || ""}|${s.bold ? "1" : ""}|${s.dim ? "1" : ""}|${s.italic ? "1" : ""}|${s.underline ? "1" : ""}`;
        }

        for (let c = 0; c < line.length; c++) {
            const cell = line[c] || { char: " ", style: {} };
            const k = getStyleKey(cell.style);
            if (k !== curKey) {
                if (openSpan) {
                    res += "</span>";
                    openSpan = false;
                }
                curKey = k;
                if (k && k !== "|||||") {
                    const classes = [];
                    const inlineStyles = [];
                    if (typeof cell.style.fg === "number") classes.push(`ansi-${cell.style.fg}`);
                    else if (typeof cell.style.fg === "string" && cell.style.fg.startsWith("rgb(")) inlineStyles.push(`color: ${cell.style.fg}`);
                    if (typeof cell.style.bg === "number") classes.push(`ansi-bg-${cell.style.bg}`);
                    else if (typeof cell.style.bg === "string" && cell.style.bg.startsWith("rgb(")) inlineStyles.push(`background-color: ${cell.style.bg}`);
                    if (cell.style.bold) classes.push("ansi-bold");
                    if (cell.style.dim) classes.push("ansi-dim");
                    if (cell.style.italic) classes.push("ansi-italic");
                    if (cell.style.underline) classes.push("ansi-underline");

                    const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
                    const styleAttr = inlineStyles.length ? ` style="${inlineStyles.join("; ")}"` : "";
                    res += `<span${classAttr}${styleAttr}>`;
                    openSpan = true;
                }
            }
            const cChar = cell.char;
            res += (cChar === "<" ? "&lt;" : (cChar === ">" ? "&gt;" : (cChar === "&" ? "&amp;" : (cChar === "\"" ? "&quot;" : cChar))));
        }
        if (openSpan) res += "</span>";
        return res;
    }).join("\n");

    const plainText = lines.map(line => line ? line.map(c => c.char).join("") : "").join("\n");

    return { html, text: plainText };
}

/**
 * Returns formatted HTML with ANSI styles and interactive updates evaluated.
 */
export function parseTerminalAnsi(text) {
    return parseTerminal(text).html;
}

/**
 * Returns clean plain text with ANSI codes stripped and line overwrites evaluated.
 */
export function cleanTerminalScreen(text) {
    return parseTerminal(text).text;
}

