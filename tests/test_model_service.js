const assert = require("assert");

console.log("=== Running Safety Net Tests for Model Service & Vision Capabilities ===");

(async () => {
    const { isModelVisionCapable, availableModels, modelVisionMap, modelProviderMap } = await import("../client/src/services/models.js");

    console.log("Test: isModelVisionCapable default heuristic");
    // 1. Built-in vision model name heuristics
    assert.strictEqual(isModelVisionCapable("gemini-2.5-flash"), true);
    assert.strictEqual(isModelVisionCapable("gemini-1.5-pro"), true);
    assert.strictEqual(isModelVisionCapable("gpt-4o"), true);
    assert.strictEqual(isModelVisionCapable("gpt-4o-mini"), true);
    assert.strictEqual(isModelVisionCapable("claude-3-5-sonnet"), true);
    assert.strictEqual(isModelVisionCapable("claude-3-7-sonnet"), true);
    assert.strictEqual(isModelVisionCapable("my-custom-vision-model"), true);

    // 2. Non-vision model heuristics
    assert.strictEqual(isModelVisionCapable("qwen-2.5-coder-32b"), false);
    assert.strictEqual(isModelVisionCapable("deepseek-r1"), false);
    assert.strictEqual(isModelVisionCapable("llama-3.3-70b-versatile"), false);

    // 3. Fallback when modelId is null/empty and no DOM element
    assert.strictEqual(isModelVisionCapable(null), true);
    assert.strictEqual(isModelVisionCapable(""), true);

    // 4. Explicit override in modelVisionMap takes absolute precedence
    modelVisionMap["custom-override-false"] = false;
    assert.strictEqual(isModelVisionCapable("custom-override-false"), false);

    modelVisionMap["custom-override-true"] = true;
    assert.strictEqual(isModelVisionCapable("custom-override-true"), true);

    console.log("✓ ALL MODEL SERVICE SAFETY NET TESTS PASSED CLEANLY!");
})().catch(err => {
    console.error(err);
    process.exit(1);
});
