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

    console.log("✓ ALL ASK QUESTION TOOL TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
