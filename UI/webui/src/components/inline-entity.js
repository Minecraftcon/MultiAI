/**
 * MultiAI Universal Inline Entity Module
 * =======================================
 * Universally imported for inserting and formatting inline entity chips in chat:
 * [icon][text](background highlight)
 * 
 * Used for:
 * - Selected UI Elements ([button.followup-item], [#search-input], etc.)
 * - Skills ([android-cli], [deep-research], etc.)
 * - Generic inline selections ([selection])
 * 
 * In Chat:
 * Renders inline directly within the message sentence flow:
 * "This [button.followup-item] does not look that good"
 * "Use this [android-cli] skill and [ultra-design] skill"
 */

import { escapeHTML } from "../utils/dom.js";
import { state } from "../state.js";

// Session entity store: entityKey -> { type, id, label, data, timestamp }
export const inlineEntityStore = new Map();

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
    // Also index without leading hash or dot if applicable
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
 * Get all entities of a specific type (e.g. 'element' or 'skill')
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
 * Technical SVG primitive icons (no external dependency, pixel-crisp)
 */
function getEntityIconSvg(type) {
    if (type === "skill") {
        // Technical 4-point star/diamond icon
        return `<svg class="entity-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="8 1.5 10 6 14.5 8 10 10 8 14.5 6 10 1.5 8 6 6 8 1.5"/></svg>`;
    }
    // Default: technical pointer / cursor arrow for elements & selections
    return `<svg class="entity-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 2.5l4.5 10.5 1.8-4.7 4.7-1.8L2.5 2.5z"/></svg>`;
}

/**
 * Determine if a token inside brackets represents a skill
 */
function isSkillToken(token, knownSkills = []) {
    const clean = token.toLowerCase();
    // 1. Direct check in entity store
    const stored = inlineEntityStore.get(clean);
    if (stored && stored.type === "skill") return true;

    // 2. Check against catalog / loaded skills in state
    const allSkills = (state && state.skills) || knownSkills || [];
    for (const s of allSkills) {
        if ((s.id && s.id.toLowerCase() === clean) || (s.name && s.name.toLowerCase() === clean)) {
            return true;
        }
    }
    return false;
}

/**
 * Determine if a token inside brackets represents a UI element selector
 */
function isElementToken(token) {
    const clean = token.trim();
    if (!clean) return false;

    // 1. Explicit prefix
    if (clean.startsWith("element:") || clean.startsWith("el:") || clean.startsWith("selector:")) return true;

    // 2. Direct check in entity store
    const stored = getEntity(clean);
    if (stored && stored.type === "element") return true;

    // 3. Common CSS selector patterns: #id, .class, tag.class, tag#id, button[attr]
    if (clean.startsWith("#") || clean.startsWith(".")) return true;
    if (/^[a-zA-Z0-9_\-]+[.#][a-zA-Z0-9_\-]+/.test(clean)) return true;
    if (/^(?:button|div|span|input|form|a|nav|header|footer|section|main|aside|table|ul|li|p|h[1-6])(?:[.#:][a-zA-Z0-9_\-]+)?$/i.test(clean)) return true;
    if (clean.toLowerCase() === "selection") return true;

    return false;
}

/**
 * Formats user message text so recognized entity tokens ([...])
 * are replaced with inline [icon][text](background highlight) chips.
 */
export function formatMessageWithInlineEntities(rawText, activeSkills = []) {
    if (!rawText) return "";

    let escaped = escapeHTML(rawText);

    // 1. Replace bracketed entity tokens: [ selection ], [button.followup-item], [android-cli]
    escaped = escaped.replace(/\[\s*([^\]\n\r]+?)\s*\]/g, (match, rawInner) => {
        const inner = rawInner.trim();
        if (!inner) return match;

        let type = null;
        let displayLabel = inner;

        if (inner.startsWith("element:") || inner.startsWith("el:")) {
            type = "element";
            displayLabel = inner.replace(/^(?:element|el):/, "").trim();
        } else if (inner.startsWith("skill:")) {
            type = "skill";
            displayLabel = inner.replace(/^skill:/, "").trim();
        } else if (isSkillToken(inner, activeSkills)) {
            type = "skill";
        } else if (isElementToken(inner)) {
            type = "element";
        } else {
            // Check if explicitly registered in store
            const stored = getEntity(inner);
            if (stored) {
                type = stored.type || "element";
                displayLabel = stored.label || inner;
            }
        }

        if (!type) {
            // Leave standard markdown brackets (e.g. citations, math) untouched
            return match;
        }

        const iconSvg = getEntityIconSvg(type);
        const titleAttr = type === "element" ? `Inspected element: ${displayLabel}` : `Skill: ${displayLabel}`;

        return `<span class="chat-inline-entity entity-${type}" data-entity-type="${type}" data-entity-id="${displayLabel}" title="${escapeHTML(titleAttr)}">${iconSvg}<span class="entity-text">${displayLabel}</span></span>`;
    });

    // 2. Backward compatibility for legacy skill tokens (> skill-id)
    const skillsList = (state && state.skills) || activeSkills || [];
    for (const skill of skillsList) {
        const idEscaped = escapeHTML(skill.id).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const pattern = `(?:^|(?<=\\s))(?:&gt;|\\>)\\s*(${idEscaped})(?=\\s|$)`;
        const regex = new RegExp(pattern, "gi");
        escaped = escaped.replace(regex, () => {
            const iconSvg = getEntityIconSvg("skill");
            return `<span class="chat-inline-entity entity-skill" data-entity-type="skill" data-entity-id="${skill.id}" title="Skill: ${skill.id}">${iconSvg}<span class="entity-text">${escapeHTML(skill.id)}</span></span>`;
        });
    }

    return escaped;
}

/**
 * Extracts entities mentioned in a prompt text (for LLM context assembly)
 */
export function extractEntitiesFromText(rawText) {
    const elements = [];
    const skills = [];
    if (!rawText) return { elements, skills };

    const regex = /\[\s*([^\]\n\r]+?)\s*\]/g;
    let match;
    const seenElements = new Set();
    const seenSkills = new Set();

    while ((match = regex.exec(rawText)) !== null) {
        let token = match[1].trim();
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
 * Reset active entities for new session
 */
export function clearInlineEntityStore() {
    inlineEntityStore.clear();
}
