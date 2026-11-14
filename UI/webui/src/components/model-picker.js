/* =========================================================
   CUSTOM SLEEK MODEL PICKER (TWO-PANE DESKTOP & MOBILE DRAWER)
   ========================================================= */
import { renderIcons } from "../utils/dom.js";
import { state } from "../state.js";
import { availableModels } from "../services/models.js";

let isPickerOpen = false;
let currentSearch = "";
// Mobile provider groups state: collapsed by default
const expandedGroups = new Set();

// Desktop picker state
let desktopActiveProvider = "all";
let desktopCapabilityFilter = "all"; // "all" | "vision" | "free" | "tools"
let desktopFocusedIndex = -1;

/**
 * Checks whether the current view is a mobile viewport or Android container.
 */
export function isMobileView() {
    return window.innerWidth <= 768 || (typeof document !== "undefined" && document.documentElement.classList.contains("is-android"));
}

export function updateModelPickerDisplay() {
    const modelSelect = document.getElementById("modelSelect");
    const nameEl = document.getElementById("modelPickerName");
    const heroNameEl = document.getElementById("heroModelPickerName");
    if (!modelSelect) return;

    const opt = modelSelect.selectedOptions?.[0];
    let cleanText = "";
    let fullText = "";
    if (opt) {
        fullText = opt.textContent || opt.value;
        cleanText = fullText.replace(/\s*\[Vision\]/i, "").trim();
    } else if (modelSelect.value) {
        cleanText = modelSelect.value;
        fullText = modelSelect.value;
    }

    if (nameEl && cleanText) {
        nameEl.textContent = cleanText;
        nameEl.title = fullText;
    }
    if (heroNameEl && cleanText) {
        heroNameEl.textContent = cleanText;
        heroNameEl.title = fullText;
    }
    const chatboxNameEl = document.getElementById("chatboxModelPickerName");
    if (chatboxNameEl && cleanText) {
        chatboxNameEl.textContent = cleanText;
        chatboxNameEl.title = fullText;
    }
}

/**
 * Extracts structured model and provider information from the underlying modelSelect and models service.
 */
function getModelData() {
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect) return { providers: [], allModels: [] };

    const optgroups = Array.from(modelSelect.querySelectorAll("optgroup"));
    const providers = [];
    const allModels = [];

    const metaMap = {};
    if (Array.isArray(availableModels)) {
        for (const m of availableModels) {
            metaMap[m.id] = m;
        }
    }

    if (optgroups.length > 0) {
        optgroups.forEach((group, idx) => {
            const providerId = group.dataset.provider || `provider_${idx}`;
            const providerName = group.label.replace(/\s*\(No Key\)/i, "").trim();
            const hasNoKey = /\(No Key\)/i.test(group.label) || group.disabled;
            const rawOptions = Array.from(group.querySelectorAll("option"));

            const models = rawOptions.map(opt => {
                const meta = metaMap[opt.value] || {};
                const isRolling = opt.dataset.rolling === "true" || opt.value.startsWith("__rolling_connect__");
                const isVision = opt.dataset.vision === "true" || meta.supports_vision || /\[Vision\]/i.test(opt.textContent);
                const isTools = meta.supports_tools === true;
                const isFree = /:free/i.test(opt.value) || /\(Free\)/i.test(opt.textContent);
                const cleanName = opt.textContent.replace(/\s*\[Vision\]/i, "").replace(/\s*\(Free\)/i, "").trim();
                const contextTokens = meta.max_context_tokens || null;

                const modelObj = {
                    id: opt.value,
                    name: cleanName,
                    rawName: opt.textContent,
                    providerId,
                    providerName,
                    isVision,
                    isTools,
                    isFree,
                    isRolling,
                    contextTokens,
                    disabled: opt.disabled || hasNoKey
                };
                allModels.push(modelObj);
                return modelObj;
            });

            providers.push({
                id: providerId,
                name: providerName,
                hasNoKey,
                models,
                count: models.length
            });
        });
    } else {
        const rawOptions = Array.from(modelSelect.querySelectorAll("option"));
        const models = rawOptions.map(opt => {
            const cleanName = opt.textContent.replace(/\s*\[Vision\]/i, "").trim();
            const modelObj = {
                id: opt.value,
                name: cleanName,
                rawName: opt.textContent,
                providerId: "default",
                providerName: "General",
                isVision: /\[Vision\]/i.test(opt.textContent),
                isTools: false,
                isFree: /:free/i.test(opt.value),
                isRolling: false,
                contextTokens: null,
                disabled: opt.disabled
            };
            allModels.push(modelObj);
            return modelObj;
        });
        providers.push({
            id: "all",
            name: "All Models",
            hasNoKey: false,
            models,
            count: models.length
        });
    }

    return { providers, allModels };
}

function getProviderMonogram(providerId, providerName) {
    const id = (providerId || "").toLowerCase();
    if (id === "gemini") return "GE";
    if (id === "zai") return "ZA";
    if (id === "groq") return "GQ";
    if (id === "openrouter") return "OR";
    if (id === "nim" || id === "nvidia") return "NV";
    if (id === "cohere") return "CO";
    if (id === "arliai") return "AR";
    if (id === "llm7") return "L7";
    if (id === "logfare") return "LF";
    if (id === "local") return "LC";
    if (id === "koboldcpp") return "KC";
    if (!providerName) return "AI";
    const words = providerName.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return providerName.slice(0, 2).toUpperCase();
}

function formatContextTokens(tokens) {
    if (!tokens || typeof tokens !== "number") return "";
    if (tokens >= 1000000) {
        const m = (tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1);
        return `${m}M ctx`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}k ctx`;
    }
    return `${tokens} ctx`;
}

function selectModel(modelValue) {
    const modelSelect = document.getElementById("modelSelect");

    // Rolling connect placeholder — show the connect modal instead of selecting
    if (modelValue && modelValue.startsWith("__rolling_connect__")) {
        const providerId = modelValue.replace("__rolling_connect__", "");
        if (providerId === "local" || providerId === "koboldcpp") {
            closeModelPicker();
            import("./local-connect.js").then(lc => {
                lc.showLocalConnectModal((data) => {
                    // Model was injected by local-connect, picker will auto-update
                });
            });
        }
        return;
    }

    if (modelSelect && modelSelect.value !== modelValue) {
        modelSelect.value = modelValue;
        modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    updateModelPickerDisplay();
    closeModelPicker();
}

/* ─────────────────────────────────────────────────────────────
   MOBILE VIEW MODEL PICKER (ORIGINAL ACCORDION LIST)
   ───────────────────────────────────────────────────────────── */
function renderMobileModelPickerList(filter = "") {
    const listEl = document.getElementById("modelPickerList");
    const modelSelect = document.getElementById("modelSelect");
    if (!listEl || !modelSelect) return;

    listEl.innerHTML = "";
    const filterLower = filter.trim().toLowerCase();
    const currentVal = modelSelect.value;

    const optgroups = modelSelect.querySelectorAll("optgroup");
    let totalRendered = 0;

    if (optgroups.length > 0) {
        optgroups.forEach((group, groupIndex) => {
            const rawOptions = Array.from(group.querySelectorAll("option"));
            const matchingOptions = rawOptions.filter(opt => {
                if (!filterLower) return true;
                const text = (opt.textContent || "").toLowerCase();
                const val = (opt.value || "").toLowerCase();
                return text.includes(filterLower) || val.includes(filterLower);
            });

            if (matchingOptions.length === 0) return;

            const groupKey = group.dataset.provider || group.label;
            const isSearching = Boolean(filterLower);
            const isExpanded = isSearching || expandedGroups.has(groupKey);

            const groupEl = document.createElement("div");
            groupEl.className = `model-group${isExpanded ? " is-expanded" : ""}`;

            const itemsId = `modelGroupItems-${groupIndex}`;

            const headerEl = document.createElement("button");
            headerEl.type = "button";
            headerEl.className = "model-group-header";
            headerEl.setAttribute("aria-expanded", isExpanded ? "true" : "false");
            headerEl.setAttribute("aria-controls", itemsId);

            const titleEl = document.createElement("span");
            titleEl.className = "model-group-title";
            titleEl.textContent = group.label;

            const chevronEl = document.createElement("i");
            chevronEl.setAttribute("data-lucide", "chevron-down");
            chevronEl.className = "model-group-chevron";

            headerEl.append(titleEl, chevronEl);

            headerEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (isSearching) return;
                if (expandedGroups.has(groupKey)) {
                    expandedGroups.delete(groupKey);
                } else {
                    expandedGroups.add(groupKey);
                }
                renderMobileModelPickerList(filter);
            });

            groupEl.appendChild(headerEl);

            const itemsEl = document.createElement("div");
            itemsEl.className = "model-group-items";
            itemsEl.id = itemsId;
            itemsEl.hidden = !isExpanded;

            matchingOptions.forEach(opt => {
                totalRendered++;
                const isSelected = opt.value === currentVal;
                const isVision = opt.dataset.vision === "true" || /\[Vision\]/i.test(opt.textContent);
                const cleanName = opt.textContent.replace(/\s*\[Vision\]/i, "").trim();

                const item = document.createElement("button");
                item.type = "button";
                item.className = `model-item ${isSelected ? "selected" : ""}`;
                item.dataset.modelValue = opt.value;
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", isSelected ? "true" : "false");

                item.innerHTML = `
                    <div class="model-item-info">
                        <span class="model-item-name">${cleanName}</span>
                        ${isVision ? '<span class="model-vision-badge">Vision</span>' : ''}
                    </div>
                    ${isSelected ? '<i data-lucide="check" class="model-check-icon"></i>' : ''}
                `;

                item.addEventListener("click", () => {
                    selectModel(opt.value);
                });

                itemsEl.appendChild(item);
            });

            groupEl.appendChild(itemsEl);
            listEl.appendChild(groupEl);
        });
    } else {
        const rawOptions = Array.from(modelSelect.querySelectorAll("option"));
        const matchingOptions = rawOptions.filter(opt => {
            if (!filterLower) return true;
            return (opt.textContent || "").toLowerCase().includes(filterLower);
        });

        matchingOptions.forEach(opt => {
            totalRendered++;
            const isSelected = opt.value === currentVal;
            const isVision = /\[Vision\]/i.test(opt.textContent);
            const cleanName = opt.textContent.replace(/\s*\[Vision\]/i, "").trim();

            const item = document.createElement("button");
            item.type = "button";
            item.className = `model-item ${isSelected ? "selected" : ""}`;
            item.dataset.modelValue = opt.value;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", isSelected ? "true" : "false");

            item.innerHTML = `
                <div class="model-item-info">
                    <span class="model-item-name">${cleanName}</span>
                    ${isVision ? '<span class="model-vision-badge">Vision</span>' : ''}
                </div>
                ${isSelected ? '<i data-lucide="check" class="model-check-icon"></i>' : ''}
            `;

            item.addEventListener("click", () => {
                selectModel(opt.value);
            });

            listEl.appendChild(item);
        });
    }

    if (totalRendered === 0) {
        listEl.innerHTML = '<div class="model-picker-empty">No matching models found</div>';
    }

    renderIcons(listEl);
}

/* ─────────────────────────────────────────────────────────────
   DESKTOP VIEW MODEL PICKER (TWO-PANE COMMAND PALETTE)
   ───────────────────────────────────────────────────────────── */
function ensureDesktopContainer(dropdown) {
    let container = dropdown.querySelector(".desktop-picker-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "desktop-picker-container";

        // Stop clicks inside desktop modal from propagating to document outside-click listener
        container.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        container.innerHTML = `
            <div class="desktop-picker-header">
                <div class="desktop-search-wrap">
                    <svg class="desktop-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input type="text" id="desktopModelSearchInput" class="desktop-search-input" placeholder="Search models by name, provider, or capability (e.g. vision, free)..." autocomplete="off" spellcheck="false" aria-label="Search models">
                    <button type="button" class="desktop-search-clear" id="desktopSearchClear" style="display: none;" title="Clear search" aria-label="Clear search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                    <div class="desktop-kbd-hint"><kbd>Esc</kbd> to close</div>
                </div>
                <div class="desktop-filter-chips">
                    <button type="button" class="desktop-filter-chip active" data-filter="all">All Models</button>
                    <button type="button" class="desktop-filter-chip" data-filter="vision">Vision</button>
                    <button type="button" class="desktop-filter-chip" data-filter="free">Free</button>
                    <button type="button" class="desktop-filter-chip" data-filter="tools">Tools</button>
                </div>
            </div>
            <div class="desktop-picker-split">
                <div class="desktop-providers-pane">
                    <div class="desktop-pane-title">Providers</div>
                    <div class="desktop-providers-list" id="desktopProvidersList"></div>
                </div>
                <div class="desktop-models-pane">
                    <div class="desktop-models-header">
                        <div class="desktop-models-header-title" id="desktopModelsHeaderTitle">All Models</div>
                        <div class="desktop-models-header-meta" id="desktopModelsHeaderMeta">0 models available</div>
                    </div>
                    <div class="desktop-models-list" id="desktopModelsList" role="listbox"></div>
                </div>
            </div>
            <div class="desktop-picker-footer">
                <div class="desktop-active-summary">
                    <span class="desktop-status-dot"></span>
                    <span class="desktop-active-label">Active:</span>
                    <span class="desktop-active-model-name" id="desktopActiveModelName">-</span>
                    <span class="desktop-active-provider-name" id="desktopActiveProviderName">-</span>
                </div>
                <div class="desktop-footer-shortcuts">
                    <span class="desktop-shortcut-item"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span class="desktop-shortcut-item"><kbd>↵</kbd> select</span>
                    <span class="desktop-shortcut-item"><kbd>Esc</kbd> dismiss</span>
                </div>
            </div>
        `;
        dropdown.appendChild(container);

        const searchInput = container.querySelector("#desktopModelSearchInput");
        const clearBtn = container.querySelector("#desktopSearchClear");

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                currentSearch = searchInput.value;
                if (clearBtn) clearBtn.style.display = currentSearch ? "inline-flex" : "none";
                desktopFocusedIndex = 0;
                renderDesktopModelPicker(currentSearch);
            });
            searchInput.addEventListener("keydown", handleDesktopKeydown);
        }

        if (clearBtn) {
            clearBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (searchInput) {
                    searchInput.value = "";
                    searchInput.focus();
                }
                currentSearch = "";
                clearBtn.style.display = "none";
                desktopFocusedIndex = -1;
                renderDesktopModelPicker("");
            });
        }

        container.querySelectorAll(".desktop-filter-chip").forEach(chip => {
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                container.querySelectorAll(".desktop-filter-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                desktopCapabilityFilter = chip.dataset.filter || "all";
                desktopFocusedIndex = 0;
                renderDesktopModelPicker(currentSearch);
            });
        });
    }
    return container;
}

function handleDesktopKeydown(e) {
    const listEl = document.getElementById("desktopModelsList");
    if (!listEl) return;
    const cards = Array.from(listEl.querySelectorAll(".desktop-model-card"));
    if (cards.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        desktopFocusedIndex = (desktopFocusedIndex + 1) % cards.length;
        updateCardFocus(cards);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        desktopFocusedIndex = (desktopFocusedIndex - 1 + cards.length) % cards.length;
        updateCardFocus(cards);
    } else if (e.key === "Enter") {
        e.preventDefault();
        const targetCard = cards[desktopFocusedIndex >= 0 ? desktopFocusedIndex : 0];
        if (targetCard) {
            targetCard.click();
        }
    }
}

function updateCardFocus(cards) {
    cards.forEach((c, idx) => {
        const isFocused = idx === desktopFocusedIndex;
        c.classList.toggle("keyboard-focused", isFocused);
        if (isFocused) {
            c.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    });
}

function passesDesktopCapability(m) {
    if (desktopCapabilityFilter === "vision") return m.isVision;
    if (desktopCapabilityFilter === "free") return m.isFree;
    if (desktopCapabilityFilter === "tools") return m.isTools;
    return true;
}

function passesDesktopSearch(m, filterLower) {
    if (!filterLower) return true;
    const text = `${m.name} ${m.id} ${m.providerName}`.toLowerCase();
    if (text.includes(filterLower)) return true;
    if (filterLower === "vision" && m.isVision) return true;
    if (filterLower === "free" && m.isFree) return true;
    if (filterLower === "tools" && m.isTools) return true;
    return false;
}

function selectDesktopProvider(providerId, container) {
    desktopActiveProvider = providerId;
    desktopFocusedIndex = 0;

    const providersListEl = container.querySelector("#desktopProvidersList");
    if (providersListEl) {
        providersListEl.querySelectorAll(".desktop-provider-item").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.providerId === providerId);
        });
    }

    const modelSelect = document.getElementById("modelSelect");
    const currentVal = modelSelect ? modelSelect.value : "";
    const { providers, allModels } = getModelData();
    renderDesktopModelsPane(container, allModels, providers, currentSearch, currentVal);
}

function renderDesktopModelsPane(container, allModels, providers, filter, currentVal) {
    const modelsListEl = container.querySelector("#desktopModelsList");
    const headerTitleEl = container.querySelector("#desktopModelsHeaderTitle");
    const headerMetaEl = container.querySelector("#desktopModelsHeaderMeta");
    if (!modelsListEl) return;

    const filterLower = (filter || "").trim().toLowerCase();

    const displayedModels = allModels.filter(m => {
        if (desktopActiveProvider !== "all" && m.providerId !== desktopActiveProvider) {
            return false;
        }
        return passesDesktopCapability(m) && passesDesktopSearch(m, filterLower);
    });

    if (headerTitleEl) {
        if (desktopActiveProvider === "all") {
            headerTitleEl.textContent = "All Models";
        } else {
            const currentP = providers.find(p => p.id === desktopActiveProvider);
            headerTitleEl.textContent = currentP ? currentP.name : "Models";
        }
    }
    if (headerMetaEl) {
        headerMetaEl.textContent = `${displayedModels.length} models available`;
    }

    modelsListEl.innerHTML = "";

    if (displayedModels.length === 0) {
        modelsListEl.innerHTML = `
            <div class="desktop-models-empty">
                No models found matching your criteria.
            </div>
        `;
        return;
    }

    displayedModels.forEach((m, idx) => {
        const isSelected = m.id === currentVal;
        const card = document.createElement("button");
        card.type = "button";
        card.className = `desktop-model-card ${isSelected ? "selected" : ""} ${idx === desktopFocusedIndex ? "keyboard-focused" : ""}`;
        card.dataset.modelId = m.id;
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", isSelected ? "true" : "false");

        const badgesHtml = `
            ${m.isVision ? '<span class="desktop-badge-vision">Vision</span>' : ''}
            ${m.isFree ? '<span class="desktop-badge-free">Free</span>' : ''}
            ${m.isTools ? '<span class="desktop-badge-tools">Tools</span>' : ''}
            ${m.isRolling ? '<span class="desktop-badge-rolling">Connect</span>' : ''}
        `;

        const checkIconHtml = isSelected ? `
            <svg class="desktop-model-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        ` : '';

        const ctxHtml = m.contextTokens ? `<span class="desktop-model-ctx">${formatContextTokens(m.contextTokens)}</span>` : '';
        const providerTagHtml = (desktopActiveProvider === "all") ? `<span class="desktop-model-provider-tag">${m.providerName}</span>` : '';

        card.innerHTML = `
            <div class="desktop-model-top">
                <span class="desktop-model-name" title="${m.name}">${m.name}</span>
                <div class="desktop-model-badges">
                    ${badgesHtml}
                    ${checkIconHtml}
                </div>
            </div>
            <div class="desktop-model-bottom">
                <span class="desktop-model-id" title="${m.id}">${m.id}</span>
                ${providerTagHtml}
                ${ctxHtml}
            </div>
        `;

        card.addEventListener("click", (e) => {
            e.stopPropagation();
            selectModel(m.id);
        });

        modelsListEl.appendChild(card);
    });
}

function renderDesktopModelPicker(filter = "") {
    const dropdown = document.getElementById("modelPickerDropdown");
    const modelSelect = document.getElementById("modelSelect");
    if (!dropdown || !modelSelect) return;

    const container = ensureDesktopContainer(dropdown);
    const providersListEl = container.querySelector("#desktopProvidersList");
    const activeModelNameEl = container.querySelector("#desktopActiveModelName");
    const activeProviderNameEl = container.querySelector("#desktopActiveProviderName");

    const currentVal = modelSelect.value;
    const { providers, allModels } = getModelData();
    const filterLower = filter.trim().toLowerCase();

    // 1. Update Footer Active Model Display
    const activeModelObj = allModels.find(m => m.id === currentVal);
    if (activeModelObj) {
        if (activeModelNameEl) activeModelNameEl.textContent = activeModelObj.name;
        if (activeProviderNameEl) activeProviderNameEl.textContent = `• ${activeModelObj.providerName}`;
    } else {
        if (activeModelNameEl) activeModelNameEl.textContent = currentVal || "None";
        if (activeProviderNameEl) activeProviderNameEl.textContent = "";
    }

    // 2. Calculate match count per provider
    const providerCounts = {};
    let totalMatchingModels = 0;

    allModels.forEach(m => {
        if (passesDesktopCapability(m) && passesDesktopSearch(m, filterLower)) {
            totalMatchingModels++;
            providerCounts[m.providerId] = (providerCounts[m.providerId] || 0) + 1;
        }
    });

    // 3. Render Providers List in Left Pane
    providersListEl.innerHTML = "";

    // "All Providers" entry
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.dataset.providerId = "all";
    allBtn.className = `desktop-provider-item ${desktopActiveProvider === "all" ? "active" : ""}`;
    allBtn.innerHTML = `
        <span class="desktop-provider-monogram">ALL</span>
        <span class="desktop-provider-name">All Providers</span>
        <span class="desktop-provider-count">${totalMatchingModels}</span>
    `;
    allBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectDesktopProvider("all", container);
    });
    providersListEl.appendChild(allBtn);

    // Each Provider entry
    providers.forEach(p => {
        const count = providerCounts[p.id] || 0;
        // In search mode, hide providers with 0 matching models
        if (filterLower && count === 0 && desktopActiveProvider !== p.id) {
            return;
        }

        const monogram = getProviderMonogram(p.id, p.name);
        const pBtn = document.createElement("button");
        pBtn.type = "button";
        pBtn.dataset.providerId = p.id;
        pBtn.className = `desktop-provider-item ${desktopActiveProvider === p.id ? "active" : ""}`;
        pBtn.innerHTML = `
            <span class="desktop-provider-monogram">${monogram}</span>
            <span class="desktop-provider-name" title="${p.name}">${p.name}</span>
            <span class="desktop-provider-count">${count}</span>
        `;
        pBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            selectDesktopProvider(p.id, container);
        });
        providersListEl.appendChild(pBtn);
    });

    // 4. Render Right Models Pane
    renderDesktopModelsPane(container, allModels, providers, filter, currentVal);
}

/**
 * Main export: delegates to mobile or desktop renderer depending on viewport.
 */
export function renderModelPickerList(filter = "") {
    const isMobile = isMobileView();
    const dropdown = document.getElementById("modelPickerDropdown");
    if (dropdown) {
        dropdown.classList.toggle("is-desktop-view", !isMobile);
    }

    if (isMobile) {
        renderMobileModelPickerList(filter);
    } else {
        renderDesktopModelPicker(filter);
    }
}

let currentOpenSource = "header";

function positionModelPicker(source = "header") {
    const dropdown = document.getElementById("modelPickerDropdown");
    if (!dropdown) return;

    if (!isMobileView()) {
        resetDropdownPosition(dropdown);
        return;
    }

    const chatboxBtn = document.getElementById("chatboxModelPickerBtn");
    const heroBtn = document.getElementById("heroModelPickerBtn");
    const headerBtn = document.getElementById("modelPickerBtn");

    let anchor = null;
    if (source === "chatbox" && chatboxBtn && chatboxBtn.offsetParent !== null) {
        anchor = chatboxBtn;
    } else if (source === "hero" && heroBtn && heroBtn.offsetParent !== null) {
        anchor = heroBtn;
    } else if (source === "header" && headerBtn && headerBtn.offsetParent !== null) {
        anchor = headerBtn;
    } else if (chatboxBtn && chatboxBtn.offsetParent !== null) {
        anchor = chatboxBtn;
    } else if (heroBtn && heroBtn.offsetParent !== null) {
        anchor = heroBtn;
    } else if (headerBtn && headerBtn.offsetParent !== null) {
        anchor = headerBtn;
    }

    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const minMargin = 12;

    if (anchor && anchor !== headerBtn) {
        const rect = anchor.getBoundingClientRect();
        dropdown.classList.add("docked-bottom");

        const spaceAbove = rect.top - minMargin;
        const spaceBelow = vpHeight - rect.bottom - minMargin;

        const dropdownWidth = Math.min(370, vpWidth - 24);
        dropdown.style.width = "min(370px, calc(100vw - 24px))";

        if (vpWidth >= 640) {
            let targetLeft = rect.left;
            if (targetLeft + dropdownWidth > vpWidth - minMargin) {
                targetLeft = vpWidth - dropdownWidth - minMargin;
            }
            if (targetLeft < minMargin) {
                targetLeft = minMargin;
            }
            dropdown.style.left = `${Math.round(targetLeft)}px`;
            dropdown.style.transform = "none";
        } else {
            dropdown.style.left = "50%";
            dropdown.style.transform = "translateX(-50%)";
        }

        if (spaceAbove >= 200 || spaceAbove >= spaceBelow) {
            const maxH = Math.max(160, Math.floor(spaceAbove - 8));
            dropdown.style.top = "auto";
            dropdown.style.bottom = `${Math.max(minMargin, Math.round(vpHeight - rect.top + 6))}px`;
            dropdown.style.maxHeight = `${maxH}px`;
        } else {
            const maxH = Math.max(160, Math.floor(spaceBelow - 8));
            dropdown.style.bottom = "auto";
            dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
            dropdown.style.maxHeight = `${maxH}px`;
        }
    } else {
        dropdown.classList.remove("docked-bottom");
        dropdown.style.width = "min(370px, calc(100vw - 28px))";
        dropdown.style.left = "50%";
        dropdown.style.transform = "translateX(-50%)";
        dropdown.style.bottom = "auto";
        dropdown.style.top = "calc(56px + env(safe-area-inset-top, 0px) + 8px)";
        dropdown.style.maxHeight = "calc(100dvh - 120px)";
    }
}

function resetDropdownPosition(dropdown) {
    if (!dropdown) return;
    dropdown.style.top = "";
    dropdown.style.bottom = "";
    dropdown.style.left = "";
    dropdown.style.transform = "";
    dropdown.style.maxHeight = "";
    dropdown.style.width = "";
    dropdown.classList.remove("docked-bottom");
}

export function openModelPicker(source = "header") {
    const dropdown = document.getElementById("modelPickerDropdown");
    const backdrop = document.getElementById("modelPickerBackdrop");
    const btn = document.getElementById("modelPickerBtn");
    const heroBtn = document.getElementById("heroModelPickerBtn");
    const chatboxBtn = document.getElementById("chatboxModelPickerBtn");
    const searchInput = document.getElementById("modelSearchInput");

    if (!dropdown) return;
    isPickerOpen = true;
    currentOpenSource = source;

    const isMobile = isMobileView();
    dropdown.classList.toggle("is-desktop-view", !isMobile);

    currentSearch = "";
    expandedGroups.clear();
    desktopCapabilityFilter = "all";
    desktopFocusedIndex = -1;

    if (isMobile) {
        if (searchInput) searchInput.value = "";
        renderMobileModelPickerList("");
        positionModelPicker(source);
    } else {
        resetDropdownPosition(dropdown);

        // Pre-select current model's provider in desktop sidebar if available
        const modelSelect = document.getElementById("modelSelect");
        const curOpt = modelSelect?.selectedOptions?.[0];
        const curProv = curOpt?.dataset?.provider;
        desktopActiveProvider = curProv || "all";

        renderDesktopModelPicker("");
    }

    dropdown.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    if (btn) {
        btn.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
    }
    if (heroBtn) {
        heroBtn.classList.add("is-open");
        heroBtn.setAttribute("aria-expanded", "true");
    }
    if (chatboxBtn) {
        chatboxBtn.classList.add("is-open");
        chatboxBtn.setAttribute("aria-expanded", "true");
    }

    setTimeout(() => {
        if (isMobile) {
            const selectedItem = dropdown.querySelector(".model-item.selected");
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
            if (searchInput && window.innerWidth > 640) {
                searchInput.focus();
            }
        } else {
            const desktopSearchInput = dropdown.querySelector("#desktopModelSearchInput");
            if (desktopSearchInput) {
                desktopSearchInput.value = "";
                desktopSearchInput.focus();
            }
            const selectedItem = dropdown.querySelector(".desktop-model-card.selected");
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    }, 50);
}

export function closeModelPicker() {
    const dropdown = document.getElementById("modelPickerDropdown");
    const backdrop = document.getElementById("modelPickerBackdrop");
    const btn = document.getElementById("modelPickerBtn");
    const heroBtn = document.getElementById("heroModelPickerBtn");
    const chatboxBtn = document.getElementById("chatboxModelPickerBtn");

    isPickerOpen = false;
    desktopFocusedIndex = -1;

    if (dropdown) {
        dropdown.classList.remove("is-open");
        resetDropdownPosition(dropdown);
    }
    if (backdrop) backdrop.classList.remove("is-open");
    if (btn) {
        btn.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
    }
    if (heroBtn) {
        heroBtn.classList.remove("is-open");
        heroBtn.setAttribute("aria-expanded", "false");
    }
    if (chatboxBtn) {
        chatboxBtn.classList.remove("is-open");
        chatboxBtn.setAttribute("aria-expanded", "false");
    }
}

export function toggleModelPicker(source = "header") {
    if (isPickerOpen) {
        closeModelPicker();
    } else {
        openModelPicker(source);
    }
}

export function initModelPicker() {
    const backdrop = document.getElementById("modelPickerBackdrop");
    const searchInput = document.getElementById("modelSearchInput");
    const searchClear = document.getElementById("modelSearchClear");
    const modelSelect = document.getElementById("modelSelect");

    // Unified click delegation for all model picker buttons and outside-click dismiss
    document.addEventListener("click", (e) => {
        const chatboxTrigger = e.target.closest("#chatboxModelPickerBtn");
        if (chatboxTrigger) {
            e.stopPropagation();
            toggleModelPicker("chatbox");
            return;
        }

        const heroTrigger = e.target.closest("#heroModelPickerBtn");
        if (heroTrigger) {
            e.stopPropagation();
            toggleModelPicker("hero");
            return;
        }

        const headerTrigger = e.target.closest("#modelPickerBtn");
        if (headerTrigger) {
            e.stopPropagation();
            toggleModelPicker("header");
            return;
        }

        if (!isPickerOpen) return;
        const dropdown = document.getElementById("modelPickerDropdown");
        if (!dropdown) return;

        const path = e.composedPath ? e.composedPath() : [];
        const clickedInside = path.length > 0 ? path.includes(dropdown) : dropdown.contains(e.target);
        if (!clickedInside) {
            closeModelPicker();
        }
    });

    window.addEventListener("resize", () => {
        if (isPickerOpen) {
            const isMobile = isMobileView();
            const dropdown = document.getElementById("modelPickerDropdown");
            if (dropdown) {
                dropdown.classList.toggle("is-desktop-view", !isMobile);
            }
            if (isMobile) {
                positionModelPicker(currentOpenSource);
                renderMobileModelPickerList(currentSearch);
            } else {
                resetDropdownPosition(dropdown);
                renderDesktopModelPicker(currentSearch);
            }
        }
    }, { passive: true });

    if (backdrop) {
        backdrop.addEventListener("click", () => {
            closeModelPicker();
        });
    }

    // Mobile search listeners
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentSearch = searchInput.value;
            if (searchClear) {
                searchClear.style.display = currentSearch ? "flex" : "none";
            }
            renderMobileModelPickerList(currentSearch);
        });

        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                closeModelPicker();
            }
        });
    }

    if (searchClear) {
        searchClear.addEventListener("click", () => {
            if (searchInput) {
                searchInput.value = "";
                searchInput.focus();
            }
            currentSearch = "";
            searchClear.style.display = "none";
            renderMobileModelPickerList("");
        });
    }

    // Close on Escape or handle keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        if (!isPickerOpen) return;
        if (e.key === "Escape") {
            closeModelPicker();
        } else if (!isMobileView()) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                handleDesktopKeydown(e);
            }
        }
    });

    // Sync when underlying modelSelect changes
    if (modelSelect) {
        modelSelect.addEventListener("change", () => {
            updateModelPickerDisplay();
            if (isPickerOpen) {
                renderModelPickerList(currentSearch);
            }
        });

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.type === "childList") {
                    updateModelPickerDisplay();
                    if (isPickerOpen) renderModelPickerList(currentSearch);
                } else if (m.type === "attributes" && m.attributeName === "class") {
                    const btn = document.getElementById("chatboxModelPickerBtn");
                    if (modelSelect.classList.contains("highlight-pulse")) {
                        btn?.classList.add("highlight-pulse");
                    } else {
                        btn?.classList.remove("highlight-pulse");
                    }
                }
            });
        });

        observer.observe(modelSelect, { childList: true, attributes: true, attributeFilter: ["class"] });
    }

    updateModelPickerDisplay();
}
