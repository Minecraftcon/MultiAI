/* =========================================================
   SKILLS MENU COMPONENT (SLASH COMMAND / POPUP MENU)
   Loaded from ~/.agents/skills and workspace .agents/skills.
   Shows on top of the chatbox when typing /
   ========================================================= */

import { renderIcons } from "../utils/icons.js";
import { escapeHTML } from "../utils/dom.js";

let allSkills = [];
let activeSkills = [];
let isMenuOpen = false;
let currentFilter = "";
let selectedIndex = 0;
let menuContainer = null;
let fetchPromise = null;

/**
 * Fetch skills list from server API.
 */
export async function fetchSkills() {
    if (fetchPromise) return fetchPromise;
    fetchPromise = (async () => {
        try {
            const res = await fetch("/api/skills");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            allSkills = Array.isArray(data.skills) ? data.skills : [];
            if (typeof window !== "undefined") {
                window.__knownSkills = allSkills;
            }
        } catch (err) {
            console.warn("[SKILLS] Could not load skills catalog:", err.message);
            allSkills = [];
            if (typeof window !== "undefined") {
                window.__knownSkills = [];
            }
        } finally {
            fetchPromise = null;
        }
        return allSkills;
    })();
    return fetchPromise;
}

/**
 * Get the currently active skills.
 */
export function getActiveSkills() {
    return [...activeSkills];
}

/**
 * Check whether the skills menu is currently open.
 */
export function isSkillsMenuOpen() {
    return isMenuOpen && !!document.getElementById("skillsMenuContainer");
}

/**
 * Clear all active skills.
 */
export function clearActiveSkills() {
    activeSkills = [];
    renderSkillPills();
}

/**
 * Remove a specific active skill by id.
 */
export function removeActiveSkill(skillId) {
    activeSkills = activeSkills.filter(s => s.id !== skillId);
    renderSkillPills();
}

/**
 * Add a skill to active skills.
 */
export function addActiveSkill(skill) {
    if (!skill || !skill.id) return;
    if (!activeSkills.some(s => s.id === skill.id)) {
        activeSkills.push(skill);
        renderSkillPills();
    }
}

/**
 * Renders active skill pills inside #composerModePills.
 */
export function renderSkillPills() {
    const pillsContainer = document.getElementById("composerModePills");
    if (!pillsContainer) return;

    // Remove existing skill pills
    pillsContainer.querySelectorAll(".skill-pill").forEach(p => p.remove());

    if (activeSkills.length > 0) {
        pillsContainer.style.display = "flex";

        for (const skill of activeSkills) {
            const pillEl = document.createElement("div");
            pillEl.className = "composer-mode-pill active skill-pill";
            pillEl.dataset.skillId = skill.id;
            pillEl.title = `Active Skill: ${skill.name} - ${skill.description} (Click X to remove)`;
            pillEl.innerHTML = `
                <i data-lucide="sparkles"></i>
                <span>Skill: ${escapeHTML(skill.name)}</span>
                <button type="button" class="mode-pill-del" aria-label="Remove skill" title="Remove skill">
                    <i data-lucide="x"></i>
                </button>
            `;

            const delBtn = pillEl.querySelector(".mode-pill-del");
            if (delBtn) {
                delBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    removeActiveSkill(skill.id);
                });
            }

            pillsContainer.appendChild(pillEl);
        }
        renderIcons(pillsContainer);
    } else {
        // If no other pills exist (e.g. DeepSearch), hide container
        if (pillsContainer.children.length === 0) {
            pillsContainer.style.display = "none";
        }
    }
}

/**
 * Get filtered skills based on search query.
 */
function getFilteredSkills(query = "") {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(s => {
        const nameMatch = (s.name || "").toLowerCase().includes(q) || (s.id || "").toLowerCase().includes(q);
        const descMatch = (s.description || "").toLowerCase().includes(q);
        return nameMatch || descMatch;
    });
}

/**
 * Opens or updates the skills menu on top of the chatbox.
 */
export async function openSkillsMenu(query = "") {
    if (allSkills.length === 0) {
        await fetchSkills();
    }

    currentFilter = query;
    const filtered = getFilteredSkills(query);
    selectedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, filtered.length - 1));

    const dock = document.getElementById("chatboxDock");
    if (!dock || !dock.parentNode) return;

    if (!menuContainer) {
        menuContainer = document.createElement("div");
        menuContainer.id = "skillsMenuContainer";
        menuContainer.className = "skills-menu-container";
        dock.parentNode.insertBefore(menuContainer, dock);
    }

    isMenuOpen = true;

    const countText = `${filtered.length} skill${filtered.length === 1 ? "" : "s"}`;
    const headerHtml = `
        <div class="skills-menu-header">
            <div class="skills-menu-header-left">
                <i data-lucide="sparkles"></i>
                <span>Skills (${countText})</span>
            </div>
            <div class="skills-menu-header-right">
                Type to filter · ↑↓ to navigate · Enter to select · Esc to close
            </div>
        </div>
    `;

    let itemsHtml = "";
    if (filtered.length === 0) {
        itemsHtml = `<div class="skills-menu-empty">No skills matching "${escapeHTML(query)}"</div>`;
    } else {
        itemsHtml = `<div class="skills-menu-list" role="listbox">` +
            filtered.map((s, idx) => {
                const isSelected = idx === selectedIndex;
                const badgeLabel = s.source === "workspace" ? "project" : "agent";
                return `
                    <div class="skills-menu-item ${isSelected ? "is-selected" : ""}" 
                         data-skill-id="${escapeHTML(s.id)}" 
                         data-index="${idx}"
                         role="option" 
                         aria-selected="${isSelected ? "true" : "false"}">
                        <div class="skills-menu-item-top">
                            <span class="skills-menu-item-name">${escapeHTML(s.name)}</span>
                            <span class="skills-menu-item-badge">${badgeLabel}</span>
                        </div>
                        <div class="skills-menu-item-desc">${escapeHTML(s.description)}</div>
                    </div>
                `;
            }).join("") +
            `</div>`;
    }

    menuContainer.innerHTML = headerHtml + itemsHtml;
    renderIcons(menuContainer);

    // Prevent mousedown on menu from blurring the textarea
    menuContainer.addEventListener("mousedown", (e) => {
        const input = document.getElementById("input");
        if (e.target !== input) {
            e.preventDefault();
        }
    });

    // Bind item click listeners
    menuContainer.querySelectorAll(".skills-menu-item").forEach(item => {
        item.addEventListener("mousedown", (e) => {
            e.preventDefault();
        });
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const skillId = item.dataset.skillId;
            const skill = allSkills.find(s => s.id === skillId);
            if (skill) {
                chooseSkill(skill);
            }
        });
    });

    // Ensure selected item is scrolled into view
    const selectedItem = menuContainer.querySelector(".skills-menu-item.is-selected");
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
    }
}

/**
 * Closes the skills menu.
 */
export function closeSkillsMenu() {
    isMenuOpen = false;
    currentFilter = "";
    selectedIndex = 0;
    if (menuContainer && menuContainer.parentNode) {
        menuContainer.parentNode.removeChild(menuContainer);
        menuContainer = null;
    }
}

/**
 * Parses on-text skills from a user message string.
 * Supports slash commands like "/android-cli hello" or "/android-cli /tools prompt".
 * Returns { skills: Array<Skill>, cleanText: string, rawText: string }
 */
export function parseOnTextSkills(text) {
    if (!text || typeof text !== "string") {
        return { skills: [], cleanText: text || "", rawText: text || "" };
    }

    if (allSkills.length === 0) {
        fetchSkills();
    }

    const matchedSkills = [];
    const skillIdsSeen = new Set();

    // Match skills against catalog
    for (const skill of allSkills) {
        const id = (skill.id || "").toLowerCase();
        const name = (skill.name || "").toLowerCase();
        if (!id) continue;

        const idEsc = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const nameEsc = name ? name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') : null;
        const variants = nameEsc && nameEsc !== idEsc ? `${idEsc}|${nameEsc}` : idEsc;

        // Match with leading >, leading /, or delimited token
        const pattern = `(?:^|\\s)(?:\\/|&gt;|\\>)?\\s*(${variants})(?=\\s|$)`;
        const regex = new RegExp(pattern, "i");

        if (regex.test(text) && !skillIdsSeen.has(skill.id)) {
            skillIdsSeen.add(skill.id);
            matchedSkills.push(skill);
        }
    }

    // Clean text by stripping out recognized skill tokens so model receives clean prompt
    let cleanText = text;
    for (const skill of matchedSkills) {
        const idEsc = skill.id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const nameEsc = (skill.name || "").replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const variants = nameEsc && nameEsc !== idEsc ? `${idEsc}|${nameEsc}` : idEsc;
        const pattern = `(?:^|\\s)(?:\\/|&gt;|\\>)?\\s*(?:${variants})(?=\\s|$)`;
        cleanText = cleanText.replace(new RegExp(pattern, "gi"), " ");
    }

    cleanText = cleanText.replace(/\s+/g, " ").trim();

    return {
        skills: matchedSkills,
        cleanText: cleanText,
        rawText: text
    };
}

/**
 * Formats message text so recognized skill tokens are highlighted cleanly without slashes.
 */
export function formatMessageWithSkillHighlights(rawText, matchedSkills) {
    if (!rawText) return "";
    if (!matchedSkills || matchedSkills.length === 0) {
        return escapeHTML(rawText);
    }

    let escaped = escapeHTML(rawText);

    for (const skill of matchedSkills) {
        const idEscaped = escapeHTML(skill.id).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const nameEscaped = escapeHTML(skill.name || "").replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const variants = nameEscaped && nameEscaped !== idEscaped ? `${idEscaped}|${nameEscaped}` : idEscaped;

        // Match leading / or > or bare skill token and format as clean pill without slash
        const pattern = `(?:^|(?<=\\s))(?:\\/|&gt;|\\>)?\\s*(?:${variants})(?=\\s|$)`;
        const regex = new RegExp(pattern, "gi");

        escaped = escaped.replace(regex, () => {
            return `<span class="skill-highlight"><span class="skill-highlight-prefix">&gt;</span>${escapeHTML(skill.id)}</span>`;
        });
    }

    return escaped;
}

/**
 * Builds the Option C system prompt block for activated skills.
 * Instructs the model about the active skill and its full path on disk.
 */
export function buildSkillsSystemPrompt(skills) {
    if (!skills || skills.length === 0) return "";
    const count = skills.length;
    const skillNoun = count === 1 ? "skill" : "skills";
    const header = `The user has instructed ${count} ${skillNoun}. The full path to them has been given here:`;
    const paths = skills.map(s => {
        const fullPath = s.filePath || `~/.agents/skills/${s.id}/SKILL.md`;
        return `${s.name || s.id} : ${fullPath}`;
    }).join("\n");

    return `\n\n[ACTIVATED SKILLS]\n${header}\n${paths}\n\nInspect the skill file using your file reading tool to follow its guidelines.`;
}

let isSelectingSkill = false;

/**
 * Choose a skill from the menu: inserts the skill cleanly on-text (e.g. > android-cli )
 */
export function chooseSkill(skill) {
    if (!skill) return;

    isSelectingSkill = true;
    closeSkillsMenu();

    const input = document.getElementById("input");
    if (input) {
        const val = input.value || "";
        const selStart = (typeof input.selectionStart === "number" && input.selectionStart >= 0)
            ? input.selectionStart
            : val.length;
        const textBeforeCursor = val.slice(0, selStart);
        const textAfterCursor = val.slice(selStart);

        // Match the slash or query right before cursor (e.g. "/and" or "> and" or "and")
        const match = textBeforeCursor.match(/(?:^|\s)(?:\/|&gt;|\\>)?([a-zA-Z0-9_\-]*)$/);
        // Clean representation without slash: "> skill-id "
        const skillText = `> ${skill.id} `;

        let newVal = "";
        let newCursorPos = 0;

        if (match) {
            const hasLeadingSpace = match[0].startsWith(" ");
            const matchIndex = match.index + (hasLeadingSpace ? 1 : 0);
            const prefix = textBeforeCursor.slice(0, matchIndex);
            newVal = prefix + skillText + textAfterCursor.trimStart();
            newCursorPos = prefix.length + skillText.length;
        } else {
            newVal = skillText + val.trimStart();
            newCursorPos = skillText.length;
        }

        input.value = newVal;
        input.focus();
        if (typeof input.setSelectionRange === "function") {
            input.setSelectionRange(newCursorPos, newCursorPos);
        }

        // Trigger input resize & highlighter sync
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    setTimeout(() => {
        isSelectingSkill = false;
    }, 120);
}

/**
 * Initialize skills menu event listeners and load skills.
 */
export function initSkillsMenu() {
    // 1. Fetch skills from server upfront
    fetchSkills();

    // 2. Watch input in chatbox
    const input = document.getElementById("input");
    if (!input) return;

    const handleInput = () => {
        if (isSelectingSkill) {
            if (isMenuOpen) closeSkillsMenu();
            return;
        }

        const val = input.value || "";
        const selStart = (typeof input.selectionStart === "number" && input.selectionStart > 0)
            ? input.selectionStart
            : val.length;
        const textBeforeCursor = val.slice(0, selStart);

        // ONLY open skills menu when actively typing after a slash command right before cursor (without space)
        const match = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);

        if (match) {
            const query = match[1] || "";
            openSkillsMenu(query);
        } else {
            if (isMenuOpen) {
                closeSkillsMenu();
            }
        }
    };

    input.addEventListener("input", handleInput);
    input.addEventListener("keyup", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") return;
        handleInput();
    });

    // Intercept keyboard navigation and selection in capture phase so other listeners (e.g. ChatBox Enter send) don't fire
    input.addEventListener("keydown", (e) => {
        // Tab autocompletion: if cursor is at a slash query, pressing Tab always autocompletes to plain text
        if (e.key === "Tab") {
            const val = input.value || "";
            const selStart = (typeof input.selectionStart === "number" && input.selectionStart >= 0)
                ? input.selectionStart
                : val.length;
            const textBeforeCursor = val.slice(0, selStart);
            const match = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);

            if (match) {
                const query = match[1] || "";
                const matches = getFilteredSkills(query);
                if (matches.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const targetSkill = (isMenuOpen && menuContainer)
                        ? (matches[selectedIndex] || matches[0])
                        : matches[0];
                    chooseSkill(targetSkill);
                    return;
                }
            }
        }

        if (!isMenuOpen || !menuContainer) return;

        const filtered = getFilteredSkills(currentFilter);

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (filtered.length > 0) {
                selectedIndex = (selectedIndex + 1) % filtered.length;
                openSkillsMenu(currentFilter);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (filtered.length > 0) {
                selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
                openSkillsMenu(currentFilter);
            }
        } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (filtered.length > 0) {
                const skill = filtered[selectedIndex];
                if (skill) {
                    chooseSkill(skill);
                }
            } else {
                closeSkillsMenu();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closeSkillsMenu();
        }
    }, { capture: true });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (!isMenuOpen) return;
        if (menuContainer && !menuContainer.contains(e.target) && e.target !== input) {
            closeSkillsMenu();
        }
    });
}
