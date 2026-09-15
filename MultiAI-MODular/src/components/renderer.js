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

export function parseMarkdown(text) {
    let parsed = "";
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        try {
            parsed = marked.parse(text);
        } catch (e) {
            parsed = escapeHTML(text);
        }
    } else {
        parsed = escapeHTML(text);
    }
    if (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function") {
        return DOMPurify.sanitize(parsed, {
            ADD_ATTR: [
                "target", "rel", "class", "data-code", "data-chart", 
                "data-state", "data-src", "sandbox", "srcdoc", "loading", "style"
            ]
        });
    }
    return parsed;
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
