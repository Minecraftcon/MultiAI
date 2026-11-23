const assert = require("assert");

console.log("=== Running Compactor Model Resolution & Persistence Tests ===");

// 1. Test resolveCompactorModel logic in simulated browser environment
{
    // Mock browser storage
    const mockSessionStorage = {};
    const mockLocalStorage = {};

    global.sessionStorage = {
        getItem: (k) => mockSessionStorage[k] || null,
        setItem: (k, v) => { mockSessionStorage[k] = String(v); },
        removeItem: (k) => { delete mockSessionStorage[k]; },
        clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); }
    };

    global.localStorage = {
        getItem: (k) => mockLocalStorage[k] || null,
        setItem: (k, v) => { mockLocalStorage[k] = String(v); },
        removeItem: (k) => { delete mockLocalStorage[k]; },
        clear: () => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); }
    };

    // Inline exact resolution algorithm from compactor.js for pure Node testing
    function resolveCompactorModel(currentModel) {
        try {
            if (typeof sessionStorage !== "undefined") {
                const raw = sessionStorage.getItem("local_gen_opts");
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed.compactor_model === "string" && parsed.compactor_model.trim()) {
                        return parsed.compactor_model.trim();
                    }
                }
            }
        } catch (_) {}

        try {
            if (typeof localStorage !== "undefined") {
                const stored = localStorage.getItem("multiai_compactor_model");
                if (stored && typeof stored === "string" && stored.trim()) {
                    return stored.trim();
                }
            }
        } catch (_) {}

        return currentModel;
    }

    const localModel = "local:Qwen3.8-27B-Instruct";

    // Test A: No override configured -> falls back to current model
    assert.strictEqual(
        resolveCompactorModel(localModel),
        localModel,
        "Should return active model when no compactor configured"
    );

    // Test B: Stored in localStorage -> returns custom compactor
    localStorage.setItem("multiai_compactor_model", "gemini-2.5-flash");
    assert.strictEqual(
        resolveCompactorModel(localModel),
        "gemini-2.5-flash",
        "Should return custom compactor from localStorage"
    );

    // Test C: Stored in sessionStorage local_gen_opts -> takes precedence over localStorage
    sessionStorage.setItem("local_gen_opts", JSON.stringify({
        temperature: 0.7,
        compactor_model: "deepseek-chat"
    }));
    assert.strictEqual(
        resolveCompactorModel(localModel),
        "deepseek-chat",
        "sessionStorage local_gen_opts should take precedence over localStorage"
    );

    // Test D: Whitespace or empty compactor_model in sessionStorage falls back to localStorage or currentModel
    sessionStorage.setItem("local_gen_opts", JSON.stringify({
        compactor_model: "   "
    }));
    assert.strictEqual(
        resolveCompactorModel(localModel),
        "gemini-2.5-flash",
        "Whitespace in sessionStorage should fall back to localStorage"
    );

    localStorage.removeItem("multiai_compactor_model");
    assert.strictEqual(
        resolveCompactorModel(localModel),
        localModel,
        "Whitespace in both should fall back to currentModel"
    );

    console.log("✔ resolveCompactorModel logic passed all cases");
}

// 2. Test server config route preserves compactor_model in local session
{
    const { getLocalSession, setLocalSession } = require("../src/server/routes/config");

    setLocalSession({
        base_url: "http://localhost:5001",
        api_format: "kobold",
        compactor_model: "claude-3-5-sonnet"
    });

    const session = getLocalSession();
    assert.strictEqual(session.base_url, "http://localhost:5001");
    assert.strictEqual(session.compactor_model, "claude-3-5-sonnet");

    console.log("✔ Server local session compactor_model persistence passed");
}

// 3. Test compactor dropdown populator logic
{
    // Simulate DOM elements
    const mockModelSelectChildren = [
        {
            tagName: "OPTGROUP",
            label: "Google Gemini",
            dataset: { provider: "google" },
            children: [
                { tagName: "OPTION", value: "gemini-2.5-flash", textContent: "Gemini 2.5 Flash", dataset: {} },
                { tagName: "OPTION", value: "gemini-2.5-pro", textContent: "Gemini 2.5 Pro", dataset: {} },
            ]
        },
        {
            tagName: "OPTGROUP",
            label: "Local",
            dataset: { provider: "local" },
            children: [
                { tagName: "OPTION", value: "local:Qwen", textContent: "Qwen [Local]", dataset: { provider: "local" } }
            ]
        },
        {
            tagName: "OPTGROUP",
            label: "Rolling Connect",
            dataset: { provider: "koboldcpp" },
            children: [
                { tagName: "OPTION", value: "__rolling_connect__koboldcpp", textContent: "Connect KoboldCPP…", dataset: { rolling: "true" } }
            ]
        }
    ];

    // Build compactor options mirroring local-connect.js
    const compactorOptions = [];
    const savedCompactor = "gemini-2.5-pro";

    mockModelSelectChildren.forEach(child => {
        if (child.tagName === "OPTGROUP") {
            const groupProvider = child.dataset.provider;
            if (groupProvider === "local" || groupProvider === "koboldcpp") return;

            const group = { label: child.label, options: [] };
            child.children.forEach(opt => {
                if (opt.dataset.rolling === "true" || opt.value.startsWith("__rolling_connect__")) return;
                group.options.push({
                    value: opt.value,
                    textContent: opt.textContent,
                    selected: opt.value === savedCompactor
                });
            });
            if (group.options.length > 0) compactorOptions.push(group);
        }
    });

    assert.strictEqual(compactorOptions.length, 1, "Should filter out local and rolling optgroups");
    assert.strictEqual(compactorOptions[0].label, "Google Gemini");
    assert.strictEqual(compactorOptions[0].options.length, 2);
    assert.strictEqual(compactorOptions[0].options[1].selected, true, "Should pre-select savedCompactor");

    console.log("✔ Compactor select dropdown populator passed");
}

console.log("=== All Compactor Model Tests Passed Successfully ===");
