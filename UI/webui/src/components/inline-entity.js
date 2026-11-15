/**
 * MultiAI Universal Inline Entity Module
 * =======================================
 * Universally imported for inserting and formatting inline entity chips in chat:
 * [icon][text](background highlight)
 * 
 * Supports:
 * - Selected UI Elements (⌖ button.followup-item, ⌖ selection, etc.)
 * - Skills (⚛ encode-ccres-database, 🔲 antigravity-guide, 🤖 android-cli, etc.)
 * - Generic inline selections
 * 
 * Flow:
 * - In Composer input: renders clean unbracketed icon + name (e.g. "⚛ encode-ccres-database")
 *   with real-time live background highlight in composerHighlighter.
 * - In Chat bubbles: renders as styled inline chips with icon, text, and pastel background highlight.
 * - For LLM backend: extracts full context (<user_selected_ui_element> & activated skills).
 */

import { escapeHTML } from "../utils/dom.js";
import { state } from "../state.js";

// Session entity store: entityKey -> { type, id, label, data, timestamp }
export const inlineEntityStore = new Map();

/**
 * Determine the appropriate Unicode glyph for an entity
 */
export function getEntityGlyph(type, id, data = {}) {
    if (type === "element") {
        return "⌖"; // Clean DevTools position / target selector crosshair
    }

    const cleanId = String(id || "").toLowerCase();

    // Science, Bio, Chemistry, Database skills -> Atom ⚛
    if (/database|alphafold|chem|bio|protein|genome|gene|pdb|dna|rna|blast|uniprot|ncbi|variant|encode|clinical|clinvar|gnomad|gtex|ols|jaspar|openfda|reactome|string|unibind|molecular/.test(cleanId)) {
        return "⚛";
    }

    // Guides, Primers, Docs, Architecture, Customization -> Code Box 🔲
    if (/guide|primer|docs|reference|customization|architecture|manual|system/.test(cleanId)) {
        return "🔲";
    }

    // Mobile & Android skills -> 🤖
    if (/android|mobile|compose/.test(cleanId)) {
        return "🤖";
    }

    // Design, UI, Frontend -> ◈
    if (/design|style|theme|css|frontend|minimalist|taste|visual/.test(cleanId)) {
        return "◈";
    }

    // Research & Search -> 🔍
    if (/research|search|literature|arxiv|pubmed/.test(cleanId)) {
        return "🔍";
    }

    // Default skill glyph -> ⚡
    return "⚡";
}

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
        glyph: data.glyph || getEntityGlyph(type, cleanId, data),
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
 * Inserts the entity chip token (e.g. "⚛ encode-ccres-database " or "⌖ selection ")
 * directly at the user's cursor position in the composer textarea.
 */
export function insertInlineEntity({ type, id, label, data = {}, textareaId = "input" }) {
    const input = document.getElementById(textareaId);
    if (!input) return;

    const displayLabel = label || id || (type === "element" ? "selection" : "skill");
    const cleanId = id || displayLabel;
    const glyph = getEntityGlyph(type, cleanId, data);

    // Register in global entity store
    registerEntity(type, cleanId, { label: displayLabel, data, glyph });

    // Clean unbracketed entity token matching proper format: [glyph][text]
    const token = `${glyph} ${displayLabel} `;

    const val = input.value || "";
    const selStart = (typeof input.selectionStart === "number" && input.selectionStart >= 0)
        ? input.selectionStart
        : val.length;
    const selEnd = (typeof input.selectionEnd === "number" && input.selectionEnd >= 0)
        ? input.selectionEnd
        : selStart;

    const textBefore = val.slice(0, selStart);
    const textAfter = val.slice(selEnd);

    // If there is an incomplete query or prefix before cursor (e.g. "/" or ">" or "[" or "@" or an entity glyph), replace it cleanly
    const match = textBefore.match(/(?:^|\s)(?:\[|\/|>|@|⚛|🔲|🤖|◈|🔍|⚡|⌖)([a-zA-Z0-9_.:#\-]*)$/);
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

    // Trigger auto-resize & input event handlers so live syntax highlighter updates immediately
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
 * Technical SVG primitive icons (no external dependency, pixel-crisp)
 */
function getEntityIconSvg(type, glyph = "") {
    if (glyph === "⚛") {
        // Technical Atom SVG
        return `<svg class="entity-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/><ellipse cx="8" cy="8" rx="7" ry="3" transform="rotate(30 8 8)"/><ellipse cx="8" cy="8" rx="7" ry="3" transform="rotate(-30 8 8)"/></svg>`;
    }
    if (glyph === "🔲") {
        // Technical Window / Code Box SVG
        return `<svg class="entity-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><polyline points="5.5 6.5 4 8 5.5 9.5"/><polyline points="10.5 6.5 12 8 10.5 9.5"/></svg>`;
    }
    if (type === "element" || glyph === "⌖") {
        // DevTools Target Crosshair SVG
        return `<svg class="entity-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5"/><line x1="8" y1="1" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="15"/><line x1="1" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="15" y2="8"/></svg>`;
    }
    // Default Skill SVG: technical 4-point star
    return `<svg class="entity-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="8 1.5 10 6 14.5 8 10 10 8 14.5 6 10 1.5 8 6 6 8 1.5"/></svg>`;
}

/**
 * Formats user message text so recognized entity tokens
 * (e.g. "⚛ encode-ccres-database", "🔲 antigravity-guide", "⌖ selection", or "[...]")
 * are replaced with inline [icon][text](background highlight) chips.
 */
export function formatMessageWithInlineEntities(rawText, activeSkills = []) {
    if (!rawText) return "";

    let escaped = escapeHTML(rawText);

    // 1. Replace unbracketed glyph entities: (⚛|🔲|🤖|◈|🔍|⚡)\s*([a-zA-Z0-9_\-]+)
    escaped = escaped.replace(/(?:^|(?<=\s))(⚛|🔲|🤖|◈|🔍|⚡)\s*([a-zA-Z0-9_\-]+)(?=\s|$)/g, (match, glyph, skillId) => {
        const iconSvg = getEntityIconSvg("skill", glyph);
        return `<span class="chat-inline-entity entity-skill" data-entity-type="skill" data-entity-id="${skillId}" title="Skill: ${skillId}">${iconSvg}<span class="entity-text">${skillId}</span></span>`;
    });

    // 2. Replace unbracketed element entities: ⌖\s*([^\s\]\n\r]+)
    escaped = escaped.replace(/(?:^|(?<=\s))⌖\s*([^\s\]\n\r]+)(?=\s|$)/g, (match, selector) => {
        const iconSvg = getEntityIconSvg("element", "⌖");
        return `<span class="chat-inline-entity entity-element" data-entity-type="element" data-entity-id="${selector}" title="Inspected element: ${selector}">${iconSvg}<span class="entity-text">${selector}</span></span>`;
    });

    // 3. Replace bracketed entity tokens: [ selection ], [button.followup-item], [android-cli] (backwards compat)
    escaped = escaped.replace(/\[\s*([^\]\n\r]+?)\s*\]/g, (match, rawInner) => {
        let inner = rawInner.trim();
        if (!inner) return match;

        let type = null;
        let glyph = "";

        // Check for glyph inside bracket
        const glyphMatch = inner.match(/^(⚛|🔲|🤖|◈|🔍|⚡|⌖)\s*(.+)$/);
        if (glyphMatch) {
            glyph = glyphMatch[1];
            inner = glyphMatch[2].trim();
        }

        if (inner.startsWith("element:") || inner.startsWith("el:")) {
            type = "element";
            inner = inner.replace(/^(?:element|el):/, "").trim();
        } else if (inner.startsWith("skill:")) {
            type = "skill";
            inner = inner.replace(/^skill:/, "").trim();
        } else if (glyph === "⌖" || isElementToken(inner)) {
            type = "element";
        } else if (glyph || isSkillToken(inner, activeSkills)) {
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

        glyph = glyph || getEntityGlyph(type, inner);
        const iconSvg = getEntityIconSvg(type, glyph);
        const titleAttr = type === "element" ? `Inspected element: ${inner}` : `Skill: ${inner}`;

        return `<span class="chat-inline-entity entity-${type}" data-entity-type="${type}" data-entity-id="${inner}" title="${escapeHTML(titleAttr)}">${iconSvg}<span class="entity-text">${inner}</span></span>`;
    });

    // 4. Backward compatibility for legacy skill tokens (> skill-id)
    const skillsList = (state && state.skills) || activeSkills || [];
    for (const skill of skillsList) {
        const idEscaped = escapeHTML(skill.id).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const pattern = `(?:^|(?<=\\s))(?:&gt;|\\>)\\s*(${idEscaped})(?=\\s|$)`;
        const regex = new RegExp(pattern, "gi");
        escaped = escaped.replace(regex, () => {
            const glyph = getEntityGlyph("skill", skill.id);
            const iconSvg = getEntityIconSvg("skill", glyph);
            return `<span class="chat-inline-entity entity-skill" data-entity-type="skill" data-entity-id="${skill.id}" title="Skill: ${skill.id}">${iconSvg}<span class="entity-text">${escapeHTML(skill.id)}</span></span>`;
        });
    }

    return escaped;
}

/**
 * Extracts entities mentioned in a prompt text (for LLM context assembly).
 * Supports glyph-prefixed ("⚛ skill-id", "⌖ element"), bracketed ("[skill-id]"), and slash/arrow formats.
 */
export function extractEntitiesFromText(rawText) {
    const elements = [];
    const skills = [];
    if (!rawText) return { elements, skills };

    const seenElements = new Set();
    const seenSkills = new Set();

    // 1. Extract glyph skills: (⚛|🔲|🤖|◈|🔍|⚡)\s*([a-zA-Z0-9_\-]+)
    const skillGlyphRegex = /(?:^|\s)(?:⚛|🔲|🤖|◈|🔍|⚡)\s*([a-zA-Z0-9_\-]+)(?=\s|$)/g;
    let m;
    while ((m = skillGlyphRegex.exec(rawText)) !== null) {
        const skillId = m[1].trim();
        if (!seenSkills.has(skillId.toLowerCase())) {
            seenSkills.add(skillId.toLowerCase());
            const allSkills = (state && state.skills) || [];
            const found = allSkills.find(s => s.id && s.id.toLowerCase() === skillId.toLowerCase());
            skills.push(found || getEntity(skillId)?.data || { id: skillId, name: skillId });
        }
    }

    // 2. Extract glyph elements: ⌖\s*([^\s\]\n\r]+)
    const elGlyphRegex = /(?:^|\s)⌖\s*([^\s\]\n\r]+)(?=\s|$)/g;
    while ((m = elGlyphRegex.exec(rawText)) !== null) {
        const selector = m[1].trim();
        if (!seenElements.has(selector.toLowerCase())) {
            seenElements.add(selector.toLowerCase());
            const stored = getEntity(selector);
            elements.push({
                type: "element",
                id: selector,
                name: selector,
                elementData: stored?.data || { selector, tagName: selector }
            });
        }
    }

    // 3. Extract bracketed entities: [ ... ]
    const bracketRegex = /\[\s*([^\]\n\r]+?)\s*\]/g;
    while ((m = bracketRegex.exec(rawText)) !== null) {
        let token = m[1].trim();
        let explicitType = null;

        // Check for glyph inside bracket
        const glyphMatch = token.match(/^(⚛|🔲|🤖|◈|🔍|⚡|⌖)\s*(.+)$/);
        if (glyphMatch) {
            token = glyphMatch[2].trim();
            if (glyphMatch[1] === "⌖") explicitType = "element";
            else explicitType = "skill";
        }

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
 * Clean entity glyphs and bracket wrappers from prompt text before sending to LLM
 */
export function cleanPromptText(rawText) {
    if (!rawText) return "";
    let clean = rawText;

    // Strip glyphs before entity names: "⚛ encode-ccres-database" -> "encode-ccres-database"
    clean = clean.replace(/(?:^|\s)(?:⚛|🔲|🤖|◈|🔍|⚡)\s*([a-zA-Z0-9_\-]+)(?=\s|$)/g, " $1 ");
    // Strip element crosshair glyph: "⌖ button.followup-item" -> "button.followup-item"
    clean = clean.replace(/(?:^|\s)⌖\s*([^\s\]\n\r]+)(?=\s|$)/g, " $1 ");
    // Strip brackets: "[encode-ccres-database]" -> "encode-ccres-database"
    clean = clean.replace(/\[\s*([^\]\n\r]+?)\s*\]/g, "$1");
    // Strip leading / or >
    clean = clean.replace(/(?:^|\s)(?:\/|&gt;|\\>)\s*([a-zA-Z0-9_\-]+)(?=\s|$)/g, " $1 ");

    return clean.replace(/\s+/g, " ").trim();
}

/**
 * Reset active entities for new session
 */
export function clearInlineEntityStore() {
    inlineEntityStore.clear();
}
