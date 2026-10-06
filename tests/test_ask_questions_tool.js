const assert = require("assert");

async function runTests() {
    console.log("=== Testing ask_question & ask_questions Tool ===");

    // 1. Test server runner tool schema & HITL resolve
    console.log("Test: SERVER_BUILD_TOOLS and answerAgentQuestion in build_agent_runner");
    const runner = require("../src/core/build_agent_runner");
    assert(typeof runner.answerAgentQuestion === "function", "answerAgentQuestion must be exported");

    // 2. Test chat-tool-badges configuration
    console.log("Test: chat-tool-badges for ask_question and ask_questions");
    const badgesModule = await import("../client/src/components/chat-tool-badges.js");
    const { getToolBadgeConfig } = badgesModule;

    const badge1 = getToolBadgeConfig("ask_question", {
        questions: [{ question: "Which styling library?", options: ["Tailwind", "CSS Modules"] }]
    });
    assert.strictEqual(badge1.icon, "help-circle");
    assert.strictEqual(badge1.label, "Asked question");
    assert.strictEqual(badge1.detail, "Which styling library?");
    assert(badge1.displayCmd.includes("Which styling library?"), "displayCmd must include question text");
    assert(badge1.displayCmd.includes("1. Tailwind"), "displayCmd must include option choices");

    const badge2 = getToolBadgeConfig("ask_questions", {
        question: "Should we proceed?"
    });
    assert.strictEqual(badge2.icon, "help-circle");
    assert.strictEqual(badge2.label, "Asked question");
    assert.strictEqual(badge2.detail, "Should we proceed?");

    // 3. Test question prompt normalization
    console.log("Test: normalizeQuestionsPayload in chat-question-prompt");
    const promptModule = await import("../client/src/components/chat-question-prompt.js");
    const { normalizeQuestionsPayload } = promptModule;

    const norm1 = normalizeQuestionsPayload({
        question: "Do you want tests?",
        options: ["Yes", "No"],
        is_multi_select: false
    });
    assert.strictEqual(norm1.length, 1);
    assert.strictEqual(norm1[0].question, "Do you want tests?");
    assert.deepStrictEqual(norm1[0].options, ["Yes", "No"]);
    assert.strictEqual(norm1[0].is_multi_select, false);

    const norm2 = normalizeQuestionsPayload({
        questions: [
            { question: "Q1", options: "Opt A\nOpt B" },
            { question: "Q2", options: ["Opt C", "Opt D"], allow_custom: false }
        ]
    });
    assert.strictEqual(norm2.length, 2);
    assert.deepStrictEqual(norm2[0].options, ["Opt A", "Opt B"]);
    assert.strictEqual(norm2[1].allow_custom, false);

    // 4. Test dom.js formatToolResult
    console.log("Test: formatToolResult in dom.js");
    const domModule = await import("../client/src/utils/dom.js");
    const { formatToolResult } = domModule;

    const answeredResult = formatToolResult({
        status: "answered",
        answers: [
            { question: "Pick framework", answer: "React" },
            { question: "Include TypeScript?", answer: ["Yes", "Strict mode"] }
        ]
    });
    assert(answeredResult.includes("Pick framework"), "Must format single answer");
    assert(answeredResult.includes("React"), "Must include chosen answer");
    assert(answeredResult.includes("Yes, Strict mode"), "Must format multi answer");

    const skippedResult = formatToolResult({
        status: "skipped",
        reason: "User skipped answering"
    });
    assert(skippedResult.includes("Questionnaire was skipped by the user."), "Must format skipped status");

    // 5. Test onToolComplete answer subrow rendering
    console.log("Test: onToolComplete renders answer subrow");
    // Mock document and elements for testing badge-sync.js in Node
    class SimpleMockEl {
        constructor(tag) {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.parentNode = null;
            this._classList = new Set();
            this._textContent = "";
            this._innerHTML = "";
        }
        get parentElement() { return this.parentNode; }
        get classList() {
            return {
                add: (...cls) => cls.forEach(c => this._classList.add(c)),
                remove: (...cls) => cls.forEach(c => this._classList.delete(c)),
                contains: (c) => this._classList.has(c)
            };
        }
        get className() { return Array.from(this._classList).join(" "); }
        set className(v) { this._classList.clear(); if (v) v.split(/\s+/).forEach(c => this._classList.add(c)); }
        get textContent() { return this._textContent; }
        set textContent(v) { this._textContent = String(v); }
        get innerHTML() { return this._innerHTML; }
        set innerHTML(v) { this._innerHTML = String(v); }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        querySelector(selector) {
            const match = (el) => {
                if (selector.startsWith(".") && el.classList.contains(selector.slice(1))) return true;
                if (selector.toUpperCase() === el.tagName) return true;
                return false;
            };
            for (const c of this.children) {
                if (match(c)) return c;
                const found = c.querySelector(selector);
                if (found) return found;
            }
            return null;
        }
    }
    global.document = {
        createElement: (tag) => new SimpleMockEl(tag)
    };

    const badgeSyncModule = await import("../client/src/tools/badge-sync.js");
    const { onToolComplete } = badgeSyncModule;

    const mockBadge = new SimpleMockEl("div");
    mockBadge.className = "search-badge-item clickable-badge";
    const textContainer = new SimpleMockEl("div");
    const labelEl = new SimpleMockEl("span");
    labelEl.className = "search-label";
    labelEl.textContent = "Asked question";
    const queryEl = new SimpleMockEl("span");
    queryEl.className = "search-query";
    queryEl.textContent = "Which framework?";
    textContainer.appendChild(labelEl);
    textContainer.appendChild(queryEl);
    mockBadge.appendChild(textContainer);

    // Call onToolComplete with answered data
    onToolComplete("ask_question", { question: "Which framework?" }, mockBadge, {
        status: "answered",
        answers: [{ question: "Which framework?", answer: "Option 2: React" }]
    });

    assert.strictEqual(labelEl.textContent, "Asked question", "Label must remain 'Asked question'");
    assert.strictEqual(queryEl.textContent, "Which framework?", "Query must remain original question");
    const answerSubrow = mockBadge.querySelector(".badge-answer-subrow");
    assert(answerSubrow, "Answer subrow must be added to badge");
    assert(answerSubrow.innerHTML.includes("Answered"), "Subrow must include 'Answered'");
    assert(answerSubrow.innerHTML.includes("( Option 2: React )"), "Subrow must include formatted answer");

    // Call onToolComplete with skipped data
    const mockBadgeSkipped = new SimpleMockEl("div");
    mockBadgeSkipped.className = "search-badge-item clickable-badge";
    const textContainer2 = new SimpleMockEl("div");
    const labelEl2 = new SimpleMockEl("span");
    labelEl2.className = "search-label";
    labelEl2.textContent = "Asked question";
    const queryEl2 = new SimpleMockEl("span");
    queryEl2.className = "search-query";
    queryEl2.textContent = "Should we continue?";
    textContainer2.appendChild(labelEl2);
    textContainer2.appendChild(queryEl2);
    mockBadgeSkipped.appendChild(textContainer2);

    onToolComplete("ask_question", { question: "Should we continue?" }, mockBadgeSkipped, {
        status: "skipped"
    });

    const skippedSubrow = mockBadgeSkipped.querySelector(".badge-answer-subrow");
    assert(skippedSubrow, "Skipped subrow must be added");
    assert(skippedSubrow.innerHTML.includes("Skipped"), "Subrow must show 'Skipped'");

    console.log("✓ ALL ASK QUESTION TOOL TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
