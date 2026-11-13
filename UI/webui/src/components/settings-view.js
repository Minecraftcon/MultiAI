/* =========================================================
   SETTINGS SCREEN CONTROLLER (FULL IN-APP SCREEN)
   Multiple sub-screens, instant auto-save, theme-aligned
   ========================================================= */
import { state } from "../state.js";
import { renderIcons, isMobileDevice, escapeHTML } from "../utils/dom.js";
import { closePanel } from "./gestures.js";
import { saveStoredChats } from "../services/storage.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { getUiScale, setUiScale, resetZoom } from "./ui-scale.js";
import { getAuroraTheme, setAuroraTheme, isAndroidOrMobile } from "./aurora-theme.js";
import { SYSTEM_PROMPT_PRESETS, CHATS_STORAGE_KEY, ACTIVE_CHAT_KEY } from "../config.js";
import { rebuildActiveSystemPrompt } from "../services/system.js";
import { renderChatList } from "./side-panel.js";
import { setStartPageMode } from "./chatbox.js";
import { McpActiveTools } from "../tools/mcp/index.js";
import { mountSettingsScreen } from "./settings-template.js";
import {
    loadContextFilters,
    saveContextFilters,
    refreshActiveContextFilterer,
    BUILTIN_PRESETS,
    DEFAULT_FILTERS
} from "../agent/context-filter.js";

export { mountSettingsScreen } from "./settings-template.js";

let activeSubScreen = "general";
let saveTimeout = null;
let pendingConfigUpdates = {};

export function openSettings(targetCategory = "general") {
    const appShell = document.getElementById("appShell");
    let settingsScreen = document.getElementById("settingsScreen") || mountSettingsScreen();
    if (!appShell || !settingsScreen) {
        console.error("[SETTINGS] appShell or settingsScreen element missing:", { appShell, settingsScreen });
        return;
    }

    // Always close side panel when navigating to settings
    try {
        closePanel();
    } catch (e) {
        console.warn("[SETTINGS] Error closing panel:", e);
    }

    try {
        populateSettingsValues();
    } catch (err) {
        console.error("[SETTINGS] Error populating settings:", err);
    }

    appShell.classList.add("in-settings");
    settingsScreen.setAttribute("aria-hidden", "false");

    try {
        import("./saturn-webgl.js").then(m => m.pauseSaturnWebGL?.()).catch(() => {});
    } catch (_) {}

    try {
        switchSubScreen(targetCategory);
        renderIcons(settingsScreen);
    } catch (err) {
        console.error("[SETTINGS] Error switching subscreen:", err);
    }

    // Scroll to top of content
    const content = settingsScreen.querySelector(".settings-content");
    if (content) content.scrollTop = 0;
}

export function closeSettings() {
    flushPendingSettings().catch(() => {});
    const appShell = document.getElementById("appShell");
    const settingsScreen = document.getElementById("settingsScreen");
    if (!appShell || !settingsScreen) return;

    appShell.classList.remove("in-settings");
    settingsScreen.setAttribute("aria-hidden", "true");

    try {
        if (appShell.classList.contains("is-start-page")) {
            import("./saturn-webgl.js").then(m => m.resumeSaturnWebGL?.()).catch(() => {});
        }
    } catch (_) {}

    const input = document.getElementById("input");
    if (input && !isMobileDevice()) {
        input.focus();
    }
}

export function switchSubScreen(screenId) {
    activeSubScreen = screenId;
    const settingsScreen = document.getElementById("settingsScreen");
    if (!settingsScreen) return;

    // Update nav items
    const navItems = settingsScreen.querySelectorAll(".settings-nav-item");
    navItems.forEach(btn => {
        const isMatch = btn.dataset.subscreen === screenId;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-selected", isMatch ? "true" : "false");
        if (isMatch && isMobileDevice()) {
            try {
                btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            } catch (_) {}
        }
    });

    // Update sub-screens visibility
    const subs = settingsScreen.querySelectorAll(".settings-subscreen");
    subs.forEach(panel => {
        const isMatch = panel.id === `subScreen_${screenId}`;
        panel.classList.toggle("active", isMatch);
    });

    // Reset content scroll so user starts at the top of the newly chosen section
    const content = settingsScreen.querySelector(".settings-content");
    if (content) {
        content.scrollTop = 0;
    }

    // Update header badge or label
    const badge = document.getElementById("settingsActiveBadge");
    if (badge) {
        badge.textContent = screenId === "mcp" ? "MCP SERVERS" : screenId.toUpperCase();
    }

    if (screenId === "mcp") {
        renderMcpServersList();
    }

    // Refresh Lucide icons inside newly shown subscreen
    renderIcons(settingsScreen);
}

/**
 * Populates all settings form controls from state.config
 */
export function populateSettingsValues() {
    const cfg = state.config || {};
    const gen = cfg.General || {};
    const agent = cfg.Agent || {};
    const tools = cfg.Tools || {};
    const ui = cfg.UI || {};

    // 1. General
    populateModelOptions();
    const startupLLM = document.getElementById("cfgStartupLLM");
    if (startupLLM && gen.DefaultStartupLLM) {
        startupLLM.value = gen.DefaultStartupLLM;
    }

    const uiStyleSelect = document.getElementById("cfgUIStyle");
    const storedUIStyle = gen.UIStyle || localStorage.getItem("multiai_ui_style") || "multiai";
    if (uiStyleSelect) {
        uiStyleSelect.value = storedUIStyle;
    }

    const presetSelect = document.getElementById("cfgSystemPreset");
    const customPromptText = document.getElementById("cfgCustomSystemPrompt");
    const storedPreset = gen.SystemPreset || localStorage.getItem("multiai_system_preset") || "default";
    const storedCustom = gen.CustomSystemPrompt || localStorage.getItem("multiai_custom_system_prompt") || "";

    if (presetSelect) presetSelect.value = storedPreset;
    if (customPromptText) {
        customPromptText.value = storedCustom || SYSTEM_PROMPT_PRESETS[storedPreset] || "";
        const row = document.getElementById("cfgCustomPromptRow");
        if (row) row.style.display = (storedPreset === "custom") ? "flex" : "none";
    }

    let initialPersona = SYSTEM_PROMPT_PRESETS.default;
    if (storedPreset === "custom") {
        initialPersona = storedCustom.trim() || SYSTEM_PROMPT_PRESETS.default;
    } else if (SYSTEM_PROMPT_PRESETS[storedPreset]) {
        initialPersona = SYSTEM_PROMPT_PRESETS[storedPreset];
    }
    state.activePersonaPrompt = initialPersona;
    rebuildActiveSystemPrompt();

    const sendKey = document.getElementById("cfgSendKey");
    if (sendKey) {
        sendKey.value = gen.SendKey || localStorage.getItem("multiai_send_key") || "enter";
        state.sendKey = sendKey.value;
    }

    // 2. Models & AI
    const tempSlider = document.getElementById("cfgTemperature");
    const tempVal = document.getElementById("cfgTemperatureVal");
    const storedTemp = (agent.Temperature !== undefined && agent.Temperature !== null)
        ? String(agent.Temperature)
        : (localStorage.getItem("multiai_temperature") || "0.7");
    if (tempSlider) tempSlider.value = storedTemp;
    if (tempVal) tempVal.textContent = parseFloat(storedTemp).toFixed(2);

    const streamResponse = document.getElementById("cfgStreamResponse");
    if (streamResponse) streamResponse.checked = agent.StreamResponse !== false;

    const streamReasoning = document.getElementById("cfgStreamReasoning");
    if (streamReasoning) streamReasoning.checked = Boolean(agent.StreamReasoning);

    const turnTimeout = document.getElementById("cfgTurnTimeout");
    if (turnTimeout) turnTimeout.value = String(agent.TurnTimeoutSeconds || 120);

    const maxHistory = document.getElementById("cfgMaxHistory");
    if (maxHistory) maxHistory.value = String(gen.MaxChatHistory || 100);

    // 3. Image Generation
    const imgProvider = document.getElementById("cfgImageProvider");
    if (imgProvider && gen.DefaultImageProvider) imgProvider.value = gen.DefaultImageProvider;

    const imgRatio = document.getElementById("cfgImageRatio");
    if (imgRatio && gen.DefaultImageAspectRatio) imgRatio.value = gen.DefaultImageAspectRatio;

    const imgModel = document.getElementById("cfgImageModel");
    if (imgModel && gen.DefaultImageModel) imgModel.value = gen.DefaultImageModel;

    // 4. Tools & Automation
    const toolSearch = document.getElementById("cfgEnableWebSearch");
    const searchSection = document.getElementById("cfgSearchConfigSection");
    if (toolSearch) {
        toolSearch.checked = tools.EnableWebSearch !== false;
        if (searchSection) {
            searchSection.style.display = toolSearch.checked ? "block" : "none";
        }
    }

    const searchConfig = state.config.Search || {};
    const searchProvider = document.getElementById("cfgSearchProvider");
    if (searchProvider) {
        searchProvider.value = (searchConfig.Provider || "tinyfish").toLowerCase();
    }

    const pairDeepSearch = document.getElementById("cfgPairDeepSearch");
    if (pairDeepSearch) {
        pairDeepSearch.checked = searchConfig.PairDeepSearch !== false;
    }

    const toolTerminal = document.getElementById("cfgEnableTerminal");
    if (toolTerminal) toolTerminal.checked = tools.EnableTerminal !== false;

    const toolFiles = document.getElementById("cfgEnableFileOperations");
    if (toolFiles) toolFiles.checked = tools.EnableFileOperations !== false;

    const toolImg = document.getElementById("cfgEnableImageGeneration");
    if (toolImg) toolImg.checked = tools.EnableImageGeneration !== false;

    const toolMcp = document.getElementById("cfgEnableMcp");
    if (toolMcp) toolMcp.checked = tools.EnableMcp !== false;

    // Load MCP servers list
    renderMcpServersList();

    // Load Sandbox & VM Isolation profiles
    renderSandboxProfiles();

    const maxToolRounds = document.getElementById("cfgMaxToolRounds");
    const maxToolRoundsVal = document.getElementById("cfgMaxToolRoundsVal");
    const storedRounds = agent.MaxToolRounds !== undefined ? agent.MaxToolRounds : 0;
    if (maxToolRounds) maxToolRounds.value = storedRounds;
    if (maxToolRoundsVal) maxToolRoundsVal.textContent = (storedRounds === 0 || storedRounds === "0" || storedRounds === Infinity) ? "Unlimited" : storedRounds;

    // 5. Appearance
    const themeSelect = document.getElementById("cfgTheme");
    if (themeSelect) themeSelect.value = ui.Theme || "dark";

    const auroraThemeSelect = document.getElementById("cfgAuroraTheme");
    if (auroraThemeSelect) {
        if (isAndroidOrMobile()) {
            const row = auroraThemeSelect.closest(".settings-row");
            if (row) row.style.display = "none";
        } else {
            auroraThemeSelect.value = getAuroraTheme();
        }
    }

    const showLineNumbers = document.getElementById("cfgShowLineNumbers");
    if (showLineNumbers) showLineNumbers.checked = ui.ShowLineNumbers !== false;

    const autoScroll = document.getElementById("cfgAutoScroll");
    if (autoScroll) autoScroll.checked = agent.AutoScroll !== false;

    const compactMobile = document.getElementById("cfgCompactMobileView");
    if (compactMobile) compactMobile.checked = ui.CompactMobileView !== false;

    // Mobile rendering limit settings
    const mobile = cfg.Mobile || {};
    const limitMobileTurns = document.getElementById("cfgMobileLimitVisibleTurns");
    if (limitMobileTurns) {
        limitMobileTurns.checked = mobile.LimitVisibleTurns !== false;
    }

    const visibleTurnsSelect = document.getElementById("cfgMobileVisibleTurns");
    const visibleTurnsRow = document.getElementById("cfgMobileVisibleTurnsRow");
    if (visibleTurnsRow && limitMobileTurns) {
        visibleTurnsRow.style.display = limitMobileTurns.checked ? "flex" : "none";
    }
    if (visibleTurnsSelect) {
        const configuredVal = String(mobile.VisibleTurns || 15);
        let exists = false;
        for (let i = 0; i < visibleTurnsSelect.options.length; i++) {
            if (visibleTurnsSelect.options[i].value === configuredVal) {
                exists = true;
                break;
            }
        }
        if (!exists && configuredVal) {
            const opt = document.createElement("option");
            opt.value = configuredVal;
            opt.textContent = `${configuredVal} turns`;
            visibleTurnsSelect.appendChild(opt);
        }
        visibleTurnsSelect.value = configuredVal;
    }

    const uiScaleSlider = document.getElementById("cfgUiScale");
    const uiScaleVal = document.getElementById("cfgUiScaleVal");
    if (uiScaleSlider && uiScaleVal) {
        const cur = Math.round(getUiScale() * 100);
        uiScaleSlider.value = cur;
        uiScaleVal.textContent = `${cur}%`;
    }

    // 6. Storage & History
    const recordHistory = document.getElementById("cfgRecordHistory");
    if (recordHistory) recordHistory.checked = gen.RecordChatHistory !== false;

    const recordDate = document.getElementById("cfgRecordDate");
    if (recordDate) recordDate.checked = gen.RecordDate !== false;

    // Context privacy filter state
    const { enabled: filterEnabled } = loadContextFilters();
    const filterToggle = document.getElementById("cfgContextFilterEnabled");
    if (filterToggle) filterToggle.checked = filterEnabled !== false;

    renderContextFilterRules();
    updateStorageSummary();
    updateAboutDiagnostics();
}

/**
 * Dynamically fills default startup LLM select options
 */
function populateModelOptions() {
    const startupLLM = document.getElementById("cfgStartupLLM");
    const modelSelect = document.getElementById("modelSelect");
    if (!startupLLM || !modelSelect) return;

    const currentVal = startupLLM.value || state.config?.General?.DefaultStartupLLM || "";
    startupLLM.innerHTML = "";

    Array.from(modelSelect.options).forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.textContent;
        if (opt.value === currentVal) option.selected = true;
        startupLLM.appendChild(option);
    });
}

function updateStorageSummary() {
    const totalSessions = Object.keys(state.chatSessions || {}).length;
    const countEl = document.getElementById("settingsChatCount");
    if (countEl) countEl.textContent = `${totalSessions} conversation${totalSessions === 1 ? "" : "s"}`;

    const sizeEl = document.getElementById("settingsStorageSize");
    if (sizeEl) {
        try {
            let bytes = 0;
            const chatsRaw = localStorage.getItem(CHATS_STORAGE_KEY);
            if (chatsRaw) {
                bytes += new Blob([chatsRaw]).size;
            } else if (state.chatSessions && totalSessions > 0) {
                bytes += new Blob([JSON.stringify(state.chatSessions)]).size;
            }
            // Include other app localStorage keys for complete accuracy
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k !== CHATS_STORAGE_KEY && (k.startsWith("multi") || k.startsWith("gemini"))) {
                    bytes += new Blob([localStorage.getItem(k) || ""]).size;
                }
            }
            const kb = (bytes / 1024).toFixed(1);
            sizeEl.textContent = `~${kb} KB`;
        } catch (_) {
            sizeEl.textContent = "Local";
        }
    }
}

function updateAboutDiagnostics() {
    const portEl = document.getElementById("aboutServerPort");
    if (portEl) portEl.textContent = state.config?.General?.Port || "8080";

    const hostEl = document.getElementById("aboutServerHost");
    if (hostEl) hostEl.textContent = state.config?.General?.Host || "0.0.0.0";

    const modelsEl = document.getElementById("aboutModelCount");
    const modelSelect = document.getElementById("modelSelect");
    if (modelsEl && modelSelect) {
        modelsEl.textContent = `${modelSelect.options.length} models`;
    }
}

/**
 * Flushes any pending debounced config updates immediately to the server
 */
export async function flushPendingSettings() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if (!pendingConfigUpdates || Object.keys(pendingConfigUpdates).length === 0) return true;
    const payload = pendingConfigUpdates;
    pendingConfigUpdates = {};
    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true
        });
        return res.ok;
    } catch (err) {
        console.warn("[SETTINGS] Failed to flush config to server:", err.message);
        return false;
    }
}

/**
 * Dispatches an asynchronous update to the backend config and updates live state
 */
export async function saveSetting(section, key, value) {
    if (!state.config) state.config = {};
    if (!state.config[section]) state.config[section] = {};
    state.config[section][key] = value;

    if (!pendingConfigUpdates[section]) {
        pendingConfigUpdates[section] = {};
    }
    pendingConfigUpdates[section][key] = value;

    const statusEl = document.getElementById("settingsSaveStatus");
    if (statusEl) {
        statusEl.className = "settings-save-status saving";
        statusEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Saving...</span>';
        renderIcons(statusEl);
    }

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        const payload = pendingConfigUpdates;
        pendingConfigUpdates = {};
        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                if (statusEl) {
                    statusEl.className = "settings-save-status saved";
                    statusEl.innerHTML = '<i data-lucide="check"></i><span>Saved to cloud</span>';
                    renderIcons(statusEl);
                    setTimeout(() => {
                        if (statusEl) {
                            statusEl.className = "settings-save-status";
                            statusEl.innerHTML = '<i data-lucide="check"></i><span>Auto-saved</span>';
                            renderIcons(statusEl);
                        }
                    }, 1400);
                }
            } else {
                console.warn("[SETTINGS] Server returned status:", res.status);
                if (statusEl) {
                    statusEl.className = "settings-save-status error";
                    statusEl.innerHTML = res.status === 401
                        ? '<i data-lucide="alert-triangle"></i><span>Session expired</span>'
                        : '<i data-lucide="alert-triangle"></i><span>Save failed (' + res.status + ')</span>';
                    renderIcons(statusEl);
                }
            }
        } catch (err) {
            console.warn("[SETTINGS] Failed to save config to server:", err.message);
            if (statusEl) {
                statusEl.className = "settings-save-status";
                statusEl.innerHTML = '<span>Saved locally</span>';
            }
        }
    }, 250);
}

/**
 * Binds all interactive controls on the Settings Screen
 */
export function initSettingsView() {
    let settingsScreen = document.getElementById("settingsScreen") || mountSettingsScreen();
    if (!settingsScreen) return;
    renderIcons(settingsScreen);
    const settingsBackBtn = document.getElementById("settingsBackBtn");

    // Back to Chat
    if (settingsBackBtn) {
        let lastBack = 0;
        const triggerClose = (e) => {
            const now = Date.now();
            if (now - lastBack < 350) return;
            lastBack = now;
            if (e) {
                e.stopPropagation();
                if (e.cancelable && e.type === "touchend") {
                    e.preventDefault();
                }
            }
            closeSettings();
        };
        settingsBackBtn.addEventListener("click", triggerClose);
        settingsBackBtn.addEventListener("touchend", triggerClose, { passive: false });
    }

    // Tab Navigation
    settingsScreen.querySelectorAll(".settings-nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const screenId = btn.dataset.subscreen;
            if (screenId) switchSubScreen(screenId);
        });
    });

    // Keyboard navigation (Escape exits settings)
    document.addEventListener("keydown", (e) => {
        const appShell = document.getElementById("appShell");
        if (e.key === "Escape" && appShell?.classList.contains("in-settings")) {
            e.preventDefault();
            closeSettings();
        }
    });

    window.addEventListener("beforeunload", () => {
        flushPendingSettings().catch(() => {});
    });

    // 1. General Controls
    const startupLLM = document.getElementById("cfgStartupLLM");
    if (startupLLM) {
        startupLLM.addEventListener("change", (e) => {
            saveSetting("General", "DefaultStartupLLM", e.target.value);
            const modelSelect = document.getElementById("modelSelect");
            if (modelSelect && !state.currentChatId) {
                modelSelect.value = e.target.value;
                updateModelPickerDisplay();
            }
        });
    }

    const uiStyleSelect = document.getElementById("cfgUIStyle");
    if (uiStyleSelect) {
        uiStyleSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            applyUIStyle(val);
            saveSetting("General", "UIStyle", val);
        });
    }

    const presetSelect = document.getElementById("cfgSystemPreset");
    const customPromptText = document.getElementById("cfgCustomSystemPrompt");
    const customPromptRow = document.getElementById("cfgCustomPromptRow");

    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            localStorage.setItem("multiai_system_preset", val);
            let persona = SYSTEM_PROMPT_PRESETS.default;
            if (val === "custom") {
                if (customPromptRow) customPromptRow.style.display = "flex";
                persona = customPromptText ? customPromptText.value.trim() : "";
            } else {
                if (customPromptRow) customPromptRow.style.display = "none";
                persona = SYSTEM_PROMPT_PRESETS[val] || SYSTEM_PROMPT_PRESETS.default;
            }
            state.activePersonaPrompt = persona || SYSTEM_PROMPT_PRESETS.default;
            rebuildActiveSystemPrompt();
            saveSetting("General", "SystemPreset", val);
        });
    }

    if (customPromptText) {
        customPromptText.addEventListener("input", (e) => {
            const val = e.target.value;
            localStorage.setItem("multiai_custom_system_prompt", val);
            saveSetting("General", "CustomSystemPrompt", val);
            if (presetSelect?.value === "custom") {
                state.activePersonaPrompt = val.trim() || SYSTEM_PROMPT_PRESETS.default;
                rebuildActiveSystemPrompt();
            }
        });
    }

    const sendKey = document.getElementById("cfgSendKey");
    if (sendKey) {
        sendKey.addEventListener("change", (e) => {
            localStorage.setItem("multiai_send_key", e.target.value);
            state.sendKey = e.target.value;
            saveSetting("General", "SendKey", e.target.value);
        });
    }

    // 2. Models & AI Controls
    const tempSlider = document.getElementById("cfgTemperature");
    const tempVal = document.getElementById("cfgTemperatureVal");
    if (tempSlider && tempVal) {
        tempSlider.addEventListener("input", (e) => {
            tempVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        tempSlider.addEventListener("change", (e) => {
            localStorage.setItem("multiai_temperature", e.target.value);
            saveSetting("Agent", "Temperature", parseFloat(e.target.value));
        });
    }

    const streamResponse = document.getElementById("cfgStreamResponse");
    if (streamResponse) {
        streamResponse.addEventListener("change", (e) => {
            saveSetting("Agent", "StreamResponse", e.target.checked);
        });
    }

    const streamReasoning = document.getElementById("cfgStreamReasoning");
    if (streamReasoning) {
        streamReasoning.addEventListener("change", (e) => {
            saveSetting("Agent", "StreamReasoning", e.target.checked);
        });
    }

    const turnTimeout = document.getElementById("cfgTurnTimeout");
    if (turnTimeout) {
        turnTimeout.addEventListener("change", (e) => {
            saveSetting("Agent", "TurnTimeoutSeconds", parseInt(e.target.value, 10));
        });
    }

    const maxHistory = document.getElementById("cfgMaxHistory");
    if (maxHistory) {
        maxHistory.addEventListener("change", (e) => {
            saveSetting("General", "MaxChatHistory", parseInt(e.target.value, 10));
        });
    }

    // 3. Image Generation Controls
    const imgProvider = document.getElementById("cfgImageProvider");
    if (imgProvider) {
        imgProvider.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageProvider", e.target.value);
        });
    }

    const imgRatio = document.getElementById("cfgImageRatio");
    if (imgRatio) {
        imgRatio.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageAspectRatio", e.target.value);
        });
    }

    const imgModel = document.getElementById("cfgImageModel");
    if (imgModel) {
        imgModel.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageModel", e.target.value);
        });
    }

    // 4. Tools & Automation Controls
    const toolSearch = document.getElementById("cfgEnableWebSearch");
    const searchSection = document.getElementById("cfgSearchConfigSection");
    if (toolSearch) {
        toolSearch.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableWebSearch", e.target.checked);
            if (searchSection) {
                searchSection.style.display = e.target.checked ? "block" : "none";
            }
        });
    }

    const searchProvider = document.getElementById("cfgSearchProvider");
    if (searchProvider) {
        searchProvider.addEventListener("change", (e) => {
            saveSetting("Search", "Provider", e.target.value);
        });
    }

    const pairDeepSearch = document.getElementById("cfgPairDeepSearch");
    if (pairDeepSearch) {
        pairDeepSearch.addEventListener("change", (e) => {
            saveSetting("Search", "PairDeepSearch", e.target.checked);
        });
    }

    const toolTerminal = document.getElementById("cfgEnableTerminal");
    if (toolTerminal) {
        toolTerminal.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableTerminal", e.target.checked);
        });
    }

    const toolFiles = document.getElementById("cfgEnableFileOperations");
    if (toolFiles) {
        toolFiles.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableFileOperations", e.target.checked);
        });
    }

    const toolImg = document.getElementById("cfgEnableImageGeneration");
    if (toolImg) {
        toolImg.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableImageGeneration", e.target.checked);
        });
    }

    const toolMcp = document.getElementById("cfgEnableMcp");
    if (toolMcp) {
        toolMcp.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableMcp", e.target.checked);
        });
    }

    initMcpSettingsControls();
    initSandboxSettingsControls();

    const maxToolRounds = document.getElementById("cfgMaxToolRounds");
    const maxToolRoundsVal = document.getElementById("cfgMaxToolRoundsVal");
    if (maxToolRounds && maxToolRoundsVal) {
        maxToolRounds.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            maxToolRoundsVal.textContent = val === 0 ? "Unlimited" : val;
        });
        maxToolRounds.addEventListener("change", (e) => {
            const val = parseInt(e.target.value, 10);
            saveSetting("Agent", "MaxToolRounds", val);
        });
    }

    // 5. Appearance Controls
    const themeSelect = document.getElementById("cfgTheme");
    if (themeSelect) {
        themeSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            saveSetting("UI", "Theme", val);
            applyTheme(val);
        });
    }

    const auroraThemeSelect = document.getElementById("cfgAuroraTheme");
    if (auroraThemeSelect) {
        auroraThemeSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            setAuroraTheme(val, true);
        });
    }

    const showLineNumbers = document.getElementById("cfgShowLineNumbers");
    if (showLineNumbers) {
        showLineNumbers.addEventListener("change", (e) => {
            saveSetting("UI", "ShowLineNumbers", e.target.checked);
        });
    }

    const uiScaleSlider = document.getElementById("cfgUiScale");
    const uiScaleVal = document.getElementById("cfgUiScaleVal");
    const uiScaleResetBtn = document.getElementById("cfgUiScaleResetBtn");

    if (uiScaleSlider && uiScaleVal) {
        uiScaleSlider.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            uiScaleVal.textContent = `${val}%`;
            setUiScale(val / 100, true);
        });
        uiScaleSlider.addEventListener("change", (e) => {
            const val = parseInt(e.target.value, 10);
            saveSetting("UI", "Scale", val / 100);
        });
    }

    if (uiScaleResetBtn) {
        uiScaleResetBtn.addEventListener("click", () => {
            resetZoom(true);
            if (uiScaleSlider) uiScaleSlider.value = 100;
            if (uiScaleVal) uiScaleVal.textContent = "100%";
            saveSetting("UI", "Scale", 1.0);
        });
    }

    const autoScroll = document.getElementById("cfgAutoScroll");
    if (autoScroll) {
        autoScroll.addEventListener("change", (e) => {
            saveSetting("Agent", "AutoScroll", e.target.checked);
        });
    }

    const compactMobile = document.getElementById("cfgCompactMobileView");
    if (compactMobile) {
        compactMobile.addEventListener("change", (e) => {
            saveSetting("UI", "CompactMobileView", e.target.checked);
        });
    }

    const limitMobileTurns = document.getElementById("cfgMobileLimitVisibleTurns");
    if (limitMobileTurns) {
        limitMobileTurns.addEventListener("change", (e) => {
            saveSetting("Mobile", "LimitVisibleTurns", e.target.checked);
            const row = document.getElementById("cfgMobileVisibleTurnsRow");
            if (row) row.style.display = e.target.checked ? "flex" : "none";
        });
    }

    const visibleTurnsSelect = document.getElementById("cfgMobileVisibleTurns");
    if (visibleTurnsSelect) {
        visibleTurnsSelect.addEventListener("change", (e) => {
            const val = parseInt(e.target.value, 10) || 15;
            saveSetting("Mobile", "VisibleTurns", val);
        });
    }

    // 6. Storage & History Controls
    const recordHistory = document.getElementById("cfgRecordHistory");
    if (recordHistory) {
        recordHistory.addEventListener("change", (e) => {
            saveSetting("General", "RecordChatHistory", e.target.checked);
        });
    }

    const recordDate = document.getElementById("cfgRecordDate");
    if (recordDate) {
        recordDate.addEventListener("change", (e) => {
            saveSetting("General", "RecordDate", e.target.checked);
        });
    }

    // Context Privacy & Redaction Filterer Controls
    bindContextFilterEvents();

    // Export All Chats Button
    const exportBtn = document.getElementById("settingsExportAllBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", () => {
            const payload = JSON.stringify(state.chatSessions || {}, null, 2);
            const blob = new Blob([payload], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.download = `multiai_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 150);
        });
    }

    // Clear All Chats Button
    const clearBtn = document.getElementById("settingsClearAllBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            if (confirm("Are you sure you want to clear all stored conversation history? This cannot be undone.")) {
                try {
                    await fetch("/api/chats", { method: "DELETE" });
                } catch (e) {
                    console.warn("[SETTINGS] Backend clear error:", e);
                }
                state.chatSessions = {};
                state.currentChatId = null;
                state.messages = [{ role: "system", content: state.activeSystemPrompt }];
                try {
                    localStorage.removeItem(CHATS_STORAGE_KEY);
                    localStorage.removeItem(ACTIVE_CHAT_KEY);
                } catch (_) {}
                saveStoredChats();
                const chat = document.getElementById("chat");
                if (chat) chat.innerHTML = "";
                renderChatList();
                setStartPageMode(true);
                updateStorageSummary();
                closeSettings();
            }
        });
    }

    // Reset Defaults Button
    const resetBtn = document.getElementById("settingsResetDefaultsBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            if (confirm("Reset all settings to initial defaults?")) {
                localStorage.removeItem("multiai_system_preset");
                localStorage.removeItem("multiai_custom_system_prompt");
                localStorage.removeItem("multiai_temperature");
                localStorage.removeItem("multiai_send_key");
                localStorage.removeItem("multiai_ui_style");
                applyUIStyle("multiai");

                const defaults = {
                    General: {
                        DefaultStartupLLM: "gemini-2.5-flash",
                        DefaultImageProvider: "pollinations",
                        DefaultImageModel: "flux",
                        DefaultImageAspectRatio: "3:2",
                        RecordDate: true,
                        RecordChatHistory: true,
                        MaxChatHistory: 100,
                        UIStyle: "multiai"
                    },
                    Agent: {
                        MaxToolRounds: 0,
                        MaxToolsPerRound: 10,
                        AutoScroll: true,
                        StreamResponse: true,
                        StreamReasoning: false,
                        TurnTimeoutSeconds: 120
                    },
                    Tools: {
                        EnableTerminal: true,
                        EnableWebSearch: true,
                        EnableImageGeneration: true,
                        EnableFileOperations: true
                    },
                    UI: {
                        Theme: "dark",
                        ShowLineNumbers: true,
                        CompactMobileView: true
                    },
                    Mobile: {
                        LimitVisibleTurns: true,
                        VisibleTurns: 15
                    }
                };

                state.config = defaults;
                try {
                    await fetch("/api/config", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(defaults)
                    });
                } catch (_) {}

                populateSettingsValues();
            }
        });
    }
}

/* =========================================================
   CONTEXT PRIVACY & REDACTION FILTER CONTROLLER
   ========================================================= */

let editingFilterId = null;

function bindContextFilterEvents() {
    const filterToggle = document.getElementById("cfgContextFilterEnabled");
    if (filterToggle) {
        filterToggle.addEventListener("change", (e) => {
            const { filters } = loadContextFilters();
            saveContextFilters(filters, e.target.checked);
            refreshActiveContextFilterer();
            renderContextFilterRules();
        });
    }

    const btnAdd = document.getElementById("btnAddContextFilter");
    if (btnAdd) {
        btnAdd.addEventListener("click", () => {
            openFilterForm(null);
        });
    }

    const btnReset = document.getElementById("btnResetContextFilters");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            if (confirm("Reset context privacy filters to default rules?")) {
                saveContextFilters([...DEFAULT_FILTERS], true);
                refreshActiveContextFilterer();
                if (filterToggle) filterToggle.checked = true;
                closeFilterForm();
                renderContextFilterRules();
            }
        });
    }

    const btnCloseForm = document.getElementById("btnCloseFilterForm");
    const btnCancel = document.getElementById("btnCancelFilter");
    if (btnCloseForm) btnCloseForm.addEventListener("click", closeFilterForm);
    if (btnCancel) btnCancel.addEventListener("click", closeFilterForm);

    const typeSelect = document.getElementById("filterTypeSelect");
    if (typeSelect) {
        typeSelect.addEventListener("change", (e) => {
            updateFilterFormMode(e.target.value);
        });
    }

    const actionSelect = document.getElementById("filterActionSelect");
    if (actionSelect) {
        actionSelect.addEventListener("change", (e) => {
            const replContainer = document.getElementById("filterReplacementContainer");
            if (replContainer) {
                replContainer.style.display = e.target.value === "block" ? "none" : "";
            }
        });
    }

    const presetSelect = document.getElementById("filterPresetSelect");
    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            const preset = BUILTIN_PRESETS.find(p => p.id === e.target.value);
            if (preset) {
                const nameInput = document.getElementById("filterNameInput");
                if (nameInput && (!nameInput.value || BUILTIN_PRESETS.some(p => p.name === nameInput.value))) {
                    nameInput.value = preset.name;
                }
                const replInput = document.getElementById("filterReplacementInput");
                if (replInput) replInput.value = preset.replacement;
            }
        });
    }

    const btnSave = document.getElementById("btnSaveFilter");
    if (btnSave) {
        btnSave.addEventListener("click", () => {
            saveCurrentFilterFromForm();
        });
    }
}

function updateFilterFormMode(mode) {
    const presetContainer = document.getElementById("filterPresetContainer");
    const patternContainer = document.getElementById("filterPatternContainer");
    const patternLabel = document.getElementById("filterPatternLabel");
    const patternInput = document.getElementById("filterPatternInput");
    const wholeWordWrap = document.getElementById("filterOptWholeWordWrap");
    const replContainer = document.getElementById("filterReplacementContainer");
    const actionSelect = document.getElementById("filterActionSelect");

    if (mode === "preset") {
        if (presetContainer) presetContainer.style.display = "";
        if (patternContainer) patternContainer.style.display = "none";
        if (wholeWordWrap) wholeWordWrap.style.display = "none";
    } else if (mode === "keyword") {
        if (presetContainer) presetContainer.style.display = "none";
        if (patternContainer) patternContainer.style.display = "";
        if (patternLabel) patternLabel.textContent = "Keyword to Mask";
        if (patternInput) patternInput.placeholder = "e.g. MySecretToken or ProjectX";
        if (wholeWordWrap) wholeWordWrap.style.display = "";
    } else { // regex
        if (presetContainer) presetContainer.style.display = "none";
        if (patternContainer) patternContainer.style.display = "";
        if (patternLabel) patternLabel.textContent = "Regex Pattern (without slashes)";
        if (patternInput) patternInput.placeholder = "e.g. (?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]+)";
        if (wholeWordWrap) wholeWordWrap.style.display = "none";
    }

    if (replContainer && actionSelect) {
        replContainer.style.display = actionSelect.value === "block" ? "none" : "";
    }
}

function openFilterForm(filter = null) {
    const form = document.getElementById("contextFilterForm");
    if (!form) return;

    editingFilterId = filter?.id || null;
    const titleEl = document.getElementById("filterFormTitle");
    if (titleEl) {
        titleEl.textContent = filter ? "Edit Privacy Filter" : "New Privacy Filter";
    }

    const nameInput = document.getElementById("filterNameInput");
    const typeSelect = document.getElementById("filterTypeSelect");
    const presetSelect = document.getElementById("filterPresetSelect");
    const patternInput = document.getElementById("filterPatternInput");
    const actionSelect = document.getElementById("filterActionSelect");
    const replInput = document.getElementById("filterReplacementInput");
    const scopeSelect = document.getElementById("filterScopeSelect");
    const optCase = document.getElementById("filterOptCaseInsensitive");
    const optWord = document.getElementById("filterOptWholeWord");

    if (filter) {
        if (nameInput) nameInput.value = filter.name || "";
        if (typeSelect) typeSelect.value = filter.type || "keyword";
        if (presetSelect && filter.presetId) presetSelect.value = filter.presetId;
        if (patternInput) patternInput.value = filter.pattern || "";
        if (actionSelect) actionSelect.value = filter.action || "replace";
        if (replInput) replInput.value = filter.replacement !== undefined ? filter.replacement : "[REDACTED]";
        if (scopeSelect) scopeSelect.value = filter.scope || "all";
        if (optCase) optCase.checked = filter.flags ? filter.flags.includes("i") : true;
        if (optWord) optWord.checked = filter.wholeWord !== false;
    } else {
        if (nameInput) nameInput.value = "";
        if (typeSelect) typeSelect.value = "keyword";
        if (presetSelect) presetSelect.value = "preset_api_keys";
        if (patternInput) patternInput.value = "";
        if (actionSelect) actionSelect.value = "replace";
        if (replInput) replInput.value = "[REDACTED]";
        if (scopeSelect) scopeSelect.value = "all";
        if (optCase) optCase.checked = true;
        if (optWord) optWord.checked = true;
    }

    updateFilterFormMode(typeSelect?.value || "keyword");
    form.style.display = "";
    if (nameInput) nameInput.focus();
}

function closeFilterForm() {
    const form = document.getElementById("contextFilterForm");
    if (form) form.style.display = "none";
    editingFilterId = null;
}

function saveCurrentFilterFromForm() {
    const nameInput = document.getElementById("filterNameInput");
    const typeSelect = document.getElementById("filterTypeSelect");
    const presetSelect = document.getElementById("filterPresetSelect");
    const patternInput = document.getElementById("filterPatternInput");
    const actionSelect = document.getElementById("filterActionSelect");
    const replInput = document.getElementById("filterReplacementInput");
    const scopeSelect = document.getElementById("filterScopeSelect");
    const optCase = document.getElementById("filterOptCaseInsensitive");
    const optWord = document.getElementById("filterOptWholeWord");

    const type = typeSelect?.value || "keyword";
    let pattern = patternInput?.value?.trim() || "";
    let presetId = null;

    if (type === "preset") {
        presetId = presetSelect?.value || "preset_api_keys";
        const foundPreset = BUILTIN_PRESETS.find(p => p.id === presetId);
        pattern = foundPreset ? foundPreset.pattern : "";
    }

    if (!pattern) {
        alert("Please specify a keyword, regex pattern, or preset.");
        return;
    }

    // Validate regex syntax
    if (type === "regex" || type === "preset") {
        try {
            new RegExp(pattern);
        } catch (err) {
            alert("Invalid Regular Expression: " + err.message);
            return;
        }
    }

    const name = nameInput?.value?.trim() || (type === "preset" ? (BUILTIN_PRESETS.find(p => p.id === presetId)?.name || "Preset") : pattern);
    const action = actionSelect?.value || "replace";
    const replacement = action === "block" ? "" : (replInput?.value !== undefined ? replInput.value : "[REDACTED]");
    const scope = scopeSelect?.value || "all";
    const flags = optCase?.checked ? "gi" : "g";
    const wholeWord = optWord ? optWord.checked : true;

    const { enabled, filters } = loadContextFilters();
    let updatedFilters = [...filters];

    if (editingFilterId) {
        const idx = updatedFilters.findIndex(f => f.id === editingFilterId);
        if (idx !== -1) {
            updatedFilters[idx] = {
                ...updatedFilters[idx],
                name,
                type,
                presetId,
                pattern,
                flags,
                wholeWord,
                action,
                replacement,
                scope
            };
        }
    } else {
        const newFilter = {
            id: "flt_" + Math.random().toString(36).substring(2, 9),
            name,
            type,
            presetId,
            pattern,
            flags,
            wholeWord,
            action,
            replacement,
            scope,
            enabled: true
        };
        updatedFilters.push(newFilter);
    }

    saveContextFilters(updatedFilters, enabled);
    refreshActiveContextFilterer();
    closeFilterForm();
    renderContextFilterRules();
}

function renderContextFilterRules() {
    const listEl = document.getElementById("contextFiltersList");
    if (!listEl) return;

    const { enabled: globalEnabled, filters } = loadContextFilters();

    if (!filters || filters.length === 0) {
        listEl.innerHTML = `
            <div class="context-filter-empty-state">
                No privacy or redaction filters defined. Click <strong>Add Filter</strong> to set up rule-based masking.
            </div>
        `;
        return;
    }

    listEl.innerHTML = "";
    filters.forEach(f => {
        const item = document.createElement("div");
        item.className = `context-filter-item ${f.enabled === false || !globalEnabled ? "disabled" : ""}`;
        item.dataset.filterId = f.id;

        const isBlock = f.action === "block";
        const badgeClass = f.type === "keyword" ? "badge-keyword" : (f.type === "preset" ? "badge-preset" : "badge-regex");
        const actionBadgeClass = isBlock ? "badge-action-block" : "badge-action-replace";

        let patternPreview = escapeHTML(f.pattern || "");
        if (f.type === "keyword" && f.wholeWord !== false) {
            patternPreview = `\\b${patternPreview}\\b`;
        }

        const scopeLabel = f.scope === "all" ? "All Context" : (f.scope === "user" ? "User Prompts" : (f.scope === "tool" ? "Tool Outputs" : "Assistant"));

        item.innerHTML = `
            <div class="context-filter-item-main">
                <div class="context-filter-item-title-row">
                    <span class="context-filter-item-name">${escapeHTML(f.name || f.pattern)}</span>
                    <span class="context-filter-badge ${badgeClass}">${f.type}</span>
                    <span class="context-filter-badge ${actionBadgeClass}">${isBlock ? "HALT / BLOCK" : "REPLACE"}</span>
                    <span class="context-filter-badge" style="background:var(--surface-3); color:var(--text-tertiary); font-size:10px;">${scopeLabel}</span>
                </div>
                <div class="context-filter-pattern-line">
                    <span class="context-filter-pattern-text" title="${escapeHTML(f.pattern)}">${patternPreview}</span>
                    ${!isBlock ? `<span class="context-filter-arrow">➔</span><span class="context-filter-replace-text">${escapeHTML(f.replacement)}</span>` : ""}
                </div>
            </div>
            <div class="context-filter-item-actions">
                <label class="settings-switch" style="transform: scale(0.85); margin-right: 4px;" title="Toggle filter">
                    <input type="checkbox" class="filter-enable-chk" ${f.enabled !== false ? "checked" : ""}>
                    <span class="settings-slider"></span>
                </label>
                <button type="button" class="context-filter-btn filter-edit-btn" title="Edit Filter">
                    <i data-lucide="edit-2"></i>
                </button>
                <button type="button" class="context-filter-btn danger filter-delete-btn" title="Delete Filter">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;

        // Checkbox toggle
        const chk = item.querySelector(".filter-enable-chk");
        if (chk) {
            chk.addEventListener("change", (e) => {
                const { enabled, filters: current } = loadContextFilters();
                const target = current.find(x => x.id === f.id);
                if (target) {
                    target.enabled = e.target.checked;
                    saveContextFilters(current, enabled);
                    refreshActiveContextFilterer();
                    renderContextFilterRules();
                }
            });
        }

        // Edit button
        const editBtn = item.querySelector(".filter-edit-btn");
        if (editBtn) {
            editBtn.addEventListener("click", () => {
                openFilterForm(f);
            });
        }

        // Delete button
        const delBtn = item.querySelector(".filter-delete-btn");
        if (delBtn) {
            delBtn.addEventListener("click", () => {
                if (confirm(`Delete filter '${f.name || f.pattern}'?`)) {
                    const { enabled, filters: current } = loadContextFilters();
                    const filtered = current.filter(x => x.id !== f.id);
                    saveContextFilters(filtered, enabled);
                    refreshActiveContextFilterer();
                    renderContextFilterRules();
                }
            });
        }

        listEl.appendChild(item);
    });

    renderIcons(listEl);
}

/* =========================================================
   GLOBAL UI STYLE APPLICATION HELPER (TOP-LEVEL EXPORT)
   ========================================================= */
export function applyUIStyle(val) {
    const style = (val === "classics") ? "classics" : "multiai";
    document.documentElement.setAttribute("data-ui-style", style);
    if (document.body) {
        document.body.classList.toggle("ui-style-classics", style === "classics");
        document.body.classList.toggle("ui-style-multiai", style === "multiai");
    }
    try {
        localStorage.setItem("multiai_ui_style", style);
    } catch (_) {}

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ui-style-changed", { detail: { style } }));
    }
}

/* =========================================================
   GLOBAL THEME APPLICATION HELPER (TOP-LEVEL EXPORT)
   ========================================================= */
export function applyTheme(val) {
    if (!val) val = "dark";
    document.documentElement.setAttribute("data-theme", val);
    try {
        localStorage.setItem("multiai_theme", val);
    } catch (e) {}

    // 1. Update browser theme-color meta tag
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        let isLight = false;
        if (val === "light") isLight = true;
        else if (val === "system") {
            isLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
        }

        if (isLight) {
            metaThemeColor.setAttribute("content", "#f8f9fa");
        } else if (val === "midnight") {
            metaThemeColor.setAttribute("content", "#000000");
        } else {
            metaThemeColor.setAttribute("content", "#0f0f0f");
        }
    }

    // 2. Update Highlight.js syntax theme
    const hljsLink = document.getElementById("hljsTheme");
    if (hljsLink) {
        let isLight = false;
        if (val === "light") isLight = true;
        else if (val === "system") {
            isLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
        }

        const darkHljs = "/vendor/highlightjs/github-dark.min.css";
        const lightHljs = "/vendor/highlightjs/github.min.css";
        const targetHref = isLight ? lightHljs : darkHljs;
        if (hljsLink.getAttribute("href") !== targetHref) {
            hljsLink.setAttribute("href", targetHref);
        }
    }
}

// Listen for system scheme changes when theme is set to 'system'
if (typeof window !== "undefined" && window.matchMedia) {
    try {
        window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
            const curTheme = document.documentElement.getAttribute("data-theme");
            if (curTheme === "system") {
                applyTheme("system");
            }
        });
    } catch (e) {}
}

/**
 * Fetches and renders live MCP servers list in the Settings UI
 */
export async function renderMcpServersList() {
    const listEl = document.getElementById("mcpServersList");
    if (!listEl) return;

    try {
        const res = await fetch("/api/mcp/servers");
        if (!res.ok) {
            listEl.innerHTML = `<div class="mcp-empty-state">Unable to load MCP servers (${res.status})</div>`;
            return;
        }
        const data = await res.json();
        const servers = data.servers || [];

        if (servers.length === 0) {
            listEl.innerHTML = `
                <div class="mcp-empty-state">
                    <span>No external MCP servers configured. Click <strong>+ Add Server</strong> above to connect tools.</span>
                </div>
            `;
            return;
        }

        listEl.innerHTML = "";
        servers.forEach(srv => {
            const item = document.createElement("div");
            item.className = "mcp-server-item";

            const statusClass = srv.status === "connected" ? "connected" 
                : (srv.status === "starting" ? "starting" 
                : (srv.status === "disabled" ? "disabled" : "error"));
            const statusLabel = srv.status ? srv.status.toUpperCase() : "UNKNOWN";

            let transportStr = "";
            if (srv.url) {
                transportStr = `sse: ${srv.url}`;
            } else if (srv.command) {
                transportStr = `stdio: ${srv.command} ${(srv.args || []).join(" ")}`.trim();
            } else {
                transportStr = "stdio";
            }

            const toolsList = srv.tools || [];
            let toolsHtml = "";
            if (toolsList.length > 0) {
                const pills = toolsList.map(t => `<span class="mcp-tool-pill" title="${escapeHTML(t.description || '')}"><i data-lucide="wrench"></i>${escapeHTML(t.name)}</span>`).join("");
                toolsHtml = `
                    <div class="mcp-tools-container">
                        <span class="mcp-tools-label">${toolsList.length} Tool${toolsList.length > 1 ? 's' : ''}:</span>
                        ${pills}
                    </div>
                `;
            } else if (srv.status === "connected") {
                toolsHtml = `
                    <div class="mcp-tools-container">
                        <span class="mcp-tools-label">0 tools exposed</span>
                    </div>
                `;
            }

            const errorHtml = srv.error ? `<div class="mcp-server-err-msg">${escapeHTML(srv.error)}</div>` : "";

            item.innerHTML = `
                <div class="mcp-server-top">
                    <div class="mcp-server-title-group">
                        <span class="mcp-server-name">${escapeHTML(srv.id)}</span>
                        <span class="mcp-status-pill ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="mcp-server-actions">
                        <label class="settings-switch" title="${srv.enabled ? 'Disable' : 'Enable'} server">
                            <input type="checkbox" class="mcp-server-toggle" data-id="${escapeHTML(srv.id)}" ${srv.enabled ? 'checked' : ''}>
                            <span class="settings-slider"></span>
                        </label>
                        <button type="button" class="mcp-icon-btn mcp-restart-btn" data-id="${escapeHTML(srv.id)}" title="Restart server">
                            <i data-lucide="rotate-cw"></i>
                        </button>
                        <button type="button" class="mcp-icon-btn danger mcp-delete-btn" data-id="${escapeHTML(srv.id)}" title="Delete server">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
                <div class="mcp-server-transport" title="${escapeHTML(transportStr)}">${escapeHTML(transportStr)}</div>
                ${errorHtml}
                ${toolsHtml}
            `;

            listEl.appendChild(item);
        });

        renderIcons(listEl);

        // Bind item actions
        listEl.querySelectorAll(".mcp-server-toggle").forEach(chk => {
            chk.addEventListener("change", async (e) => {
                const srvId = e.target.dataset.id;
                try {
                    await fetch(`/api/mcp/servers/${encodeURIComponent(srvId)}/toggle`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ enabled: e.target.checked })
                    });
                    await McpActiveTools.refresh();
                    renderMcpServersList();
                } catch (err) {
                    console.error("MCP toggle error:", err);
                }
            });
        });

        listEl.querySelectorAll(".mcp-restart-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const srvId = btn.dataset.id;
                btn.disabled = true;
                btn.style.opacity = "0.5";
                try {
                    await fetch(`/api/mcp/servers/${encodeURIComponent(srvId)}/restart`, {
                        method: "POST"
                    });
                    await McpActiveTools.refresh();
                    renderMcpServersList();
                } catch (err) {
                    console.error("MCP restart error:", err);
                }
            });
        });

        listEl.querySelectorAll(".mcp-delete-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const srvId = btn.dataset.id;
                if (!confirm(`Are you sure you want to remove MCP server '${srvId}'?`)) return;
                try {
                    await fetch(`/api/mcp/servers/${encodeURIComponent(srvId)}`, {
                        method: "DELETE"
                    });
                    await McpActiveTools.refresh();
                    renderMcpServersList();
                } catch (err) {
                    console.error("MCP delete error:", err);
                }
            });
        });

    } catch (err) {
        listEl.innerHTML = `<div class="mcp-empty-state">Failed to load MCP servers: ${escapeHTML(err.message)}</div>`;
    }
}

/**
 * Initializes listeners for MCP server form and sync actions in Settings
 */
export function initMcpSettingsControls() {
    const btnToggleAdd = document.getElementById("btnToggleAddMcpServer");
    const containerAdd = document.getElementById("mcpAddServerContainer");
    const btnCancelAdd = document.getElementById("btnCancelAddMcpServer");
    const btnSave = document.getElementById("btnSaveMcpServer");
    const btnRefresh = document.getElementById("btnRefreshMcpServers");
    const transportSelect = document.getElementById("mcpNewTransport");
    const commandField = document.getElementById("mcpCommandField");
    const argsField = document.getElementById("mcpArgsField");
    const urlField = document.getElementById("mcpUrlField");
    const errEl = document.getElementById("mcpAddError");

    if (transportSelect) {
        transportSelect.addEventListener("change", (e) => {
            const isSse = e.target.value === "sse";
            if (commandField) commandField.style.display = isSse ? "none" : "flex";
            if (argsField) argsField.style.display = isSse ? "none" : "flex";
            if (urlField) urlField.style.display = isSse ? "flex" : "none";
        });
    }

    if (btnToggleAdd && containerAdd) {
        btnToggleAdd.addEventListener("click", () => {
            const isHidden = containerAdd.style.display === "none";
            containerAdd.style.display = isHidden ? "flex" : "none";
            if (errEl) errEl.style.display = "none";
            if (isHidden) {
                renderIcons(containerAdd);
                const idInput = document.getElementById("mcpNewServerId");
                if (idInput) idInput.focus();
            }
        });
    }

    if (btnCancelAdd && containerAdd) {
        btnCancelAdd.addEventListener("click", () => {
            containerAdd.style.display = "none";
            if (errEl) errEl.style.display = "none";
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            btnRefresh.disabled = true;
            btnRefresh.style.opacity = "0.5";
            try {
                await McpActiveTools.refresh();
                await renderMcpServersList();
            } finally {
                btnRefresh.disabled = false;
                btnRefresh.style.opacity = "1";
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener("click", async () => {
            const idInput = document.getElementById("mcpNewServerId");
            const transportInput = document.getElementById("mcpNewTransport");
            const commandInput = document.getElementById("mcpNewCommand");
            const argsInput = document.getElementById("mcpNewArgs");
            const urlInput = document.getElementById("mcpNewUrl");

            const id = (idInput?.value || "").trim();
            const transport = transportInput?.value || "stdio";
            const command = (commandInput?.value || "").trim();
            const rawArgs = (argsInput?.value || "").trim();
            const url = (urlInput?.value || "").trim();

            if (!id) {
                showError("Server identifier is required.");
                return;
            }

            if (transport === "sse" && !url) {
                showError("SSE URL is required for SSE transport.");
                return;
            }

            if (transport === "stdio" && !command) {
                showError("Command executable is required for stdio transport.");
                return;
            }

            let parsedArgs = [];
            if (rawArgs) {
                try {
                    if (rawArgs.startsWith("[") && rawArgs.endsWith("]")) {
                        parsedArgs = JSON.parse(rawArgs);
                    } else {
                        parsedArgs = rawArgs.split(/\s+/).filter(Boolean);
                    }
                } catch (_) {
                    parsedArgs = rawArgs.split(/\s+/).filter(Boolean);
                }
            }

            btnSave.disabled = true;
            btnSave.style.opacity = "0.6";
            if (errEl) errEl.style.display = "none";

            try {
                const res = await fetch("/api/mcp/servers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id,
                        transport,
                        command: transport === "stdio" ? command : undefined,
                        args: transport === "stdio" ? parsedArgs : undefined,
                        url: transport === "sse" ? url : undefined,
                        enabled: true
                    })
                });

                const result = await res.json();
                if (!res.ok || result.error) {
                    showError(result.error || "Failed to add server");
                    return;
                }

                // Reset inputs and close form
                if (idInput) idInput.value = "";
                if (commandInput) commandInput.value = "";
                if (argsInput) argsInput.value = "";
                if (urlInput) urlInput.value = "";
                if (containerAdd) containerAdd.style.display = "none";

                await McpActiveTools.refresh();
                await renderMcpServersList();
            } catch (err) {
                showError(err.message || "Failed to save server");
            } finally {
                btnSave.disabled = false;
                btnSave.style.opacity = "1";
            }

            function showError(msg) {
                if (errEl) {
                    errEl.textContent = msg;
                    errEl.style.display = "block";
                }
            }
        });
    }
}

/**
 * Renders the selectable Sandbox & VM Isolation profile cards dynamically from /api/sandbox/profiles
 */
export async function renderSandboxProfiles() {
    const gridEl = document.getElementById("sandboxProfilesGrid");
    const toggleEl = document.getElementById("cfgEnableSandbox");
    const statusTextEl = document.getElementById("sandboxStatusText");
    if (!gridEl) return;

    try {
        const res = await fetch("/api/sandbox/profiles");
        if (!res.ok) throw new Error("Failed to load profiles");
        const data = await res.json();

        const isEnabled = Boolean(data.enabled);
        if (toggleEl) {
            toggleEl.checked = isEnabled;
        }

        gridEl.classList.toggle("disabled", !isEnabled);
        gridEl.innerHTML = "";

        const profiles = data.profiles || [];
        profiles.forEach(p => {
            const card = document.createElement("div");
            card.className = `sandbox-profile-card ${p.isActive ? "active" : ""}`;
            card.dataset.profileId = p.id;
            card.setAttribute("role", "button");
            card.setAttribute("tabindex", isEnabled ? "0" : "-1");
            card.setAttribute("aria-pressed", p.isActive ? "true" : "false");

            const iconName = p.icon || "box";
            const statusClass = p.isInstalled ? "installed" : "missing";
            const statusText = p.isInstalled ? "Installed" : "Not detected";

            card.innerHTML = `
                <div class="sandbox-card-header">
                    <div class="sandbox-card-title-wrap">
                        <i data-lucide="${escapeHTML(iconName)}" class="sandbox-card-icon"></i>
                        <span class="sandbox-card-title">${escapeHTML(p.name)}</span>
                    </div>
                    ${p.badge ? `<span class="sandbox-card-badge">${escapeHTML(p.badge)}</span>` : ""}
                </div>
                <div class="sandbox-card-desc">${escapeHTML(p.description || "")}</div>
                <div class="sandbox-card-footer">
                    <div class="sandbox-status-indicator">
                        <span class="sandbox-status-dot ${statusClass}"></span>
                        <span>${statusText}</span>
                    </div>
                    <i data-lucide="check" class="sandbox-card-check"></i>
                </div>
            `;

            const onSelect = async () => {
                if (toggleEl && !toggleEl.checked) return;
                await selectSandboxProfile(p.id, true);
            };

            card.addEventListener("click", onSelect);
            card.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                }
            });

            gridEl.appendChild(card);
        });

        if (statusTextEl) {
            if (!isEnabled) {
                statusTextEl.textContent = "Sandboxing disabled · Tasks execute directly on host";
            } else {
                const activeProfile = profiles.find(p => p.isActive);
                const activeName = activeProfile ? activeProfile.name : (data.active_profile || "Bubblewrap");
                statusTextEl.textContent = `Active Sandbox: ${activeName}`;
            }
        }

        renderIcons(gridEl);
    } catch (err) {
        gridEl.innerHTML = `<div class="mcp-empty-state">Failed to load sandbox environments: ${escapeHTML(err.message)}</div>`;
    }
}

async function selectSandboxProfile(profileId, enabled) {
    try {
        const res = await fetch("/api/sandbox/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile_id: profileId, enabled })
        });
        if (res.ok) {
            await renderSandboxProfiles();
        }
    } catch (err) {
        console.error("Failed to select sandbox profile:", err);
    }
}

export function initSandboxSettingsControls() {
    const toggleEl = document.getElementById("cfgEnableSandbox");
    if (toggleEl) {
        toggleEl.addEventListener("change", async (e) => {
            const isChecked = e.target.checked;
            try {
                await fetch("/api/sandbox/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: isChecked })
                });
                await renderSandboxProfiles();
            } catch (err) {
                console.error("Failed to toggle sandbox:", err);
            }
        });
    }
}


