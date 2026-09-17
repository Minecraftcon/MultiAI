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

    markedRenderer.image = function(href, title, text) {
        let cleanHref = href;
        let cleanAlt = text || "";
        let cleanTitle = title || "";
        if (typeof href === "object" && href !== null) {
            cleanHref = href.href;
            cleanAlt = href.text || "";
            cleanTitle = href.title || "";
        }
        const safeHref = escapeHTML(cleanHref || "");
        const safeAlt = escapeHTML(cleanAlt || "Image");
        const safeTitle = escapeHTML(cleanTitle || "");

        return `
        <div class="ai-img-frame" data-state="generating" data-src="${safeHref}">
            <div class="ai-img-placeholder">
                <div class="ai-img-dots"></div>
                <div class="ai-img-sweep"></div>
                <span class="ai-img-size">1024 × 1024</span>
            </div>
            <img class="ai-img-el" src="${safeHref}" alt="${safeAlt}" title="${safeTitle}" loading="eager" />
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

    return `<details class="thought-box" open${rawDur ? ` data-duration="${escapeHTML(rawDur)}"` : ''}><summary class="thought-summary"><span class="thought-header">${brainSvg}<span class="thought-label">Thought for ${escapeHTML(durLabel)}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body"><div class="thought-content">${innerFormatted}</div></div></details>`;
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

export function parseMarkdown(text) {
    if (!text) return "";

    const { thoughtHtml, content } = extractThoughtAndContent(text);
    let parsedContent = "";
    if (content) {
        if (typeof marked !== "undefined" && typeof marked.parse === "function") {
            try {
                parsedContent = marked.parse(content);
            } catch (e) {
                parsedContent = escapeHTML(content);
            }
        } else {
            parsedContent = escapeHTML(content);
        }
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
            USE_PROFILES: { html: true, svg: true },
            ADD_TAGS: ["details", "summary", "svg", "path", "polyline", "line"],
            ADD_ATTR: [
                "target", "rel", "class", "data-code", "data-chart", 
                "data-state", "data-src", "sandbox", "srcdoc", "loading", "style",
                "open", "viewBox", "stroke", "stroke-width", "fill",
                "stroke-linecap", "stroke-linejoin", "d", "data-duration"
            ]
        });
    }
    return combined;
}

export function bindAIImageCards(container, immediate = false) {
    if (!container) return;
    const frames = container.querySelectorAll(".ai-img-frame");
    frames.forEach(frame => {
        if (frame.dataset.bound) return;
        frame.dataset.bound = "true";

        const img = frame.querySelector(".ai-img-el");
        const sizeBadge = frame.querySelector(".ai-img-size");

        const updateSize = () => {
            if (img && img.naturalWidth && img.naturalHeight) {
                if (sizeBadge) sizeBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
                frame.style.setProperty("--img-ar", `${img.naturalWidth} / ${img.naturalHeight}`);
            }
        };

        if (img) {
            if (img.complete && img.naturalWidth > 0) {
                updateSize();
            } else {
                img.addEventListener("load", updateSize, { once: true });
            }
        }

        if (immediate || frame.dataset.state === "ready") {
            frame.dataset.state = "ready";
            return;
        }

        const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) {
            frame.dataset.state = "ready";
            return;
        }

        // 3-mask sequence (~2.1 seconds total):
        // Passes 1 & 2: 0ms - 1400ms (outline + grey dots sweep)
        // Pass 3: 1400ms - 2100ms (3rd mask sweep reveals image)
        // Ready: 2100ms (placeholder vanishes, pure flat image remains)
        setTimeout(() => {
            if (frame.dataset.state !== "ready") {
                frame.dataset.state = "revealing";
            }
        }, 1400);

        setTimeout(() => {
            frame.dataset.state = "ready";
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
    if (typeof renderMathInElement === "function") {
        renderMathInElement(container, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "\\[", right: "\\]", display: true },
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false }
            ],
            throwOnError: false,
            strict: false
        });
    }
}
