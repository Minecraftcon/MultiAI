/* =========================================================
   ELEMENT INSPECTOR & PICKER (JETSKI PREVIEW PARITY)
   Hover highlights, popover specs, accessibility & attachment
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { insertInlineEntity, formatElementDisplayLabel } from "./inline-entity.js";
import { showToast } from "./bottom-sheet.js";

let isActive = false;
let overlayEl = null;
let tooltipEl = null;
let barEl = null;
let currentTargetEl = null;

function rgbToHex(rgb) {
    if (!rgb) return "";
    const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m) return rgb;
    const r = parseInt(m[1], 10).toString(16).padStart(2, "0");
    const g = parseInt(m[2], 10).toString(16).padStart(2, "0");
    const b = parseInt(m[3], 10).toString(16).padStart(2, "0");
    if (m[4] !== undefined && parseFloat(m[4]) < 1) {
        const a = Math.round(parseFloat(m[4]) * 255).toString(16).padStart(2, "0");
        return `#${r}${g}${b}${a}`.toUpperCase();
    }
    return `#${r}${g}${b}`.toUpperCase();
}

function buildElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";
    if (el.id) {
        return `#${el.id}`;
    }

    const tag = el.tagName.toLowerCase();
    const validClasses = Array.from(el.classList || [])
        .filter(c => !c.startsWith("element-inspector") && !c.startsWith("is-"))
        .slice(0, 2);

    if (validClasses.length > 0) {
        return `${tag}.${validClasses.join(".")}`;
    }

    if (el.parentElement) {
        const parentSel = buildElementSelector(el.parentElement);
        const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
            const idx = siblings.indexOf(el) + 1;
            return `${parentSel} > ${tag}:nth-of-type(${idx})`;
        }
        return `${parentSel} > ${tag}`;
    }

    return tag;
}

function extractElementData(el) {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const selector = buildElementSelector(el);

    const a11yName = el.getAttribute("aria-label") ||
                     el.getAttribute("title") ||
                     el.getAttribute("alt") ||
                     el.getAttribute("placeholder") ||
                     (el.innerText ? el.innerText.trim().slice(0, 48) : "");

    const a11yRole = el.getAttribute("role") || el.tagName.toLowerCase();
    const isFocusable = el.tabIndex >= 0 || ["a", "button", "input", "textarea", "select"].includes(el.tagName.toLowerCase());

    const tag = el.tagName.toLowerCase();
    const validClasses = Array.from(el.classList || [])
        .filter(c => !c.startsWith("element-inspector") && !c.startsWith("is-"))
        .slice(0, 2)
        .map(c => "." + c)
        .join("");
    const tagDisplay = `${tag}${validClasses}`;
    const dimsDisplay = `${rect.width.toFixed(1)} × ${rect.height.toFixed(1)}`;

    return {
        selector,
        tagName: el.tagName,
        tagDisplay,
        dimsDisplay,
        id: el.id || "",
        classList: Array.from(el.classList || []),
        rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: parseFloat(rect.width.toFixed(2)),
            height: parseFloat(rect.height.toFixed(2))
        },
        styles: {
            color: rgbToHex(cs.color),
            backgroundColor: rgbToHex(cs.backgroundColor),
            font: `${cs.fontSize} ${cs.fontFamily.split(",")[0].replace(/['"]/g, "")}`,
            padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`.replace(/px/g, "px "),
            margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`.replace(/px/g, "px ")
        },
        accessibility: {
            name: a11yName,
            role: a11yRole,
            focusable: isFocusable
        },
        outerHTML: (el.outerHTML || "").slice(0, 1500)
    };
}

export function isInspectionActive() {
    return isActive;
}

export function initElementInspector() {
    if (typeof document === "undefined") return;

    if (!overlayEl) {
        overlayEl = document.createElement("div");
        overlayEl.id = "elementInspectorOverlay";
        overlayEl.className = "element-inspector-overlay";
        document.body.appendChild(overlayEl);
    }

    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.id = "elementInspectorTooltip";
        tooltipEl.className = "element-inspector-tooltip";
        document.body.appendChild(tooltipEl);
    }

    if (!barEl) {
        barEl = document.createElement("div");
        barEl.id = "elementInspectorBar";
        barEl.className = "element-inspector-bar";
        barEl.style.display = "none";
        barEl.innerHTML = `
            <span>Selecting element...</span>
            <button type="button" class="inspector-cancel-btn" id="elementInspectorCancelBtn">Cancel</button>
        `;
        document.body.appendChild(barEl);

        barEl.querySelector("#elementInspectorCancelBtn")?.addEventListener("click", () => {
            stopElementInspection();
        });
    }

    // Listen for elements selected or hovered inside embedded browser iframes
    window.addEventListener("message", (e) => {
        if (!e.data) return;

        if (e.data.type === "MULTIAI_ELEMENT_SELECTED" && e.data.elementData) {
            stopElementInspection();
            const elData = e.data.elementData;
            const displayLabel = formatElementDisplayLabel(elData.selector, elData.tagName);
            insertInlineEntity({
                type: "element",
                id: elData.selector,
                label: displayLabel,
                data: elData
            });
        } else if (e.data.type === "MULTIAI_ELEMENT_HOVER" && e.data.elementData) {
            if (!isActive) return;
            const iframe = document.getElementById("rightPanelBrowserFrame");
            if (!iframe) return;
            const ifr = iframe.getBoundingClientRect();
            const r = e.data.rect || e.data.elementData?.rect;
            if (!r) return;

            const globalRect = {
                top: ifr.top + r.top,
                left: ifr.left + r.left,
                width: r.width,
                height: r.height,
                bottom: ifr.top + r.top + r.height,
                right: ifr.left + r.left + r.width
            };
            renderInspectorTooltipContent(e.data.elementData, globalRect);
        } else if (e.data.type === "MULTIAI_ELEMENT_UNHOVER") {
            if (overlayEl) overlayEl.style.display = "none";
            if (tooltipEl) tooltipEl.style.display = "none";
        }
    });

    // Keyboard shortcut ESC to cancel
    window.addEventListener("keydown", (e) => {
        if (isActive && e.key === "Escape") {
            stopElementInspection();
        }
    }, true);
}

function handleMouseMove(e) {
    if (!isActive) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    // Ignore inspector's own elements and ignore browser iframe (iframe emits its own MULTIAI_ELEMENT_HOVER)
    if (el === overlayEl || el === tooltipEl || el === barEl || barEl?.contains(el) || el.tagName === "IFRAME" || el.id === "rightPanelBrowserFrame") {
        return;
    }

    currentTargetEl = el;
    const rect = el.getBoundingClientRect();
    const data = extractElementData(el);
    renderInspectorTooltipContent(data, rect);
}

function renderInspectorTooltipContent(data, rect) {
    if (!overlayEl || !tooltipEl) return;

    const tagDisplay = data.tagDisplay || (data.tagName ? data.tagName.toLowerCase() : "element");
    const dimsDisplay = data.dimsDisplay || `${rect.width.toFixed(1)} × ${rect.height.toFixed(1)}`;

    const csColor = data.styles?.rawColor || data.styles?.color || "#ffffff";
    const colorHex = data.styles?.color || "#FFFFFF";
    const csBg = data.styles?.rawBg || data.styles?.backgroundColor || "transparent";
    const bgHex = data.styles?.backgroundColor || "transparent";
    const fontStr = data.styles?.font || "inherit";
    const paddingStr = data.styles?.padding || "0px";

    const a11yName = data.accessibility?.name || "";
    const a11yRole = data.accessibility?.role || tagDisplay.split(".")[0];
    const isFocusable = Boolean(data.accessibility?.focusable);

    // Position overlay box
    overlayEl.style.display = "block";
    overlayEl.style.top = `${rect.top}px`;
    overlayEl.style.left = `${rect.left}px`;
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;

    // Tooltip HTML matching Jetski Preview Popover
    tooltipEl.innerHTML = `
        <div class="inspector-tt-header">
            <span class="inspector-tt-tag">${escapeHTML(tagDisplay)}</span>
            <span class="inspector-tt-dims">${dimsDisplay}</span>
        </div>
        <div class="inspector-tt-specs">
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Color</span>
                <span class="inspector-tt-val">
                    <span class="inspector-swatch" style="background:${csColor};"></span>
                    ${colorHex}
                </span>
            </div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Font</span>
                <span class="inspector-tt-val" title="${escapeHTML(fontStr)}">${escapeHTML(fontStr)}</span>
            </div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Background</span>
                <span class="inspector-tt-val">
                    <span class="inspector-swatch" style="background:${csBg};"></span>
                    ${bgHex}
                </span>
            </div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Padding</span>
                <span class="inspector-tt-val">${paddingStr}</span>
            </div>
        </div>
        <div class="inspector-tt-a11y">
            <div class="inspector-tt-a11y-hdr">ACCESSIBILITY</div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Name</span>
                <span class="inspector-tt-val" title="${escapeHTML(a11yName)}">${escapeHTML(a11yName || "—")}</span>
            </div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Role</span>
                <span class="inspector-tt-val">${escapeHTML(a11yRole)}</span>
            </div>
            <div class="inspector-tt-row">
                <span class="inspector-tt-lbl">Keyboard-focusable</span>
                <span class="inspector-tt-val ${isFocusable ? "a11y-yes" : "a11y-no"}">${isFocusable ? "✓" : "—"}</span>
            </div>
        </div>
    `;

    tooltipEl.style.display = "block";

    // Position tooltip: prefer directly above the element; if not enough space, place below
    const ttRect = tooltipEl.getBoundingClientRect();
    let top = rect.top - ttRect.height - 8;
    if (top < 10) {
        top = rect.bottom + 8;
    }
    // Clamp within viewport
    top = Math.max(10, Math.min(window.innerHeight - ttRect.height - 10, top));
    let left = Math.max(10, Math.min(window.innerWidth - ttRect.width - 10, rect.left));

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
}

function handleClick(e) {
    if (!isActive) return;

    // Ignore cancel button
    if (barEl && barEl.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const target = currentTargetEl || document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    const data = extractElementData(target);
    stopElementInspection();
    const displayLabel = formatElementDisplayLabel(data.selector, data.tagName);
    insertInlineEntity({
        type: "element",
        id: data.selector,
        label: displayLabel,
        data: data
    });
}

export function startElementInspection() {
    initElementInspector();
    if (isActive) return;

    isActive = true;
    document.body.classList.add("is-element-inspecting");

    if (barEl) barEl.style.display = "flex";

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("click", handleClick, true);

    // Notify any embedded browser iframe so elements inside iframe can also be inspected
    const iframe = document.getElementById("rightPanelBrowserFrame");
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage({ type: "MULTIAI_TOGGLE_ELEMENT_INSPECTOR", active: true }, "*");
        } catch (_) {}
    }
}

export function stopElementInspection() {
    if (!isActive) return;
    isActive = false;

    document.body.classList.remove("is-element-inspecting");

    if (overlayEl) overlayEl.style.display = "none";
    if (tooltipEl) tooltipEl.style.display = "none";
    if (barEl) barEl.style.display = "none";
    currentTargetEl = null;

    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("click", handleClick, true);

    const iframe = document.getElementById("rightPanelBrowserFrame");
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage({ type: "MULTIAI_TOGGLE_ELEMENT_INSPECTOR", active: false }, "*");
        } catch (_) {}
    }
}

export function toggleElementInspection() {
    isActive ? stopElementInspection() : startElementInspection();
}

