/* =========================================================
   CUSTOM SLEEK MODEL PICKER (MINIMAL & MOBILE-OPTIMIZED)
   ========================================================= */
import { renderIcons } from "../utils/dom.js";
import { state } from "../state.js";

let isPickerOpen = false;
let currentSearch = "";
// Provider groups are collapsed by default. Keys are provider ids (or group labels).
const expandedGroups = new Set();

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

export function renderModelPickerList(filter = "") {
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
            // Groups stay collapsed by default; searching temporarily expands matches.
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
                // Re-rendering detaches this node, which would otherwise make the
                // document-level outside-click handler think the click was outside.
                e.stopPropagation();
                if (isSearching) return;
                if (expandedGroups.has(groupKey)) {
                    expandedGroups.delete(groupKey);
                } else {
                    expandedGroups.add(groupKey);
                }
                renderModelPickerList(filter);
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
        // Direct options without optgroup
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
        return; // Don't select the placeholder
    }

    if (modelSelect && modelSelect.value !== modelValue) {
        modelSelect.value = modelValue;
        modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    updateModelPickerDisplay();
    closeModelPicker();
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

    currentSearch = "";
    if (searchInput) searchInput.value = "";
    expandedGroups.clear();

    renderModelPickerList("");

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

    // Scroll active item into view
    setTimeout(() => {
        const selectedItem = dropdown.querySelector(".model-item.selected");
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        if (searchInput && window.innerWidth > 640) {
            searchInput.focus();
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
    if (dropdown) {
        dropdown.classList.remove("is-open");
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
        if (dropdown && !dropdown.contains(e.target)) {
            closeModelPicker();
        }
    });

    if (backdrop) {
        backdrop.addEventListener("click", () => {
            closeModelPicker();
        });
    }

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentSearch = searchInput.value;
            if (searchClear) {
                searchClear.style.display = currentSearch ? "flex" : "none";
            }
            renderModelPickerList(currentSearch);
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
            renderModelPickerList("");
        });
    }

    // Close on Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isPickerOpen) {
            closeModelPicker();
        }
    });

    // Sync when underlying modelSelect changes
    if (modelSelect) {
        modelSelect.addEventListener("change", () => {
            updateModelPickerDisplay();
        });

        // Watch for dynamic options loading or highlight-pulse class changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.type === "childList") {
                    updateModelPickerDisplay();
                    if (isPickerOpen) renderModelPickerList(currentSearch);
                } else if (m.type === "attributes" && m.attributeName === "class") {
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

    // Initial label update
    updateModelPickerDisplay();
}
