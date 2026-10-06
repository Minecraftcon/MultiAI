/* =========================================================
   INTERACTIVE QUESTION PROMPT COMPONENT
   Mounts on chatboxDock, prompting user with options, pagination,
   and custom write-in answers directly within composer.
   ========================================================= */

import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";

let activePromptSession = null;

/**
 * Normalizes input arguments into a structured array of questions.
 *
 * @param {Object|Array} payload
 * @returns {Array<Object>}
 */
export function normalizeQuestionsPayload(payload) {
    if (!payload) return [];
    let list = [];
    if (Array.isArray(payload)) {
        list = payload;
    } else if (Array.isArray(payload.questions)) {
        list = payload.questions;
    } else if (payload.question) {
        list = [payload];
    }

    return list.map((q, idx) => {
        let opts = [];
        if (Array.isArray(q.options)) {
            opts = q.options;
        } else if (typeof q.options === "string") {
            opts = q.options.split("\n").map(s => s.trim()).filter(Boolean);
        }
        return {
            id: q.id || `q_${idx}`,
            question: q.question || q.title || `Question ${idx + 1}`,
            options: opts,
            is_multi_select: Boolean(q.is_multi_select || q.multiSelect || q.isMultiSelect),
            allow_custom: q.allow_custom !== false && q.allowCustom !== false
        };
    }).filter(q => q.question && (q.options.length > 0 || q.allow_custom));
}

/**
 * Dismisses any active question prompt if currently visible in the DOM.
 *
 * @param {string} reason
 */
export function dismissQuestionPrompt(reason = "dismissed") {
    if (activePromptSession) {
        activePromptSession.resolve({ status: "cancelled", reason });
        activePromptSession.cleanup();
    }
}

/**
 * Mounts the questionnaire onto the composer dock and returns a Promise
 * that resolves when the user answers or skips.
 *
 * @param {Object|Array} payload
 * @returns {Promise<Object>}
 */
export function promptUserQuestions(payload) {
    // If an existing prompt is already active, dismiss it first
    if (activePromptSession) {
        dismissQuestionPrompt("Replaced by new question prompt");
    }

    const questions = normalizeQuestionsPayload(payload);
    if (questions.length === 0) {
        return Promise.resolve({ status: "skipped", reason: "No questions provided" });
    }

    const dock = document.getElementById("chatboxDock");
    if (!dock) {
        return Promise.resolve({ status: "skipped", reason: "Composer dock not found" });
    }

    return new Promise((resolve) => {
        let currentIndex = 0;
        const total = questions.length;
        const selections = {}; // index -> Set of selected options
        const customValues = {}; // index -> string
        const customActive = {}; // index -> boolean

        for (let i = 0; i < total; i++) {
            selections[i] = new Set();
            customValues[i] = "";
            customActive[i] = false;
        }

        const container = document.createElement("div");
        container.className = "question-prompt-card";

        const cleanup = () => {
            document.removeEventListener("keydown", handleGlobalKey);
            container.classList.add("closing");
            setTimeout(() => {
                if (container.parentNode) container.remove();
            }, 180);
            activePromptSession = null;
        };

        activePromptSession = {
            resolve,
            cleanup
        };

        const renderCurrentQuestion = () => {
            const q = questions[currentIndex];
            const currentSelected = selections[currentIndex];
            const isMulti = q.is_multi_select;
            const isCustomSelected = customActive[currentIndex];

            const paginationHtml = total > 1 ? `
                <div class="question-pagination">
                    <button type="button" class="question-page-btn prev-page-btn" ${currentIndex === 0 ? "disabled" : ""} title="Previous question" aria-label="Previous question">
                        <i data-lucide="chevron-left"></i>
                    </button>
                    <span class="question-page-indicator">${currentIndex + 1}/${total}</span>
                    <button type="button" class="question-page-btn next-page-btn" ${currentIndex === total - 1 ? "disabled" : ""} title="Next question" aria-label="Next question">
                        <i data-lucide="chevron-right"></i>
                    </button>
                </div>
            ` : "";

            let optionsHtml = "";
            q.options.forEach((optText, optIdx) => {
                const isSelected = currentSelected.has(optText);
                optionsHtml += `
                    <div class="question-option-item ${isSelected ? "selected" : ""} ${isMulti ? "is-multi" : ""}" data-opt="${escapeHTML(optText)}">
                        <span class="question-opt-indicator"></span>
                        <span class="question-opt-num">${optIdx + 1}</span>
                        <span class="question-opt-label">${escapeHTML(optText)}</span>
                    </div>
                `;
            });

            let customHtml = "";
            if (q.allow_custom) {
                const customVal = customValues[currentIndex] || "";
                customHtml = `
                    <div class="question-option-item question-custom-option ${isCustomSelected ? "selected" : ""} ${isMulti ? "is-multi" : ""}">
                        <span class="question-opt-indicator"></span>
                        <span class="question-opt-num">${q.options.length + 1}</span>
                        <div class="question-custom-box">
                            <span class="question-opt-label">Write your own answer</span>
                            <input type="text" class="question-custom-input" placeholder="Type custom response…" value="${escapeHTML(customVal)}" ${isCustomSelected ? "" : "style=\"display:none;\""}>
                        </div>
                    </div>
                `;
            }

            const isLast = currentIndex === total - 1;
            const submitLabel = isLast ? "Submit" : "Next";
            const submitIcon = isLast ? "check" : "arrow-right";

            container.innerHTML = `
                <div class="question-header">
                    <div class="question-title-wrap">
                        <div class="question-icon-badge">
                            <i data-lucide="help-circle"></i>
                        </div>
                        <span class="question-title">${escapeHTML(q.question)}</span>
                    </div>
                    ${paginationHtml}
                </div>

                <div class="question-options-list">
                    ${optionsHtml}
                    ${customHtml}
                </div>

                <div class="question-actions-bar">
                    <button type="button" class="question-skip-btn" title="Skip questions">Skip</button>
                    <button type="button" class="question-submit-btn" title="${submitLabel}">
                        <span>${submitLabel}</span>
                        <i data-lucide="${submitIcon}"></i>
                    </button>
                </div>
            `;

            renderIcons(container);

            // Bind Pagination events
            const prevBtn = container.querySelector(".prev-page-btn");
            if (prevBtn) {
                prevBtn.addEventListener("click", () => {
                    if (currentIndex > 0) {
                        currentIndex--;
                        renderCurrentQuestion();
                    }
                });
            }

            const nextBtn = container.querySelector(".next-page-btn");
            if (nextBtn) {
                nextBtn.addEventListener("click", () => {
                    if (currentIndex < total - 1) {
                        currentIndex++;
                        renderCurrentQuestion();
                    }
                });
            }

            // Bind Options Selection
            const optItems = container.querySelectorAll(".question-option-item:not(.question-custom-option)");
            optItems.forEach(item => {
                item.addEventListener("click", () => {
                    const optText = item.dataset.opt;
                    if (isMulti) {
                        if (currentSelected.has(optText)) currentSelected.delete(optText);
                        else currentSelected.add(optText);
                    } else {
                        currentSelected.clear();
                        currentSelected.add(optText);
                        customActive[currentIndex] = false;
                    }
                    renderCurrentQuestion();
                });
            });

            // Bind Custom Write-in
            const customItem = container.querySelector(".question-custom-option");
            const customInput = container.querySelector(".question-custom-input");
            if (customItem && customInput) {
                customItem.addEventListener("click", (e) => {
                    if (e.target === customInput) return;
                    if (isMulti) {
                        customActive[currentIndex] = !customActive[currentIndex];
                    } else {
                        currentSelected.clear();
                        customActive[currentIndex] = true;
                    }
                    renderCurrentQuestion();
                    const inp = container.querySelector(".question-custom-input");
                    if (inp && customActive[currentIndex]) {
                        inp.style.display = "block";
                        inp.focus();
                    }
                });

                customInput.addEventListener("input", (e) => {
                    customValues[currentIndex] = e.target.value;
                    customActive[currentIndex] = true;
                });

                customInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSubmitOrNext();
                    }
                });
            }

            // Bind Skip
            const skipBtn = container.querySelector(".question-skip-btn");
            if (skipBtn) {
                skipBtn.addEventListener("click", () => {
                    cleanup();
                    resolve({
                        status: "skipped",
                        reason: "User skipped answering"
                    });
                });
            }

            // Bind Submit / Next
            const submitBtn = container.querySelector(".question-submit-btn");
            if (submitBtn) {
                submitBtn.addEventListener("click", handleSubmitOrNext);
            }
        };

        const handleSubmitOrNext = () => {
            if (currentIndex < total - 1) {
                currentIndex++;
                renderCurrentQuestion();
                return;
            }

            // All questions reviewed / submitted
            const compiledAnswers = questions.map((q, idx) => {
                const picked = Array.from(selections[idx]);
                const customVal = (customActive[idx] && customValues[idx]?.trim()) ? customValues[idx].trim() : "";

                const formattedList = picked.map(opt => {
                    const optIdx = q.options.indexOf(opt);
                    if (optIdx >= 0 && !/^option\s+\d+/i.test(opt) && !/^\d+[\.\)]\s*/.test(opt)) {
                        return `Option ${optIdx + 1}: ${opt}`;
                    }
                    return opt;
                });
                if (customVal) {
                    formattedList.push(customVal);
                }

                const rawPicked = [...picked];
                if (customVal) rawPicked.push(customVal);

                const answerStr = formattedList.length === 1 
                    ? formattedList[0] 
                    : (formattedList.length > 1 ? formattedList.join(", ") : (customVal || "No preference"));

                return {
                    question: q.question,
                    answer: answerStr,
                    rawSelections: rawPicked
                };
            });

            cleanup();
            resolve({
                status: "answered",
                answers: compiledAnswers
            });
        };

        const handleGlobalKey = (e) => {
            // If typing in input, ignore number keys
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
            if (activeTag === "input" || activeTag === "textarea") {
                if (e.key === "Escape") {
                    cleanup();
                    resolve({ status: "skipped", reason: "User cancelled" });
                }
                return;
            }

            const q = questions[currentIndex];
            const num = parseInt(e.key, 10);
            if (!isNaN(num) && num >= 1 && num <= q.options.length) {
                e.preventDefault();
                const optText = q.options[num - 1];
                if (q.is_multi_select) {
                    if (selections[currentIndex].has(optText)) selections[currentIndex].delete(optText);
                    else selections[currentIndex].add(optText);
                } else {
                    selections[currentIndex].clear();
                    selections[currentIndex].add(optText);
                    customActive[currentIndex] = false;
                }
                renderCurrentQuestion();
            } else if (e.key === "Escape") {
                cleanup();
                resolve({ status: "skipped", reason: "User cancelled" });
            }
        };

        document.addEventListener("keydown", handleGlobalKey);

        // Prepend into dock
        dock.insertBefore(container, dock.firstChild);
        renderCurrentQuestion();
    });
}
