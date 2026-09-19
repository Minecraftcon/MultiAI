/* =========================================================
   MARKDOWN, CODE, SYNTAX HIGHLIGHTING & MERMAID RENDERER
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";

// Initialize Mermaid
if (typeof mermaid !== "undefined") {
    mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        fontFamily: "'JetBrains Mono', monospace",
        themeVariables: {
            darkMode: true,
            background: "#181818",
            primaryColor: "#2563eb",
            primaryTextColor: "#f3f4f6",
            primaryBorderColor: "#3b82f6",
            lineColor: "#9ca3af",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0f172a"
        }
    });
}

// Configure Marked
let markedRenderer = null;
if (typeof marked !== "undefined") {
    marked.setOptions({ gfm: true, breaks: true, pedantic: false });
    markedRenderer = new marked.Renderer();
}

if (markedRenderer) {
    markedRenderer.code = function(code, language) {
        const rawCode = typeof code === "object" ? code.text : code;
        const rawLang = (typeof code === "object" ? code.lang : language) || "";

        const lang = rawLang.trim();
        const cleanLang = lang.toLowerCase();
        const isSingleLine = !rawCode.trim().includes("\n");
        const isPlayable = ["html", "xml", "svg"].includes(cleanLang);
        const isMermaid = cleanLang === "mermaid";

        let highlighted;
        try {
            highlighted = (lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) 
                ? hljs.highlight(rawCode, { language: lang }).value 
                : (typeof hljs !== "undefined" ? hljs.highlightAuto(rawCode).value : escapeHTML(rawCode));
        } catch {
            highlighted = escapeHTML(rawCode);
        }
        const encoded = encodeURIComponent(rawCode);

        if (isMermaid) {
            return `
            <div class="code-container mermaid-container" data-code="${encoded}">
                <div class="code-lang-header">
                    <div class="code-mode-pill">
                        <button type="button" class="pill-btn active code-mode-diagram">
                            <i data-lucide="git-merge"></i>
                            <span>Chart</span>
                        </button>
                        <button type="button" class="pill-btn code-mode-code">
                            <i data-lucide="code"></i>
                            <span>Code</span>
                        </button>
                    </div>
                    <span class="code-lang-label">mermaid</span>
                    <div class="code-lang-line"></div>
                </div>
                <div class="code-bubble view-diagram">
                    <div class="code-bubble-inner">
                        <div class="mermaid-diagram-wrapper">
                            <div class="mermaid-target" data-chart="${encoded}">
                                <div class="mermaid-loading">Rendering chart...</div>
                            </div>
                        </div>
                        <pre class="mermaid-code-pre"><code class="hljs language-mermaid">${highlighted}</code></pre>
                        <button class="code-copy-btn" data-code="${encoded}" type="button" title="Copy code">
                            <i data-lucide="copy"></i>
                        </button>
                    </div>
                </div>
            </div>
            `;
        }

        return `
            <div class="code-container" data-code="${encoded}">
                <div class="code-lang-header">
                    ${isPlayable ? `
                    <div class="code-mode-pill">
                        <button type="button" class="pill-btn active code-mode-code">
                            <i data-lucide="code"></i>
                            <span>Code</span>
                        </button>
                        <button type="button" class="pill-btn code-mode-play">
                            <i data-lucide="play"></i>
                            <span>Play</span>
                        </button>
                    </div>
                    ` : ''}
                    ${lang ? `<span class="code-lang-label">${escapeHTML(lang)}</span>` : ''}
                    <div class="code-lang-line"></div>
                </div>
                <div class="code-bubble ${isSingleLine ? 'single-line' : ''}">
                    <div class="code-bubble-inner">
                        <pre><code class="hljs ${lang ? 'language-' + escapeHTML(lang) : ''}">${highlighted}</code></pre>
                        ${isPlayable ? `<iframe class="code-preview-frame" sandbox="allow-scripts allow-modals"></iframe>` : ''}
                        <button class="code-copy-btn" data-code="${encoded}" type="button" title="Copy code">
                            <i data-lucide="copy"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    };

const VIDEO_EXTENSIONS = new Set([
    ".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v", ".mkv",
    ".avi", ".mpg", ".mpeg", ".wmv", ".flv", ".3gp", ".3gpp", ".ts", ".m2ts"
]);
const AUDIO_EXTENSIONS = new Set([
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".oga", ".opus", ".weba", ".wma"
]);

    markedRenderer.image = function(href, title, text) {
        let cleanHref = href;
        let cleanAlt = text || "";
        let cleanTitle = title || "";
        if (typeof href === "object" && href !== null) {
            cleanHref = href.href;
            cleanAlt = href.text || "";
            cleanTitle = href.title || "";
        }

        if (typeof cleanHref === "string") {
            cleanHref = cleanHref.trim().replace(/^["'`<]+|["'`>]+$/g, "").trim();
        }
        if (typeof cleanAlt === "string") {
            cleanAlt = cleanAlt.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
        }
        if (typeof cleanTitle === "string") {
            cleanTitle = cleanTitle.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
        }

        let resolvedHref = cleanHref || "";
        if (resolvedHref) {
            const trimmed = resolvedHref.trim();
            if (!/^(https?:|data:|blob:|\/api\/media[/?])/i.test(trimmed)) {
                resolvedHref = `/api/media?path=${encodeURIComponent(trimmed)}`;
            }
        }

        const safeHref = escapeHTML(resolvedHref);
        const safeAlt = escapeHTML(cleanAlt || "");
        const safeTitle = escapeHTML(cleanTitle || "");

        const urlClean = (cleanHref || "").split("?")[0].split("#")[0].replace(/^["'`<]+|["'`>]+$/g, "");
        const ext = ("." + urlClean.split(".").pop()).toLowerCase();

        if (VIDEO_EXTENSIONS.has(ext)) {
            return `
            <div class="ai-video-frame">
                <video class="ai-video-el" src="${safeHref}" controls playsinline preload="metadata" title="${safeTitle || safeAlt || 'Video'}">
                    Your browser does not support the video tag.
                </video>
                ${cleanAlt ? `<span class="ai-media-caption">${safeAlt}</span>` : ""}
            </div>
            `;
        }

        if (AUDIO_EXTENSIONS.has(ext)) {
            return `
            <div class="ai-audio-frame">
                <audio class="ai-audio-el" src="${safeHref}" controls preload="metadata">
                    Your browser does not support the audio tag.
                </audio>
                ${cleanAlt ? `<span class="ai-media-caption">${safeAlt}</span>` : ""}
            </div>
            `;
        }

        return `
        <div class="ai-img-frame" data-state="generating" data-src="${safeHref}">
            <div class="ai-img-placeholder">
                <div class="ai-img-dots"></div>
                <div class="ai-img-sweep"></div>
                <span class="ai-img-size">1024 × 1024</span>
            </div>
            <img class="ai-img-el" src="${safeHref}" alt="${safeAlt || 'Image'}" title="${safeTitle}" loading="eager" />
        </div>
        `;
    };

    marked.use({ renderer: markedRenderer });
}

export function formatThoughtHtml(content, durationStr = "") {
    if (!content || !content.trim()) return "";

    const rawDur = String(durationStr || "").trim();
    const durLabel = rawDur ? (typeof rawDur === "number" || (!isNaN(Number(rawDur)) && rawDur !== "") ? `${rawDur} seconds` : rawDur) : "a few seconds";
    const brainSvg = `<svg class="thought-brain-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M12 8h4"/><path d="M12 12h3"/><path d="M12 16h4"/><path d="M8 8h4"/><path d="M9 12h3"/><path d="M8 16h4"/></svg>`;

    let innerFormatted = content.trim();
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        try {
            innerFormatted = marked.parse(innerFormatted);
        } catch {
            innerFormatted = escapeHTML(innerFormatted);
        }
    } else {
        innerFormatted = escapeHTML(innerFormatted);
    }

    const isHuge = content.length > 400 || content.split("\n").length > 6;
    const bodyHtml = isHuge
        ? `<div class="thought-content thought-collapsible"><div class="thought-collapsed-body">${innerFormatted}</div><button type="button" class="thought-expand-btn"><span class="thought-expand-icon">...</span> expand</button></div>`
        : `<div class="thought-content">${innerFormatted}</div>`;

    return `<details class="thought-box" open${rawDur ? ` data-duration="${escapeHTML(rawDur)}"` : ''}><summary class="thought-summary"><span class="thought-header">${brainSvg}<span class="thought-label">Thought for ${escapeHTML(durLabel)}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body">${bodyHtml}</div></details>`;
}

function cleanFollowupPrompt(q) {
    let text = (q || "").trim();
    text = text.replace(/^[-*•\d.)\]\s]+/, "").trim();
    // Normalize assistant-style questions into direct user-side prompts
    text = text.replace(/^(?:would\s+you\s+like\s+me\s+to|do\s+you\s+want\s+me\s+to|should\s+i)\s+/i, "Can you ");
    text = text.replace(/^(?:do\s+you\s+need\s+(?:help\s+with\s+)?|are\s+you\s+looking\s+(?:to\s+|for\s+)?)/i, "How to ");
    return text.trim();
}

export function extractFollowups(text) {
    if (!text || typeof text !== "string") return { cleanText: text || "", followups: [] };

    const followups = [];
    // Matches <followup>...</followup>, <followup>...<followup/>, <fw1>...</fw1>, <fw1>...<fw1/>
    const tagRegex = /<\s*(?:followup|fw\d*)\s*>([\s\S]*?)(?:<\s*\/\s*(?:followup|fw\d*)\s*>|<\s*(?:followup|fw\d*)\s*\/\s*>)/gi;

    let cleanText = text.replace(tagRegex, (_, q) => {
        const cleaned = cleanFollowupPrompt(q);
        if (cleaned && !followups.includes(cleaned)) {
            followups.push(cleaned);
        }
        return "";
    });

    // Capture unclosed tag at the very end if generation ended without closing tag
    const unclosedRegex = /<\s*(?:followup|fw\d*)\s*>([\s\S]*)$/gi;
    cleanText = cleanText.replace(unclosedRegex, (_, q) => {
        const cleaned = cleanFollowupPrompt(q);
        if (cleaned && cleaned.length > 3 && !followups.includes(cleaned)) {
            followups.push(cleaned);
        }
        return "";
    });

    return { cleanText: cleanText.trimEnd(), followups };
}

export function extractThoughtAndContent(text) {
    let raw = text || "";
    if (!raw.trim()) {
        return { thoughtHtml: "", content: "", duration: "", followups: [] };
    }

    const { cleanText, followups } = extractFollowups(raw);
    raw = cleanText;

    let thoughts = [];
    let duration = "";

    // 1. Check for existing .thought-box (only retain if non-empty thought-content exists)
    const thoughtBoxRegex = /<details class="thought-box"([^>]*)>([\s\S]*?)<\/details>/gi;
    let match;
    while ((match = thoughtBoxRegex.exec(raw)) !== null) {
        const attrs = match[1] || "";
        const body = match[2] || "";
        const durMatch = attrs.match(/data-duration=["']([^"']*)["']/i);
        if (durMatch && durMatch[1]) duration = durMatch[1];

        const innerContentMatch = body.match(/<div class="thought-content">([\s\S]*?)<\/div>/i);
        const innerRaw = innerContentMatch ? innerContentMatch[1] : body;
        const textOnly = innerRaw.replace(/<[^>]+>/g, "").trim();
        if (textOnly) {
            thoughts.push(match[0]);
        }
    }
    if (thoughts.length > 0) {
        const cleanContent = raw.replace(thoughtBoxRegex, "").trim();
        return {
            thoughtHtml: thoughts.join("\n\n"),
            content: cleanContent,
            duration,
            followups
        };
    }

    // 2. Check for <think> tags (streaming or closed)
    const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
    let thinkMatches = [];
    raw = raw.replace(thinkRegex, (_, thinkText) => {
        if (thinkText && thinkText.trim()) {
            thinkMatches.push(thinkText.trim());
        }
        return "";
    });
    if (thinkMatches.length > 0) {
        const html = formatThoughtHtml(thinkMatches.join("\n\n"), duration);
        if (html) {
            return {
                thoughtHtml: html,
                content: raw.trim(),
                duration,
                followups
            };
        }
    }

    // 3. Check for generic <details><summary>Thinking Process / Thought / Reasoning</summary>...
    const detailsRegex = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
    let detailsMatches = [];
    raw = raw.replace(detailsRegex, (orig, summaryText, bodyText) => {
        const isThought = /think|thought|reasoning/i.test(summaryText);
        if (isThought && bodyText && bodyText.trim()) {
            detailsMatches.push(bodyText.trim());
            return "";
        }
        return orig;
    });
    if (detailsMatches.length > 0) {
        const html = formatThoughtHtml(detailsMatches.join("\n\n"), duration);
        if (html) {
            return {
                thoughtHtml: html,
                content: raw.trim(),
                duration,
                followups
            };
        }
    }

    return {
        thoughtHtml: "",
        content: raw.trim(),
        duration: "",
        followups
    };
}

/**
 * Pre-processes LaTeX math formulas before marked parses markdown,
 * shielding math expressions from markdown underscore/asterisk italic corruption,
 * and tokenizing them for KaTeX rendering.
 */
function processMathInText(rawText) {
    if (!rawText || typeof rawText !== "string") return { text: rawText, mathBlocks: [] };

    // 1. Stash code blocks and inline code so math syntax inside code blocks is never altered
    const codeBlocks = [];
    let text = rawText.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
        const token = `@@@MULTI_AI_CODE_${codeBlocks.length}@@@`;
        codeBlocks.push(match);
        return token;
    });

    const mathBlocks = [];

    // 2. Display math: $$...$$
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
        const token = `@@@KATEX_BLOCK_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: math.trim(), display: true });
        return `\n\n${token}\n\n`;
    });

    // 3. Display math: \[...\]
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
        const token = `@@@KATEX_BLOCK_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: math.trim(), display: true });
        return `\n\n${token}\n\n`;
    });

    // 4. Display math environments: \begin{equation}...\end{equation}, \begin{align}...\end{align}, etc.
    text = text.replace(/\\begin\{(equation|align|gather|alignat|flalign|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|cases)\*?\}([\s\S]+?)\\end\{\1\*?\}/g, (match) => {
        const token = `@@@KATEX_BLOCK_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: match.trim(), display: true });
        return `\n\n${token}\n\n`;
    });

    // 5. Standalone bracket display math: [ ... \cmd ... ] (very common in LLM outputs)
    text = text.replace(/(?:^|\n)\s*\[\s*([\s\S]*?\\[a-zA-Z]+[\s\S]*?)\s*\]\s*(?=\n|$)/g, (_, math) => {
        const token = `@@@KATEX_BLOCK_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: math.trim(), display: true });
        return `\n\n${token}\n\n`;
    });

    // 6. Inline math: \(...\)
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
        const token = `@@@KATEX_INLINE_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: math.trim(), display: false });
        return token;
    });

    // 7. Inline math: $...$ (ensure not preceded/followed by digits or currency symbols)
    text = text.replace(/(?<![\$\\\w])\$([^\s\$](?:[^\$]*?[^\s\$])?)\$(?![\$\d\w])/g, (_, math) => {
        const token = `@@@KATEX_INLINE_${mathBlocks.length}@@@`;
        mathBlocks.push({ math: math.trim(), display: false });
        return token;
    });

    // 8. Restore code blocks
    text = text.replace(/@@@MULTI_AI_CODE_(\d+)@@@/g, (_, i) => codeBlocks[parseInt(i, 10)]);

    return { text, mathBlocks };
}

function restoreMathTokens(html, mathBlocks) {
    if (!html || !mathBlocks || mathBlocks.length === 0) return html;

    let res = html;

    // Remove wrapping <p> around display blocks if marked added them
    res = res.replace(/<p>\s*(@@@KATEX_BLOCK_\d+@@@)\s*<\/p>/g, "$1");

    // Replace display math tokens
    res = res.replace(/@@@KATEX_BLOCK_(\d+)@@@/g, (_, i) => {
        const item = mathBlocks[parseInt(i, 10)];
        if (!item) return "";
        try {
            if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
                return `<div class="katex-display-wrapper">${katex.renderToString(item.math, { displayMode: true, throwOnError: false })}</div>`;
            }
        } catch (e) {
            console.warn("[KaTeX] Display math error:", e);
        }
        return `<div class="katex-display-wrapper">$$${escapeHTML(item.math)}$$</div>`;
    });

    // Replace inline math tokens
    res = res.replace(/@@@KATEX_INLINE_(\d+)@@@/g, (_, i) => {
        const item = mathBlocks[parseInt(i, 10)];
        if (!item) return "";
        try {
            if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
                return `<span class="katex-inline-wrapper">${katex.renderToString(item.math, { displayMode: false, throwOnError: false })}</span>`;
            }
        } catch (e) {
            console.warn("[KaTeX] Inline math error:", e);
        }
        return `<span class="katex-inline-wrapper">$${escapeHTML(item.math)}$</span>`;
    });

    return res;
}

function normalizeMarkdownMediaSyntax(content) {
    if (!content) return "";
    return content.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, target) => {
        let trimmedTarget = (target || "").trim();
        if (!trimmedTarget) return match;

        // If already angle bracket enclosed, e.g. <...>, leave as is
        if (/^<.*>$/.test(trimmedTarget)) {
            return match;
        }

        let titlePart = "";
        let urlPart = trimmedTarget;

        const titleMatch = trimmedTarget.match(/\s+("[^"]*"|'[^']*')$/);
        if (titleMatch) {
            titlePart = " " + titleMatch[1];
            urlPart = trimmedTarget.slice(0, titleMatch.index).trim();
        }

        urlPart = urlPart.replace(/^["'`]+|["'`]+$/g, "").trim();

        if (urlPart.includes(" ")) {
            urlPart = `<${urlPart}>`;
        }

        return `![${alt}](${urlPart}${titlePart})`;
    });
}

export function parseMarkdown(text) {
    if (!text) return "";

    const { thoughtHtml, content } = extractThoughtAndContent(text);
    let parsedContent = "";
    if (content) {
        const normalizedContent = normalizeMarkdownMediaSyntax(content);
        const { text: processedText, mathBlocks } = processMathInText(normalizedContent);
        if (typeof marked !== "undefined" && typeof marked.parse === "function") {
            try {
                parsedContent = marked.parse(processedText);
            } catch (e) {
                parsedContent = escapeHTML(processedText);
            }
        } else {
            parsedContent = escapeHTML(processedText);
        }
        parsedContent = restoreMathTokens(parsedContent, mathBlocks);

        parsedContent = parsedContent.replace(/<(video|audio|source|img)\b([^>]*?)>/gi, (match, tag, attrs) => {
            let updatedAttrs = attrs.replace(/\b(src|poster)\s*=\s*(["'])(.*?)\2/gi, (attrMatch, attrName, quote, urlVal) => {
                let trimmed = (urlVal || "").trim().replace(/^["'`<]+|["'`>]+$/g, "").trim();
                if (trimmed && !/^(https?:|data:|blob:|\/api\/media[/?]|#)/i.test(trimmed)) {
                    return `${attrName}=${quote}/api/media?path=${encodeURIComponent(trimmed)}${quote}`;
                }
                return attrMatch;
            });

            if ((tag.toLowerCase() === "video" || tag.toLowerCase() === "audio") && !/\bcontrols\b/i.test(updatedAttrs)) {
                updatedAttrs += " controls playsinline";
            }

            return `<${tag}${updatedAttrs}>`;
        });
    }

    let combined = "";
    if (thoughtHtml && parsedContent) {
        combined = `${thoughtHtml}\n${parsedContent}`;
    } else if (thoughtHtml) {
        combined = thoughtHtml;
    } else {
        combined = parsedContent;
    }

    if (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function") {
        return DOMPurify.sanitize(combined, {
            USE_PROFILES: { html: true, svg: true, mathMl: true },
            ADD_TAGS: [
                "details", "summary", "svg", "path", "polyline", "line", "circle", "rect",
                "math", "semantics", "mrow", "annotation", "mtext", "mspace",
                "mo", "mi", "mn", "msub", "msup", "msubsup", "mfrac", "mroot",
                "msqrt", "mtable", "mtr", "mtd", "munder", "mover", "munderover",
                "video", "audio", "source", "track", "a"
            ],
            ADD_ATTR: [
                "target", "rel", "class", "data-code", "data-chart", 
                "data-state", "data-src", "sandbox", "srcdoc", "loading", "style",
                "open", "viewBox", "stroke", "stroke-width", "fill",
                "stroke-linecap", "stroke-linejoin", "d", "data-duration",
                "xmlns", "display", "mathvariant", "columnalign", "rowspacing", "columnspacing",
                "controls", "playsinline", "preload", "autoplay", "muted", "loop", "poster", "width", "height", "src", "type", "href", "download"
            ]
        });
    }
    return combined;
}

export function bindAIVideoFrames(container) {
    if (!container) return;
    const videoFrames = container.querySelectorAll(".ai-video-frame");
    videoFrames.forEach(frame => {
        if (frame.dataset.bound) return;
        frame.dataset.bound = "true";
        const video = frame.querySelector(".ai-video-el");
        if (!video) return;

        video.addEventListener("error", () => {
            const src = video.getAttribute("src") || video.currentSrc || "";
            if (!frame.querySelector(".ai-media-error-notice")) {
                const notice = document.createElement("div");
                notice.className = "ai-media-error-notice";
                notice.innerHTML = `
                    <span class="ai-media-error-text">Browser could not decode video stream.</span>
                    ${src ? `<a class="ai-media-download-link" href="${src}" target="_blank" download>Direct file link</a>` : ""}
                `;
                frame.appendChild(notice);
            }
        });
    });
}

export function bindAIImageCards(container, immediate = false) {
    if (!container) return;
    bindAIVideoFrames(container);
    const frames = container.querySelectorAll(".ai-img-frame");
    frames.forEach(frame => {
        if (frame.dataset.state === "ready" || frame.dataset.state === "error") return;

        const img = frame.querySelector(".ai-img-el");
        const sizeBadge = frame.querySelector(".ai-img-size");

        const updateSize = () => {
            if (img && img.naturalWidth && img.naturalHeight) {
                if (sizeBadge) sizeBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
                frame.style.setProperty("--img-ar", `${img.naturalWidth} / ${img.naturalHeight}`);
            }
        };

        const setReady = () => {
            updateSize();
            frame.dataset.state = "ready";
        };

        const setError = () => {
            frame.dataset.state = "error";
        };

        if (img) {
            if (img.complete && img.naturalWidth > 0) {
                setReady();
                return;
            }
            img.addEventListener("load", setReady, { once: true });
            img.addEventListener("error", setError, { once: true });
        }

        if (immediate) {
            if (img && img.complete && img.naturalWidth > 0) {
                setReady();
            } else if (img && img.complete && !img.naturalWidth && img.src) {
                setError();
            } else {
                setReady();
            }
            return;
        }

        const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) {
            setReady();
            return;
        }

        if (frame.dataset.animating === "true") return;
        frame.dataset.animating = "true";

        setTimeout(() => {
            if (frame.dataset.state !== "ready" && frame.dataset.state !== "error") {
                frame.dataset.state = "revealing";
            }
        }, 1400);

        setTimeout(() => {
            if (frame.dataset.state !== "error") {
                setReady();
            }
        }, 2100);
    });
}

export function bindInteractiveCodeBlocks(container) {
    container.querySelectorAll(".code-container").forEach(block => {
        if (block.dataset.bound) return;
        block.dataset.bound = "true";

        const bubble = block.querySelector(".code-bubble");
        const rawCode = decodeURIComponent(block.dataset.code || "");
        const diagramBtn = block.querySelector(".code-mode-diagram");
        const playBtn = block.querySelector(".code-mode-play");
        const codeBtn = block.querySelector(".code-mode-code");
        const iframe = block.querySelector(".code-preview-frame");
        const copyBtn = block.querySelector(".code-copy-btn");

        if (diagramBtn && codeBtn && bubble) {
            diagramBtn.addEventListener("click", () => {
                diagramBtn.classList.add("active");
                codeBtn.classList.remove("active");
                bubble.classList.add("view-diagram");
            });

            codeBtn.addEventListener("click", () => {
                codeBtn.classList.add("active");
                diagramBtn.classList.remove("active");
                bubble.classList.remove("view-diagram");
            });
        }

        if (playBtn && codeBtn && iframe && bubble) {
            playBtn.addEventListener("click", () => {
                playBtn.classList.add("active");
                codeBtn.classList.remove("active");
                bubble.classList.add("view-preview");

                if (!iframe.srcdoc) {
                    iframe.srcdoc = rawCode;
                }
            });

            codeBtn.addEventListener("click", () => {
                codeBtn.classList.add("active");
                playBtn.classList.remove("active");
                bubble.classList.remove("view-preview");
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(rawCode);
                    copyBtn.innerHTML = '<i data-lucide="check"></i>';
                    renderIcons(copyBtn);
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i data-lucide="copy"></i>';
                        renderIcons(copyBtn);
                    }, 1500);
                } catch (error) {
                    console.error("Copy failed:", error);
                }
            });
        }
    });
}

let mermaidChartCounter = 0;

export async function renderMermaidInElement(container) {
    if (typeof mermaid === "undefined") return;

    const targets = container.querySelectorAll(".mermaid-target");
    for (const target of targets) {
        if (target.dataset.rendered === "true") continue;
        target.dataset.rendered = "true";

        const rawCode = decodeURIComponent(target.dataset.chart || "").trim();
        if (!rawCode) continue;

        const id = "mermaid-svg-" + (++mermaidChartCounter);
        try {
            const { svg } = await mermaid.render(id, rawCode);
            target.innerHTML = svg;
        } catch (err) {
            console.error("Mermaid render error:", err);
            const stray = document.getElementById("d" + id) || document.getElementById(id);
            if (stray) stray.remove();
            target.innerHTML = `<div class="mermaid-error">⚠️ Diagram syntax error: ${escapeHTML(err.message || err)}</div>`;
        }
    }
}

export function renderMath(container) {
    if (!container) return;

    const renderFn = typeof renderMathInElement === "function"
        ? renderMathInElement
        : (typeof window !== "undefined" && typeof window.renderMathInElement === "function" ? window.renderMathInElement : null);

    if (renderFn) {
        try {
            renderFn(container, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "\\[", right: "\\]", display: true },
                    { left: "\\begin{equation}", right: "\\end{equation}", display: true },
                    { left: "\\begin{align}", right: "\\end{align}", display: true },
                    { left: "\\begin{gather}", right: "\\end{gather}", display: true },
                    { left: "\\begin{matrix}", right: "\\end{matrix}", display: true },
                    { left: "\\begin{pmatrix}", right: "\\end{pmatrix}", display: true },
                    { left: "\\begin{cases}", right: "\\end{cases}", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false }
                ],
                throwOnError: false,
                strict: false,
                ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
            });
        } catch (e) {
            console.warn("[KaTeX] renderMathInElement failed:", e);
        }
    }

    // Secondary pass for standalone bracket display math: [ ... \cmd ... ]
    // Common in LLM outputs or when markdown parsers strip escaped brackets \[ -> [
    const katexFn = typeof katex !== "undefined" && typeof katex.renderToString === "function"
        ? katex
        : (typeof window !== "undefined" && window.katex && typeof window.katex.renderToString === "function" ? window.katex : null);

    if (katexFn) {
        try {
            const candidates = container.querySelectorAll("p, div, li, span");
            for (const el of candidates) {
                if (el.closest("pre, code, .katex, .katex-display-wrapper, .katex-inline-wrapper")) continue;
                if (el.querySelector(".katex, pre, code")) continue;

                const text = el.textContent.trim();
                const m = text.match(/^\[\s*([\s\S]*?\\[a-zA-Z]+[\s\S]*?)\s*\]$/);
                if (m) {
                    const math = m[1].trim();
                    try {
                        el.innerHTML = `<div class="katex-display-wrapper">${katexFn.renderToString(math, { displayMode: true, throwOnError: false })}</div>`;
                    } catch (_) {}
                }
            }
        } catch (e) {
            console.warn("[KaTeX] Bracket math pass failed:", e);
        }
    }
}
