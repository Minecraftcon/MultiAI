/* =========================================================
   PLAN HUMAN-IN-THE-LOOP (HITL) APPROVAL & CARD COMPONENT
   Renders compact artifact cards in chat (Image 3)
   and launches the fullscreen review modal (Image 1 & 2).
   ========================================================= */
import { state } from "../state/index.js";
import { escapeHTML } from "../utils/dom.js";
import { chatbox } from "./chatbox.js";
import { openPlanModal } from "./plan-modal.js";

const PLAN_STRUCTURE_REGEX = /(##\s*(Implementation\s*Plan|Build\s*Plan|Milestones|Planned\s*Tasks)|\[(BUILD|IMPLEMENTATION)\s*PLAN\]|<plan>|Tasklist-.*\.md)/i;
const PLAN_CONFIRMATION_REGEX = /(proceed\b|ready to (proceed|start|implement)|let me know if (you'd like|this looks good|you want to make changes)|shall i proceed|would you like me to proceed|approve the plan|before i (start|proceed))/i;

/**
 * Checks if the assistant message presents a plan that requires user review/approval.
 *
 * @param {string} text
 * @param {Object} [session]
 * @returns {boolean}
 */
export function isPlanApprovalRequired(text, session = null) {
    if (!text || typeof text !== "string") return false;
    const isBuild = session?.mode === "build" || !!session?.projectId || state.appMode === "build";
    const hasStructure = PLAN_STRUCTURE_REGEX.test(text);
    const hasConfirmation = PLAN_CONFIRMATION_REGEX.test(text);

    if (isBuild && (hasStructure || hasConfirmation)) {
        return true;
    }
    return hasStructure && hasConfirmation;
}

/**
 * Extracts a clean title and summary snippet from the plan markdown.
 *
 * @param {string} text
 * @returns {{ title: string, snippet: string }}
 */
export function extractPlanMetadata(text) {
    if (!text) {
        return { title: "Implementation Plan", snippet: "Click to review the implementation plan in fullscreen." };
    }

    let title = "Implementation Plan";
    const titleMatch = text.match(/#+\s*(Implementation\s*Plan[^\n]*|Build\s*Plan[^\n]*|Task\s*Plan:[^\n]*)/i);
    if (titleMatch) {
        title = titleMatch[1].replace(/^Task\s*Plan:\s*/i, "").trim();
    }

    // Extract first descriptive non-heading, non-code line as preview snippet
    const cleanLines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#") && !line.startsWith("```") && !line.startsWith(">") && !line.startsWith("[") && !/^\d+\.\s/.test(line) && !/^[-*]\s/.test(line));

    let snippet = cleanLines[0] || "Review the proposed phases, milestones, and verification criteria.";
    if (snippet.length > 180) {
        snippet = snippet.slice(0, 180) + "…";
    }

    return { title, snippet };
}

/**
 * Renders the compact Plan Card into the assistant message element.
 *
 * @param {HTMLElement} aiMessageElement
 * @param {string} rawText
 * @param {boolean} isDone
 * @param {Object} [session]
 */
export function renderPlanApprovalActions(aiMessageElement, rawText, isDone, session = null) {
    if (!aiMessageElement || !isDone) return;

    let existingCard = aiMessageElement.querySelector(".plan-card");
    const activeSession = session || (state.currentChatId ? state.chatSessions[state.currentChatId] : null);

    if (!isPlanApprovalRequired(rawText, activeSession)) {
        if (existingCard) existingCard.remove();
        return;
    }

    if (existingCard) return; // Already present

    const { title, snippet } = extractPlanMetadata(rawText);
    const artifactPath = activeSession?.artifactPath || "";

    const card = document.createElement("div");
    card.className = "plan-card";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Implementation Plan");
    // Store markdown in dataset for easy retrieval by click handler
    card._planMarkdown = rawText;
    card._planTitle = title;
    card._artifactPath = artifactPath;

    card.innerHTML = `
        <div class="plan-card-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="plan-card-icon" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span class="plan-card-title">${escapeHTML(title)}</span>
            <span class="plan-card-open-hint" title="Open full screen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </span>
        </div>
        <div class="plan-card-body">
            <p class="plan-card-desc">${escapeHTML(snippet)}</p>
        </div>
        <div class="plan-card-footer">
            <button type="button" class="plan-card-proceed-btn" title="Approve this plan and begin execution" aria-label="Proceed">
                Proceed
            </button>
            <button type="button" class="plan-card-review-btn" title="Review plan in fullscreen with live commenting" aria-label="Review Plan">
                Review Plan ↗
            </button>
        </div>
    `;

    const finalContent = aiMessageElement.querySelector(".final-content") || aiMessageElement;
    finalContent.appendChild(card);
}

/**
 * Handles clicks on plan card elements (delegated from chat container).
 *
 * @param {MouseEvent} e
 * @returns {boolean} True if handled
 */
export function handlePlanApprovalClick(e) {
    const card = e.target.closest(".plan-card");
    if (!card) return false;

    // Fast path: Clicked [ Proceed ] directly inside the card
    const proceedBtn = e.target.closest(".plan-card-proceed-btn");
    if (proceedBtn) {
        if (state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating) {
            return true;
        }
        proceedBtn.disabled = true;
        proceedBtn.textContent = "Starting...";
        chatbox.setValue("Proceed with the implementation plan.");
        chatbox.triggerSend();
        return true;
    }

    // Deep review path: Clicked card or [ Review Plan ↗ ]
    const markdown = card._planMarkdown || "";
    const title = card._planTitle || "Implementation Plan";
    const artifactPath = card._artifactPath || "";

    openPlanModal({
        title,
        markdown,
        artifactPath,
        onProceed: () => {
            chatbox.setValue("Proceed with the implementation plan.");
            chatbox.triggerSend();
        },
        onCommentsSubmit: (prompt) => {
            chatbox.setValue(prompt);
            chatbox.triggerSend();
        }
    });

    return true;
}
