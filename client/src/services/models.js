/* =========================================================
   MODELS SERVICE & VISION CAPABILITY MANAGEMENT
   ========================================================= */
import { state } from "../state/index.js";
import { updateModelPickerDisplay } from "../components/model-picker.js";

export let availableModels = [];
export let modelProviderMap = {};
export let modelVisionMap = {};

// Lazy import to avoid circular dependencies
let _localConnect = null;
async function getLocalConnect() {
    if (!_localConnect) {
        _localConnect = await import("../components/local-connect.js");
    }
    return _localConnect;
}

/**
 * Determines whether a given model supports multimodal vision input.
 */
export function isModelVisionCapable(modelId) {
    if (!modelId) {
        if (typeof document !== "undefined") {
            const sel = document.getElementById("modelSelect");
            modelId = sel ? sel.value : null;
        }
    }
    if (!modelId) return true;
    if (typeof modelVisionMap[modelId] === "boolean") {
        return modelVisionMap[modelId];
    }
    const lower = String(modelId).toLowerCase();
    if (lower.startsWith("gemini") || lower.includes("vision") || lower.includes("gpt-4o") || lower.includes("claude-3-5") || lower.includes("claude-3-7")) {
        return true;
    }
    return false;
}

/**
 * Fetches available models from server, populates dropdowns and model picker cache.
 */
export async function loadAvailableModels() {
    if (typeof document === "undefined") return;
    const modelSelect = document.getElementById("modelSelect");
    const cfgStartupLLM = document.getElementById("cfgStartupLLM");
    if (!modelSelect) return;

    try {
        const res = await fetch("/api/models");
        if (!res.ok) return;
        const data = await res.json();
        if (!data.providers || !Array.isArray(data.providers)) return;

        availableModels = [];
        modelProviderMap = {};

        const previousVal = modelSelect.value;
        modelSelect.innerHTML = "";
        if (cfgStartupLLM) cfgStartupLLM.innerHTML = "";

        let defaultModelId = null;

        data.providers.forEach(provider => {
            // Rolling providers: show a "Connect…" entry instead of model list
            if (provider.rolling) {
                const group = document.createElement("optgroup");
                group.label = provider.name;
                group.dataset.provider = provider.id;

                const placeholder = document.createElement("option");
                placeholder.value = `__rolling_connect__${provider.id}`;
                placeholder.textContent = `⚡ Connect ${provider.name}…`;
                placeholder.dataset.provider = provider.id;
                placeholder.dataset.rolling = "true";
                group.appendChild(placeholder);

                modelSelect.appendChild(group);

                // If server already probed this session, auto-reconnect silently
                const isLocalProvider = provider.id === "local" || provider.id === "koboldcpp";
                if (isLocalProvider && provider.connected_base_url) {
                    getLocalConnect().then(lc => {
                        lc.tryLocalAutoReconnect(null).catch(() => {});
                    });
                }
                return;
            }

            if (!provider.models || provider.models.length === 0) return;
            const group = document.createElement("optgroup");
            group.label = provider.name + (provider.available ? "" : " (No Key)");
            if (!provider.available) {
                group.disabled = true;
            }

            const cfgGroup = document.createElement("optgroup");
            cfgGroup.label = group.label;

            provider.models.forEach(model => {
                availableModels.push(model);
                modelProviderMap[model.id] = provider.id;
                modelVisionMap[model.id] = Boolean(model.supports_vision);

                const opt = document.createElement("option");
                opt.value = model.id;
                opt.textContent = model.name + (model.supports_vision ? " [Vision]" : "");
                opt.dataset.provider = provider.id;
                opt.dataset.vision = model.supports_vision ? "true" : "false";
                if (model.default && !defaultModelId) {
                    defaultModelId = model.id;
                }
                group.appendChild(opt);

                if (cfgStartupLLM) {
                    const cfgOpt = opt.cloneNode(true);
                    cfgGroup.appendChild(cfgOpt);
                }
            });

            modelSelect.appendChild(group);
            if (cfgStartupLLM) cfgStartupLLM.appendChild(cfgGroup);
        });

        if (state.currentChatId && state.chatSessions[state.currentChatId]?.model) {
            const curModel = state.chatSessions[state.currentChatId].model;
            if (modelSelect.querySelector(`option[value="${CSS.escape(curModel)}"]`)) {
                modelSelect.value = curModel;
            }
        } else if (previousVal && modelSelect.querySelector(`option[value="${CSS.escape(previousVal)}"]`)) {
            modelSelect.value = previousVal;
        } else if (defaultModelId && modelSelect.querySelector(`option[value="${CSS.escape(defaultModelId)}"]`)) {
            modelSelect.value = defaultModelId;
        }

        if (state.currentChatId && state.chatSessions[state.currentChatId]) {
            state.chatSessions[state.currentChatId].model = modelSelect.value;
            const prov = modelSelect.selectedOptions?.[0]?.dataset?.provider;
            if (prov) state.chatSessions[state.currentChatId].provider = prov;
        }

        updateModelPickerDisplay();
    } catch (e) {
        console.warn("[MODELS] Failed to load models from server:", e);
    }
}
