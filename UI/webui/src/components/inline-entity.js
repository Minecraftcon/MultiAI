/**
 * MultiAI Universal Inline Entity Module
 * =======================================
 * Universally imported for inserting and formatting inline entity chips in chat.
 * 
 * Clean, minimalist design:
 * - NO random glyphs or emoji in text (pure clean text).
 * - NO icons in the inline chips (pure text label).
 * - Neutral monochrome highlighting adhering strictly to color hierarchy:
 *   subtle off-white/bone #F4F4F2 in light mode, neutral rgba(255,255,255,0.06) in dark mode.
 * - Atomic deletion: backspacing at or inside an entity chip deletes the whole chip at once.
 */

import { escapeHTML } from "../utils/dom.js";
import { state } from "../state.js";

// Session entity store: entityKey -> { type, id, label, data, timestamp }
export const inlineEntityStore = new Map();

/**
 * Clean complex or hashed selectors into human-readable display labels
 */
export function formatElementDisplayLabel(selector, tagName = "") {
    if (!selector) return "selection";
    const sel = String(selector).trim();
    if (sel.toLowerCase() === "selection") return "selection";

    // If it's a simple tag or ID (#main, button, etc.), keep it
    if (/^[a-zA-Z0-9_-]+$/.test(sel) || /^#[a-zA-Z0-9_-]+$/.test(sel)) {
        return sel;
    }

    // Strip hashed CSS module class suffixes: e.g. .button-module-scss-module__4uGPlW__buttonLabel -> .buttonLabel
    let cleaned = sel.replace(/(\.)?[a-zA-Z0-9_-]+(?:module|scss|css)__[a-zA-Z0-9_-]+__([a-zA-Z0-9_-]+)/g, "$1$2");
    // Also strip generic webpack hashes: e.g. .button__3x9a1 -> .button
    cleaned = cleaned.replace(/__([a-zA-Z0-9]{5,})/g, "");

    // If cleaned selector is still very long, shorten to tag + principal class or "selection"
    if (cleaned.length > 36) {
        const parts = cleaned.split(/\s*>\s*|\s+/);
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length <= 36) {
            cleaned = lastPart;
        } else {
            cleaned = tagName ? `${tagName.toLowerCase()}.selection` : "selection";
        }
    }

    return cleaned || "selection";
}

/**
 * Register an entity in the universal store
 */
export function registerEntity(type, id, data = {}) {
    if (!id) return null;
    const cleanId = String(id).trim();
    const entry = {
        type: type || "element",
        id: cleanId,
        label: data.label || cleanId,
        data: data.data || data,
        timestamp: Date.now()
    };
    inlineEntityStore.set(cleanId.toLowerCase(), entry);
    if (cleanId.startsWith("#") || cleanId.startsWith(".")) {
        inlineEntityStore.set(cleanId.slice(1).toLowerCase(), entry);
    }
    return entry;
}

/**
 * Retrieve an entity from the store
 */
export function getEntity(id) {
    if (!id) return null;
    const cleanId = String(id).trim().toLowerCase();
    return inlineEntityStore.get(cleanId) ||
           inlineEntityStore.get(cleanId.replace(/^[#.]/, "")) ||
           null;
}

/**
 * Get all entities of a specific type
 */
export function getAllEntities(type) {
    const list = [];
    const seen = new Set();
    for (const entry of inlineEntityStore.values()) {
        if (!type || entry.type === type) {
            if (!seen.has(entry.id)) {
                seen.add(entry.id);
                list.push(entry);
            }
        }
    }
    return list;
}

/**
 * Universal insertion function:
 * Inserts the entity chip token [label] at the user's cursor position in the composer textarea.
 */
export function insertInlineEntity({ type, id, label, data = {}, textareaId = "input" }) {
    const input = document.getElementById(textareaId);
    if (!input) return;

    const displayLabel = label || id || (type === "element" ? "selection" : "skill");
    const cleanId = id || displayLabel;

    // Register in global entity store
    registerEntity(type, cleanId, { label: displayLabel, data });

    const token = `[${displayLabel}] `;

    const val = input.value || "";
    const selStart = (typeof input.selectionStart === "number" && input.selectionStart >= 0)
        ? input.selectionStart
        : val.length;
    const selEnd = (typeof input.selectionEnd === "number" && input.selectionEnd >= 0)
        ? input.selectionEnd
        : selStart;

    const textBefore = val.slice(0, selStart);
    const textAfter = val.slice(selEnd);

    // If there is an incomplete query or prefix before cursor (e.g. "/" or ">" or "[" or "@"), replace it cleanly
    const match = textBefore.match(/(?:^|\s)(?:\[|\/|>|@)([a-zA-Z0-9_.:#\-]*)$/);
    let newVal = "";
    let newCursorPos = 0;

    if (match) {
        const hasLeadingSpace = match[0].startsWith(" ");
        const matchIndex = match.index + (hasLeadingSpace ? 1 : 0);
        const prefix = textBefore.slice(0, matchIndex);
        newVal = prefix + token + textAfter.trimStart();
        newCursorPos = prefix.length + token.length;
    } else {
        const needsSpace = textBefore.length > 0 && !textBefore.endsWith(" ");
        const prefix = textBefore + (needsSpace ? " " : "");
        newVal = prefix + token + textAfter;
        newCursorPos = prefix.length + token.length;
    }

    input.value = newVal;
    input.focus();
    if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(newCursorPos, newCursorPos);
    }

    // Trigger auto-resize & input event handlers
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Determine if a token represents a skill
 */
function isSkillToken(token, knownSkills = []) {
    const clean = token.toLowerCase();
    const stored = inlineEntityStore.get(clean);
    if (stored && stored.type === "skill") return true;

    const allSkills = (state && state.skills) || knownSkills || [];
    for (const s of allSkills) {
        if ((s.id && s.id.toLowerCase() === clean) || (s.name && s.name.toLowerCase() === clean)) {
            return true;
        }
    }
    return false;
}

/**
 * Determine if a token represents a UI element selector
 */
function isElementToken(token) {
    const clean = token.trim();
    if (!clean) return false;

    if (clean.startsWith("element:") || clean.startsWith("el:") || clean.startsWith("selector:")) return true;
    const stored = getEntity(clean);
    if (stored && stored.type === "element") return true;

    if (clean.startsWith("#") || clean.startsWith(".")) return true;
    if (/^[a-zA-Z0-9_\-]+[.#][a-zA-Z0-9_\-]+/.test(clean)) return true;
    if (/^(?:button|div|span|input|form|a|nav|header|footer|section|main|aside|table|ul|li|p|h[1-6])(?:[.#:][a-zA-Z0-9_\-]+)?$/i.test(clean)) return true;
    if (clean.toLowerCase() === "selection") return true;

    return false;
}

/**
 * Formats user message text so recognized entity tokens
 * are replaced with clean, icon-free inline entity chips adhering to the color hierarchy.
 */
export function formatMessageWithInlineEntities(rawText, activeSkills = []) {
    if (!rawText) return "";

    let escaped = escapeHTML(rawText);

    // 1. Replace bracketed entity tokens: [ selection ], [button.followup-item], [android-cli]
    escaped = escaped.replace(/\[\s*([^\]\n\r]+?)\s*\]/g, (match, rawInner) => {
        let inner = rawInner.trim();
        if (!inner) return match;

        let type = null;

        if (inner.startsWith("element:") || inner.startsWith("el:")) {
            type = "element";
            inner = inner.replace(/^(?:element|el):/, "").trim();
        } else if (inner.startsWith("skill:")) {
            type = "skill";
            inner = inner.replace(/^skill:/, "").trim();
        } else if (isElementToken(inner)) {
            type = "element";
        } else if (isSkillToken(inner, activeSkills)) {
            type = "skill";
        } else {
            const stored = getEntity(inner);
            if (stored) {
                type = stored.type || "element";
            }
        }

        if (!type) {
            return match;
        }

        const titleAttr = type === "element" ? `Inspected element: ${inner}` : `Skill: ${inner}`;
        // Clean text-only chip (NO ICONS) adhering to warm monochrome palette
        return `<span class="chat-inline-entity entity-${type}" data-entity-type="${type}" data-entity-id="${inner}" title="${escapeHTML(titleAttr)}"><span class="entity-text">${inner}</span></span>`;
    });

    // 2. Backward compatibility for legacy skill tokens (> skill-id)
    const skillsList = (state && state.skills) || activeSkills || [];
    for (const skill of skillsList) {
        const idEscaped = escapeHTML(skill.id).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const pattern = `(?:^|(?<=\\s))(?:&gt;|\\>)\\s*(${idEscaped})(?=\\s|$)`;
        const regex = new RegExp(pattern, "gi");
        escaped = escaped.replace(regex, () => {
            return `<span class="chat-inline-entity entity-skill" data-entity-type="skill" data-entity-id="${skill.id}" title="Skill: ${skill.id}"><span class="entity-text">${escapeHTML(skill.id)}</span></span>`;
        });
    }

    return escaped;
}

/**
 * Extracts entities mentioned in a prompt text (for LLM context assembly).
 */
export function extractEntitiesFromText(rawText) {
    const elements = [];
    const skills = [];
    if (!rawText) return { elements, skills };

    const seenElements = new Set();
    const seenSkills = new Set();

    const bracketRegex = /\[\s*([^\]\n\r]+?)\s*\]/g;
    let m;
    while ((m = bracketRegex.exec(rawText)) !== null) {
        let token = m[1].trim();
        let explicitType = null;

        if (token.startsWith("element:") || token.startsWith("el:")) {
            explicitType = "element";
            token = token.replace(/^(?:element|el):/, "").trim();
        } else if (token.startsWith("skill:")) {
            explicitType = "skill";
            token = token.replace(/^skill:/, "").trim();
        }

        const stored = getEntity(token);
        const type = explicitType || (stored ? stored.type : null) || (isSkillToken(token) ? "skill" : (isElementToken(token) ? "element" : null));

        if (type === "element" && !seenElements.has(token.toLowerCase())) {
            seenElements.add(token.toLowerCase());
            elements.push({
                type: "element",
                id: token,
                name: token,
                elementData: stored?.data || { selector: token, tagName: token }
            });
        } else if (type === "skill" && !seenSkills.has(token.toLowerCase())) {
            seenSkills.add(token.toLowerCase());
            const allSkills = (state && state.skills) || [];
            const found = allSkills.find(s => s.id && s.id.toLowerCase() === token.toLowerCase());
            skills.push(found || stored?.data || { id: token, name: token });
        }
    }

    return { elements, skills };
}

/**
 * Clean entity bracket wrappers from prompt text before sending to LLM
 */
export function cleanPromptText(rawText) {
    if (!rawText) return "";
    let clean = rawText;

    // Strip brackets: "[encode-ccres-database]" -> "encode-ccres-database"
    clean = clean.replace(/\[\s*([^\]\n\r]+?)\s*\]/g, "$1");
    // Strip leading / or >
    clean = clean.replace(/(?:^|\s)(?:\/|&gt;|\\>)\s*([a-zA-Z0-9_\-]+)(?=\s|$)/g, " $1 ");

    return clean.replace(/\s+/g, " ").trim();
}

/**
 * Enables atomic removal of entity tokens [token] in the textarea.
 * When the user presses Backspace or Delete near or inside a token, the entire token
 * is removed in a single keystroke ("skills should be removable at once").
 */
export function bindAtomicEntityDeletion(inputEl) {
    if (!inputEl || inputEl._atomicDeletionBound) return;
    inputEl._atomicDeletionBound = true;

    inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const val = inputEl.value;
            const selStart = inputEl.selectionStart;
            const selEnd = inputEl.selectionEnd;
            if (selStart !== selEnd) return; // Allow normal range deletion

            const textBefore = val.slice(0, selStart);

            // 1. Cursor is immediately after a bracketed token (e.g. "[android-cli]" or "[android-cli] ")
            const trailingMatch = textBefore.match(/(?:^|\s)(\[[^\]\n\r]+\]\s?)$/);
            if (trailingMatch) {
                e.preventDefault();
                const tokenLen = trailingMatch[1].length;
                const newPos = selStart - tokenLen;
                inputEl.value = val.slice(0, newPos) + val.slice(selStart);
                inputEl.setSelectionRange(newPos, newPos);
                inputEl.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }

            // 2. Cursor is inside a bracketed token: [and|roid-cli]
            const lastOpen = textBefore.lastIndexOf("[");
            if (lastOpen !== -1 && !textBefore.slice(lastOpen).includes("]")) {
                const nextClose = val.indexOf("]", selStart);
                if (nextClose !== -1 && !val.slice(selStart, nextClose).includes("[")) {
                    e.preventDefault();
                    const endPos = (val[nextClose + 1] === " ") ? nextClose + 2 : nextClose + 1;
                    inputEl.value = val.slice(0, lastOpen) + val.slice(endPos);
                    inputEl.setSelectionRange(lastOpen, lastOpen);
                    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
                    return;
                }
            }
        } else if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const val = inputEl.value;
            const selStart = inputEl.selectionStart;
            const selEnd = inputEl.selectionEnd;
            if (selStart !== selEnd) return;

            const textAfter = val.slice(selStart);
            // Cursor is immediately before a bracketed token: |[android-cli]
            const leadingMatch = textAfter.match(/^(\[[^\]\n\r]+\]\s?)/);
            if (leadingMatch) {
                e.preventDefault();
                const tokenLen = leadingMatch[1].length;
                inputEl.value = val.slice(0, selStart) + val.slice(selStart + tokenLen);
                inputEl.setSelectionRange(selStart, selStart);
                inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }
    });
}

/**
 * Reset active entities for new session
 */
export function clearInlineEntityStore() {
    inlineEntityStore.clear();
}
