/* =========================================================
   CUSTOM SLEEK MODEL PICKER (MINIMAL & MOBILE-OPTIMIZED)
   ========================================================= */
import { renderIcons } from "../utils/dom.js";
import { state } from "../state.js";

let isPickerOpen = false;
let currentSearch = "";

export function updateModelPickerDisplay() {
    const modelSelect = document.getElementById("modelSelect");
    const nameEl = document.getElementById("modelPickerName");
    if (!modelSelect || !nameEl) return;

    const opt = modelSelect.selectedOptions?.[0];
    if (opt) {
        const text = opt.textContent || opt.value;
        nameEl.textContent = text.replace(/\s*\[Vision\]/i, "").trim();
        nameEl.title = text;
    } else if (modelSelect.value) {
        nameEl.textContent = modelSelect.value;
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
        optgroups.forEach(group => {
            const rawOptions = Array.from(group.querySelectorAll("option"));
            const matchingOptions = rawOptions.filter(opt => {
                if (!filterLower) return true;
                const text = (opt.textContent || "").toLowerCase();
                const val = (opt.value || "").toLowerCase();
                return text.includes(filterLower) || val.includes(filterLower);
            });

            if (matchingOptions.length === 0) return;

            const groupEl = document.createElement("div");
            groupEl.className = "model-group";

            const headerEl = document.createElement("div");
            headerEl.className = "model-group-title";
            headerEl.textContent = group.label;
            groupEl.appendChild(headerEl);

            const itemsEl = document.createElement("div");
            itemsEl.className = "model-group-items";

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
    if (modelSelect && modelSelect.value !== modelValue) {
        modelSelect.value = modelValue;
        modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    updateModelPickerDisplay();
    closeModelPicker();
}

export function openModelPicker() {
    const dropdown = document.getElementById("modelPickerDropdown");
    const backdrop = document.getElementById("modelPickerBackdrop");
    const btn = document.getElementById("modelPickerBtn");
    const searchInput = document.getElementById("modelSearchInput");

    if (!dropdown) return;
    isPickerOpen = true;

    currentSearch = "";
    if (searchInput) searchInput.value = "";

    renderModelPickerList("");

    dropdown.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    if (btn) {
        btn.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
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

    isPickerOpen = false;
    if (dropdown) dropdown.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    if (btn) {
        btn.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
    }
}

export function toggleModelPicker() {
    if (isPickerOpen) {
        closeModelPicker();
    } else {
        openModelPicker();
    }
}

export function initModelPicker() {
    const btn = document.getElementById("modelPickerBtn");
    const backdrop = document.getElementById("modelPickerBackdrop");
    const searchInput = document.getElementById("modelSearchInput");
    const searchClear = document.getElementById("modelSearchClear");
    const modelSelect = document.getElementById("modelSelect");

    if (btn) {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleModelPicker();
        });
    }

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

    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (!isPickerOpen) return;
        const dropdown = document.getElementById("modelPickerDropdown");
        if (dropdown && !dropdown.contains(e.target) && !btn?.contains(e.target)) {
            closeModelPicker();
        }
    });

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
