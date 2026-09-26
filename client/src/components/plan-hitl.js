/* =========================================================
   PLAN HUMAN-IN-THE-LOOP (HITL) APPROVAL COMPONENT
   Modular detection, rendering, and interaction for Build Mode plans
   ========================================================= */
import { state } from "../state/index.js";
import { chatbox } from "./chatbox.js";

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

    // If in build mode, either explicit structure or asking to proceed on plan triggers the HITL strip
    if (isBuild && (hasStructure || hasConfirmation)) {
        return true;
    }
    return hasStructure && hasConfirmation;
}

/**
 * Renders the interactive HITL action strip into the assistant message element.
 *
 * @param {HTMLElement} aiMessageElement
 * @param {string} rawText
 * @param {boolean} isDone
 * @param {Object} [session]
 */
export function renderPlanApprovalActions(aiMessageElement, rawText, isDone, session = null) {
    if (!aiMessageElement || !isDone) return;

    // Check if already rendered
    let strip = aiMessageElement.querySelector(".plan-hitl-strip");
    const activeSession = session || (state.currentChatId ? state.chatSessions[state.currentChatId] : null);

    if (!isPlanApprovalRequired(rawText, activeSession)) {
        if (strip) strip.remove();
        return;
    }

    if (strip) return; // Already present

    strip = document.createElement("div");
    strip.className = "plan-hitl-strip";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "Plan approval actions");

    strip.innerHTML = `
        <div class="plan-hitl-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="plan-hitl-icon" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span>Review Plan Before Execution</span>
        </div>
        <div class="plan-hitl-buttons">
            <button type="button" class="plan-proceed-btn" title="Approve this plan and begin execution" aria-label="Proceed with Plan">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Proceed with Plan</span>
            </button>
            <button type="button" class="plan-modify-btn" title="Request adjustments to this plan" aria-label="Request Changes">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <span>Request Changes</span>
            </button>
        </div>
    `;

    const finalContent = aiMessageElement.querySelector(".final-content") || aiMessageElement;
    finalContent.appendChild(strip);
}

/**
 * Handles clicks on plan HITL action buttons.
 *
 * @param {MouseEvent} e
 * @returns {boolean} True if handled
 */
export function handlePlanApprovalClick(e) {
    const proceedBtn = e.target.closest(".plan-proceed-btn");
    if (proceedBtn) {
        if (state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating) {
            return true;
        }
        proceedBtn.disabled = true;
        proceedBtn.classList.add("is-proceeding");
        const span = proceedBtn.querySelector("span");
        if (span) span.textContent = "Starting execution...";
        
        chatbox.setValue("Proceed with the implementation plan.");
        chatbox.triggerSend();
        return true;
    }

    const modifyBtn = e.target.closest(".plan-modify-btn");
    if (modifyBtn) {
        chatbox.setValue("Please adjust the plan: ");
        chatbox.focus();
        return true;
    }

    return false;
}
