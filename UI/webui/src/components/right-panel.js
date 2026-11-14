/* =========================================================
   RIGHT WORKSPACE PANEL (TABS, EDITOR, DIFFS, TERMINAL, SEARCH, TASKS)
   Minimalist Warm Monochrome Aesthetic (Rule 2 / Minimalist UI)
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { renderDiffCardHtml, renderCodeViewerCardHtml, bindDiffViewerCards, getLanguageMeta } from "./diff-viewer.js";
import { terminalDrawer } from "./terminal-drawer.js";
import { closePanel, getIsPanelOpen } from "./gestures.js";

class RightPanelManager {
    constructor() {
        this.isOpen = false;
        this.tabs = []; // Array of { id, type, title, path, url, badge }
        this.activeTabId = null; // null = Launcher / Empty view
        this.pollTimer = null;
        this.isResizing = false;
        this.width = 500;
        this.searchDebounceTimer = null;
        this.showAllTasks = false;
        this.lastActiveTasks = [];
        this.lastCompletedTasks = [];
        this.isSidebarOpen = localStorage.getItem("multiai_right_panel_sidebar") !== "0";
        this.hideWhitespace = false;

        // Elements cache
        this.panelEl = null;
        this.backdropEl = null;
        this.resizerEl = null;
        this.toggleBtn = null;
        this.closeBtn = null;
        this.headerTermBtn = null;
        this.headerSidebarBtn = null;

        this.tabStripEl = null;
        this.launcherViewEl = null;
        this.tabContentEl = null;

        this.searchInputEl = null;
        this.searchClearBtn = null;
        this.searchResultsEl = null;
        this.moreBtn = null;

        this.itemReview = null;
        this.reviewBadgeEl = null;
        this.itemOpenFile = null;
        this.itemTerminal = null;
        this.itemBrowser = null;
        this.itemExtensions = null;

        this.tasksBadgeEl = null;
        this.tasksListEl = null;
        this.seeAllBtn = null;

        this.viewerMountEl = null;
        this.terminalMountEl = null;
        this.fusedTerminalContainer = null;
        this.browserMountEl = null;
        this.browserUrlInput = null;
        this.browserIframe = null;
        this.browserBackBtn = null;
        this.browserReloadBtn = null;
        this.browserOpenExternalBtn = null;
    }

    init() {
        this.panelEl = document.getElementById("rightPanel");
        if (!this.panelEl) return;

        this.backdropEl = document.getElementById("rightPanelBackdrop");
        this.resizerEl = document.getElementById("rightPanelResizer");
        this.toggleBtn = document.getElementById("headerRightPanelBtn");
        this.closeBtn = document.getElementById("rightPanelCloseBtn");
        this.headerTermBtn = document.getElementById("rightPanelHeaderTermBtn");
        this.headerSidebarBtn = document.getElementById("rightPanelToggleSidebarBtn");

        this.tabStripEl = document.getElementById("rightPanelTabStrip");
        this.launcherViewEl = document.getElementById("rightPanelLauncherView");
        this.tabContentEl = document.getElementById("rightPanelTabContent");

        this.searchInputEl = document.getElementById("launcherSearchInput");
        this.searchClearBtn = document.getElementById("launcherSearchClear");
        this.searchResultsEl = document.getElementById("launcherSearchResults");
        this.moreBtn = document.getElementById("launcherMoreBtn");

        this.itemReview = document.getElementById("launcherItemReview");
        this.reviewBadgeEl = document.getElementById("launcherReviewBadge");
        this.itemOpenFile = document.getElementById("launcherItemOpenFile");
        this.itemTerminal = document.getElementById("launcherItemTerminal");
        this.itemBrowser = document.getElementById("launcherItemBrowser");
        this.itemExtensions = document.getElementById("launcherItemExtensions");

        this.tasksBadgeEl = document.getElementById("launcherTasksCountBadge");
        this.tasksListEl = document.getElementById("launcherTasksList");
        this.seeAllBtn = document.getElementById("launcherTasksSeeAllBtn");

        this.viewerMountEl = document.getElementById("rightPanelViewerMount");
        this.terminalMountEl = document.getElementById("rightPanelTerminalMount");
        this.fusedTerminalContainer = document.getElementById("fusedTerminalContainer");
        this.browserMountEl = document.getElementById("rightPanelBrowserMount");
        this.browserUrlInput = document.getElementById("browserUrlInput");
        this.browserIframe = document.getElementById("rightPanelBrowserFrame");
        this.browserBackBtn = document.getElementById("browserBackBtn");
        this.browserReloadBtn = document.getElementById("browserReloadBtn");
        this.browserOpenExternalBtn = document.getElementById("browserOpenExternalBtn");

        // Load persisted width
        const savedW = parseInt(localStorage.getItem("multiai_right_panel_width") || "500", 10);
        if (!isNaN(savedW) && savedW >= 320 && savedW <= 1200) {
            this.width = savedW;
            document.documentElement.style.setProperty("--right-panel-width", `${this.width}px`);
        }

        renderIcons(this.panelEl);
        this.bindEvents();
    }

    bindEvents() {
        // Toggle & Close buttons
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener("click", () => this.toggle());
        }
        if (this.closeBtn) {
            this.closeBtn.addEventListener("click", () => this.close());
        }
        if (this.backdropEl) {
            this.backdropEl.addEventListener("click", () => this.close());
        }

        // Header quick terminal button
        if (this.headerTermBtn) {
            this.headerTermBtn.addEventListener("click", () => {
                this.openTerminalTab();
            });
        }

        // Header toggle sidebar button
        if (this.headerSidebarBtn) {
            this.headerSidebarBtn.addEventListener("click", () => {
                this.toggleSidebar();
            });
        }

        // Global hotkey: Ctrl+. or Cmd+. and Escape to close
        document.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === ".") {
                e.preventDefault();
                this.toggle();
            } else if (e.key === "Escape") {
                if (this.searchResultsEl && this.searchResultsEl.style.display !== "none") {
                    this.hideSearchResults();
                } else if (this.isOpen) {
                    this.close();
                }
            }
        });

        // Window resize
        window.addEventListener("resize", () => {
            if (this.isOpen && this.activeTabId && terminalDrawer) {
                const activeTab = this.tabs.find(t => t.id === this.activeTabId);
                if (activeTab?.type === "terminal") {
                    terminalDrawer.fitActiveTerminal();
                }
            }
        });

        // Search Input & Autocomplete
        if (this.searchInputEl) {
            this.searchInputEl.addEventListener("input", () => {
                const q = this.searchInputEl.value.trim();
                if (this.searchClearBtn) {
                    this.searchClearBtn.style.display = q ? "inline-flex" : "none";
                }
                this.handleSearchInput(q);
            });

            this.searchInputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.handleSearchSubmit();
                }
            });
        }

        if (this.searchClearBtn) {
            this.searchClearBtn.addEventListener("click", () => {
                if (this.searchInputEl) this.searchInputEl.value = "";
                this.searchClearBtn.style.display = "none";
                this.hideSearchResults();
                this.searchInputEl?.focus();
            });
        }

        // Click outside search results to hide
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".launcher-search-row")) {
                this.hideSearchResults();
            }
        });

        // More Options button
        if (this.moreBtn) {
            this.moreBtn.addEventListener("click", async () => {
                if (window.confirm("Clean finished tasks from workspace?")) {
                    try {
                        await fetch("/api/task/clean", { method: "POST" });
                        this.loadTasks();
                    } catch (_) {}
                }
            });
        }

        // Primary Navigation Menu List Handlers
        if (this.itemReview) {
            this.itemReview.addEventListener("click", () => this.openReviewTab());
        }
        if (this.itemOpenFile) {
            this.itemOpenFile.addEventListener("click", () => {
                if (this.searchInputEl) {
                    this.searchInputEl.value = "";
                    this.searchInputEl.focus();
                    this.loadDirectoryContents(".");
                }
            });
        }
        if (this.itemTerminal) {
            this.itemTerminal.addEventListener("click", () => this.openTerminalTab());
        }
        if (this.itemBrowser) {
            this.itemBrowser.addEventListener("click", () => this.openBrowserTab("http://localhost:4440"));
        }
        if (this.itemExtensions) {
            this.itemExtensions.addEventListener("click", () => this.openExtensionsTab());
        }

        // See all tasks button
        if (this.seeAllBtn) {
            this.seeAllBtn.addEventListener("click", () => {
                this.showAllTasks = !this.showAllTasks;
                this.seeAllBtn.textContent = this.showAllTasks ? "Show less" : "See all";
                this.renderTasksList(this.lastActiveTasks, this.lastCompletedTasks);
            });
        }

        // Browser omnibox controls
        if (this.browserBackBtn && this.browserIframe) {
            this.browserBackBtn.addEventListener("click", () => {
                try { this.browserIframe.contentWindow?.history.back(); } catch (_) {}
            });
        }
        if (this.browserReloadBtn && this.browserIframe) {
            this.browserReloadBtn.addEventListener("click", () => {
                try { this.browserIframe.contentWindow?.location.reload(); } catch (_) {
                    this.browserIframe.src = this.browserUrlInput?.value || this.browserIframe.src;
                }
            });
        }
        if (this.browserUrlInput && this.browserIframe) {
            this.browserUrlInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    let u = this.browserUrlInput.value.trim();
                    if (!u.startsWith("http://") && !u.startsWith("https://")) {
                        u = "http://" + u;
                    }
                    this.browserUrlInput.value = u;
                    this.browserIframe.src = u;
                }
            });
        }
        if (this.browserOpenExternalBtn) {
            this.browserOpenExternalBtn.addEventListener("click", () => {
                const u = this.browserUrlInput?.value || this.browserIframe?.src;
                if (u) window.open(u, "_blank");
            });
        }

        // Resizer drag handler
        if (this.resizerEl) {
            this.resizerEl.addEventListener("mousedown", (e) => this.startResizing(e));
            this.resizerEl.addEventListener("touchstart", (e) => this.startResizingTouch(e), { passive: false });
        }
    }

    startResizing(e) {
        e.preventDefault();
        this.isResizing = true;
        this.resizerEl.classList.add("is-dragging");
        document.body.classList.add("right-panel-resizing");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMouseMove = (moveEvt) => {
            if (!this.isResizing) return;
            const maxW = Math.max(320, window.innerWidth - 380);
            const newW = Math.max(320, Math.min(maxW, window.innerWidth - moveEvt.clientX));
            this.width = newW;
            document.documentElement.style.setProperty("--right-panel-width", `${newW}px`);
            const activeTab = this.tabs.find(t => t.id === this.activeTabId);
            if (activeTab?.type === "terminal" && terminalDrawer) {
                terminalDrawer.fitActiveTerminal();
            }
        };

        const onMouseUp = () => {
            this.isResizing = false;
            this.resizerEl.classList.remove("is-dragging");
            document.body.classList.remove("right-panel-resizing");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            localStorage.setItem("multiai_right_panel_width", String(this.width));
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    startResizingTouch(e) {
        if (!e.touches || e.touches.length === 0) return;
        this.isResizing = true;
        this.resizerEl.classList.add("is-dragging");
        document.body.classList.add("right-panel-resizing");

        const onTouchMove = (moveEvt) => {
            if (!this.isResizing || !moveEvt.touches || moveEvt.touches.length === 0) return;
            const touch = moveEvt.touches[0];
            const maxW = Math.max(300, window.innerWidth - 320);
            const newW = Math.max(300, Math.min(maxW, window.innerWidth - touch.clientX));
            this.width = newW;
            document.documentElement.style.setProperty("--right-panel-width", `${newW}px`);
        };

        const onTouchEnd = () => {
            this.isResizing = false;
            this.resizerEl.classList.remove("is-dragging");
            document.body.classList.remove("right-panel-resizing");
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            localStorage.setItem("multiai_right_panel_width", String(this.width));
        };

        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (typeof closePanel === "function" && typeof getIsPanelOpen === "function" && getIsPanelOpen()) {
            closePanel(false);
        }

        this.isOpen = true;
        if (this.panelEl) {
            this.panelEl.classList.add("animate-transition");
        }
        document.body.classList.add("right-panel-open");
        if (this.backdropEl) {
            this.backdropEl.setAttribute("aria-hidden", "false");
        }
        if (this.toggleBtn) {
            this.toggleBtn.classList.add("active");
        }

        this.renderTabStrip();
        this.renderActiveTab();
        this.loadTasks();
        this.checkWorkspaceChanges();
        this.startPolling();
    }

    close() {
        this.isOpen = false;
        if (this.panelEl) {
            this.panelEl.classList.add("animate-transition");
        }
        document.body.classList.remove("right-panel-open");
        if (this.backdropEl) {
            this.backdropEl.setAttribute("aria-hidden", "true");
        }
        if (this.toggleBtn) {
            this.toggleBtn.classList.remove("active");
        }
        this.stopPolling();
    }

    startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(() => {
            if (!this.isOpen) return;
            this.loadTasks(true);
            this.checkWorkspaceChanges();
        }, 3000);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async checkWorkspaceChanges() {
        try {
            const res = await fetch("/api/history/changes");
            if (res.ok) {
                const data = await res.json();
                const count = Array.isArray(data.files) ? data.files.length : 0;
                if (this.reviewBadgeEl) {
                    if (count > 0) {
                        this.reviewBadgeEl.textContent = `${count} files`;
                        this.reviewBadgeEl.style.display = "inline-block";
                    } else {
                        this.reviewBadgeEl.style.display = "none";
                    }
                }
            }
        } catch (_) {}
    }

    // ── Multi-Tab Manager ─────────────────────────────────────
    renderTabStrip() {
        if (!this.tabStripEl) return;

        let tabsHtml = "";
        this.tabs.forEach((tab) => {
            const isActive = tab.id === this.activeTabId;
            let iconOrBadgeHtml = '<i data-lucide="file-code-2"></i>';

            if (tab.type === "diff") {
                const ext = (tab.path || "").split(".").pop()?.toLowerCase() || "";
                if (ext && ext.length <= 4) {
                    iconOrBadgeHtml = `<span class="tab-ext-badge ${ext}">${escapeHTML(ext)}</span>`;
                } else {
                    iconOrBadgeHtml = '<i data-lucide="file-diff" style="color: #38bdf8;"></i>';
                }
            } else if (tab.type === "terminal") {
                iconOrBadgeHtml = '<i data-lucide="square-terminal"></i>';
            } else if (tab.type === "browser") {
                iconOrBadgeHtml = '<i data-lucide="globe" style="color: #86efac;"></i>';
            } else if (tab.type === "extensions") {
                iconOrBadgeHtml = '<i data-lucide="puzzle" style="color: #fca5a5;"></i>';
            } else if (tab.path) {
                const ext = tab.path.split(".").pop()?.toLowerCase() || "";
                if (ext && ext.length <= 4) {
                    iconOrBadgeHtml = `<span class="tab-ext-badge ${ext}">${escapeHTML(ext)}</span>`;
                } else {
                    const meta = getLanguageMeta(tab.path);
                    iconOrBadgeHtml = `<i data-lucide="${meta.icon || "file-code"}" style="color: ${meta.color || "inherit"};"></i>`;
                }
            }

            tabsHtml += `
                <div class="tab-strip-item ${isActive ? "active" : ""}" data-tab-id="${escapeHTML(tab.id)}" title="${escapeHTML(tab.path || tab.url || tab.title)}">
                    ${iconOrBadgeHtml}
                    <span class="tab-strip-title">${escapeHTML(tab.title)}</span>
                    ${tab.badge ? `<span class="tab-strip-badge">${escapeHTML(tab.badge)}</span>` : ""}
                    <button type="button" class="tab-strip-close" data-close-id="${escapeHTML(tab.id)}" title="Close Tab">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            `;
        });

        // Add the "+" (New Tab / Launcher) button at the end
        tabsHtml += `
            <button type="button" class="tab-strip-new-btn" id="rightPanelNewTabBtn" title="New Tab / Launcher">
                <i data-lucide="plus"></i>
            </button>
        `;

        this.tabStripEl.innerHTML = tabsHtml;
        renderIcons(this.tabStripEl);

        // Bind clicks on tabs
        this.tabStripEl.querySelectorAll(".tab-strip-item").forEach((el) => {
            el.addEventListener("click", (e) => {
                if (e.target.closest(".tab-strip-close")) return;
                const tabId = el.getAttribute("data-tab-id");
                if (tabId) this.switchTab(tabId);
            });
        });

        // Bind clicks on tab close
        this.tabStripEl.querySelectorAll(".tab-strip-close").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const tabId = btn.getAttribute("data-close-id");
                if (tabId) this.closeTab(tabId);
            });
        });

        // Bind New Tab "+" button
        const newTabBtn = document.getElementById("rightPanelNewTabBtn");
        if (newTabBtn) {
            newTabBtn.addEventListener("click", () => {
                this.switchToLauncher();
            });
        }
    }

    switchTab(tabId) {
        this.activeTabId = tabId;
        this.renderTabStrip();
        this.renderActiveTab();
    }

    closeTab(tabId) {
        const idx = this.tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;

        this.tabs.splice(idx, 1);

        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                const nextIdx = Math.min(idx, this.tabs.length - 1);
                this.activeTabId = this.tabs[nextIdx].id;
            } else {
                this.activeTabId = null; // Switch to empty launcher view
            }
        }

        this.renderTabStrip();
        this.renderActiveTab();
    }

    switchToLauncher() {
        this.activeTabId = null;
        this.renderTabStrip();
        this.renderActiveTab();
        if (this.searchInputEl) {
            this.searchInputEl.value = "";
            this.searchInputEl.focus();
        }
        this.loadTasks();
    }

    renderActiveTab() {
        if (!this.launcherViewEl || !this.tabContentEl) return;

        if (this.activeTabId === null) {
            // Show Launcher / Empty view
            this.launcherViewEl.style.display = "flex";
            this.tabContentEl.style.display = "none";
            this.loadTasks();
            return;
        }

        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
        if (!activeTab) {
            this.switchToLauncher();
            return;
        }

        // Hide launcher, show tab container
        this.launcherViewEl.style.display = "none";
        this.tabContentEl.style.display = "flex";

        // Deactivate all mount subviews first
        if (this.viewerMountEl) this.viewerMountEl.style.display = "none";
        if (this.terminalMountEl) this.terminalMountEl.style.display = "none";
        if (this.browserMountEl) this.browserMountEl.style.display = "none";

        if (activeTab.type === "diff") {
            if (this.viewerMountEl) {
                this.viewerMountEl.style.display = "flex";
                this.renderDiffTab(activeTab);
            }
        } else if (activeTab.type === "file") {
            if (this.viewerMountEl) {
                this.viewerMountEl.style.display = "flex";
                this.renderFileTab(activeTab);
            }
        } else if (activeTab.type === "terminal") {
            if (this.terminalMountEl) {
                this.terminalMountEl.style.display = "flex";
                this.fuseTerminal();
            }
        } else if (activeTab.type === "browser") {
            if (this.browserMountEl) {
                this.browserMountEl.style.display = "flex";
                this.renderBrowserTab(activeTab);
            }
        } else if (activeTab.type === "extensions") {
            if (this.viewerMountEl) {
                this.viewerMountEl.style.display = "flex";
                this.renderExtensionsTab();
            }
        }
    }

    // ── Primary Actions ───────────────────────────────────────
    async openReviewTab() {
        try {
            const res = await fetch("/api/history/changes");
            if (res.ok) {
                const data = await res.json();
                const files = Array.isArray(data.files) ? data.files : [];
                if (files.length > 0) {
                    const firstPath = files[0].displayPath || files[0].path;
                    this.openDiffTab(firstPath);
                    return;
                }
            }
        } catch (_) {}

        // Fallback Review tab
        const tabId = "tab_review";
        let tab = this.tabs.find(t => t.id === tabId);
        if (!tab) {
            this.tabs.push({
                id: tabId,
                type: "diff",
                title: "Review",
                path: ""
            });
        }
        this.switchTab(tabId);
    }

    openDiffTab(filePath) {
        const tabId = `diff_${filePath}`;
        let tab = this.tabs.find(t => t.id === tabId);
        if (!tab) {
            this.tabs.push({
                id: tabId,
                type: "diff",
                title: filePath.split("/").pop() || "Review",
                path: filePath
            });
        }
        this.switchTab(tabId);
    }

    toggleSidebar() {
        this.isSidebarOpen = !this.isSidebarOpen;
        localStorage.setItem("multiai_right_panel_sidebar", this.isSidebarOpen ? "1" : "0");
        const containers = this.panelEl?.querySelectorAll(".viewer-split-container") || [];
        containers.forEach((c) => {
            c.classList.toggle("sidebar-collapsed", !this.isSidebarOpen);
        });
        if (this.headerSidebarBtn) {
            this.headerSidebarBtn.classList.toggle("active", this.isSidebarOpen);
        }
    }

    buildBreadcrumbBarHtml(filePath, modeLabel = "") {
        const cleanPath = (filePath || "file").replace(/\\/g, "/").replace(/^\.\//, "");
        const segments = cleanPath.split("/").filter(Boolean);
        const fileName = segments.pop() || cleanPath;
        const ext = fileName.split(".").pop()?.toLowerCase() || "";

        let segHtml = "";
        segments.forEach((seg) => {
            segHtml += `<span class="crumb-segment">${escapeHTML(seg)}</span><span class="crumb-separator">&gt;</span>`;
        });

        return `
            <div class="right-panel-breadcrumb-bar">
                <div class="breadcrumb-path" title="${escapeHTML(cleanPath)}">
                    ${segHtml}
                    <span class="crumb-file">
                        ${ext ? `<span class="crumb-ext-badge ${ext}">${escapeHTML(ext)}</span>` : ""}
                        <span>${escapeHTML(fileName)}</span>
                        ${modeLabel ? `<span class="crumb-suffix">(${escapeHTML(modeLabel)})</span>` : ""}
                    </span>
                </div>
                <div class="breadcrumb-actions">
                    <button type="button" class="breadcrumb-btn" id="breadcrumbMoreBtn" title="More options">
                        <i data-lucide="more-vertical"></i>
                    </button>
                    <button type="button" class="breadcrumb-btn" id="breadcrumbSidebarBtn" title="Toggle sidebar">
                        <i data-lucide="panel-right"></i>
                    </button>
                </div>
                <div class="breadcrumb-dropdown-menu" id="breadcrumbDropdownMenu" style="display: none;">
                    <div class="breadcrumb-menu-item" data-action="expand-diffs">
                        <i data-lucide="chevrons-up-down"></i>
                        <span>Expand Diffs</span>
                    </div>
                    <div class="breadcrumb-menu-item ${this.hideWhitespace ? "active" : ""}" data-action="toggle-whitespace">
                        <i data-lucide="check" class="check-icon"></i>
                        <span>Hide Whitespace Changes</span>
                    </div>
                    <div class="breadcrumb-menu-divider"></div>
                    <div class="breadcrumb-menu-item" data-action="copy-content">
                        <i data-lucide="copy"></i>
                        <span>Copy Content</span>
                    </div>
                    <div class="breadcrumb-menu-item" data-action="download-file">
                        <i data-lucide="download"></i>
                        <span>Download File</span>
                    </div>
                    <div class="breadcrumb-menu-item" data-action="copy-path">
                        <i data-lucide="link"></i>
                        <span>Copy Path</span>
                    </div>
                    <div class="breadcrumb-menu-divider"></div>
                    <div class="breadcrumb-menu-item" data-action="search">
                        <i data-lucide="search"></i>
                        <span>Search</span>
                    </div>
                    <div class="breadcrumb-menu-item" data-action="file-manager">
                        <i data-lucide="folder"></i>
                        <span>Show in File Manager</span>
                    </div>
                </div>
            </div>
        `;
    }

    bindBreadcrumbEvents(container, filePath, rawContent) {
        if (!container) return;
        const moreBtn = container.querySelector("#breadcrumbMoreBtn");
        const sidebarBtn = container.querySelector("#breadcrumbSidebarBtn");
        const menu = container.querySelector("#breadcrumbDropdownMenu");

        if (sidebarBtn) {
            sidebarBtn.addEventListener("click", () => this.toggleSidebar());
        }

        if (moreBtn && menu) {
            moreBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                menu.style.display = menu.style.display === "none" ? "flex" : "none";
            });

            document.addEventListener("click", (e) => {
                if (!e.target.closest("#breadcrumbDropdownMenu") && !e.target.closest("#breadcrumbMoreBtn")) {
                    menu.style.display = "none";
                }
            });

            menu.querySelectorAll(".breadcrumb-menu-item").forEach((item) => {
                item.addEventListener("click", async () => {
                    const action = item.getAttribute("data-action");
                    menu.style.display = "none";

                    if (action === "expand-diffs") {
                        const chunks = container.querySelectorAll(".mv-chunk-banner");
                        chunks.forEach(c => c.click());
                    } else if (action === "toggle-whitespace") {
                        this.hideWhitespace = !this.hideWhitespace;
                        const activeTab = this.tabs.find(t => t.id === this.activeTabId);
                        if (activeTab?.type === "diff") {
                            this.renderDiffTab(activeTab);
                        }
                    } else if (action === "copy-content") {
                        if (rawContent) {
                            try {
                                await navigator.clipboard.writeText(rawContent);
                            } catch (_) {}
                        }
                    } else if (action === "download-file") {
                        if (rawContent) {
                            const baseName = filePath.split("/").pop() || "file.txt";
                            const blob = new Blob([rawContent], { type: "text/plain;charset=utf-8" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = baseName;
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                    } else if (action === "copy-path") {
                        if (filePath) {
                            try {
                                await navigator.clipboard.writeText(filePath);
                            } catch (_) {}
                        }
                    } else if (action === "search") {
                        this.switchToLauncher();
                    } else if (action === "file-manager") {
                        const folderPath = filePath.split("/").slice(0, -1).join("/") || ".";
                        this.switchToLauncher();
                        if (this.searchInputEl) {
                            this.searchInputEl.value = `${folderPath}/`;
                            this.searchInputEl.focus();
                        }
                        this.loadDirectoryContents(folderPath);
                    }
                });
            });
        }
    }

    async loadViewerSidebar(folderPath, currentFilePath, isDiffMode = false) {
        const listEl = document.getElementById("viewerSidebarList");
        if (!listEl) return;

        try {
            if (isDiffMode) {
                const changesRes = await fetch("/api/history/changes");
                if (changesRes.ok) {
                    const changesData = await changesRes.json();
                    const changedFiles = Array.isArray(changesData.files) ? changesData.files : [];
                    if (changedFiles.length > 0) {
                        let html = "";
                        changedFiles.forEach((f) => {
                            const p = f.displayPath || f.path;
                            const fName = p.split("/").pop() || p;
                            const ext = fName.split(".").pop()?.toLowerCase() || "";
                            const isCur = currentFilePath && (currentFilePath === p || currentFilePath.endsWith(fName));
                            html += `
                                <div class="viewer-sidebar-item ${isCur ? "active" : ""}" data-path="${escapeHTML(p)}" data-is-diff="true" title="${escapeHTML(p)} (+${f.additions || 0} -${f.deletions || 0})">
                                    <span class="file-ext-badge ${ext}">${escapeHTML(ext || "diff")}</span>
                                    <span class="viewer-sidebar-filename">${escapeHTML(fName)}</span>
                                </div>
                            `;
                        });
                        listEl.innerHTML = html;
                        this.bindViewerSidebarClicks(listEl);
                        return;
                    }
                }
            }

            const res = await fetch("/api/file/list-dir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: folderPath || "." })
            });

            if (!res.ok) {
                listEl.innerHTML = '<div class="tasks-empty-state">No files.</div>';
                return;
            }

            const data = await res.json();
            const entries = Array.isArray(data.entries) ? data.entries : [];
            if (entries.length === 0) {
                listEl.innerHTML = '<div class="tasks-empty-state">Empty directory.</div>';
                return;
            }

            let html = "";
            entries.forEach((e) => {
                const ext = e.name.split(".").pop()?.toLowerCase() || "";
                const fullRel = folderPath && folderPath !== "." ? `${folderPath}/${e.name}` : e.name;
                const isCur = currentFilePath && (currentFilePath === fullRel || currentFilePath.endsWith(e.name));
                html += `
                    <div class="viewer-sidebar-item ${isCur ? "active" : ""}" data-path="${escapeHTML(fullRel)}" title="${escapeHTML(e.name)}">
                        <span class="file-ext-badge ${ext}">${escapeHTML(ext || "txt")}</span>
                        <span class="viewer-sidebar-filename">${escapeHTML(e.name)}</span>
                    </div>
                `;
            });

            listEl.innerHTML = html;
            this.bindViewerSidebarClicks(listEl);
        } catch (_) {
            listEl.innerHTML = '<div class="tasks-empty-state">Unable to load files.</div>';
        }
    }

    bindViewerSidebarClicks(listEl) {
        listEl.querySelectorAll(".viewer-sidebar-item").forEach((item) => {
            item.addEventListener("click", () => {
                const targetPath = item.getAttribute("data-path");
                const isDiff = item.getAttribute("data-is-diff") === "true";
                if (!targetPath) return;
                if (isDiff) {
                    this.openDiffTab(targetPath);
                } else {
                    this.openFileTab(targetPath);
                }
            });
        });
    }

    async renderDiffTab(tab) {
        if (!this.viewerMountEl) return;
        if (!tab.path) {
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Working tree clean. No unaccepted file modifications.</div>';
            return;
        }

        this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading unified diff…</div>';

        try {
            const res = await fetch(`/api/history/diff?path=${encodeURIComponent(tab.path)}`);
            if (!res.ok) {
                this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Unable to load unified diff.</div>';
                return;
            }

            const data = await res.json();
            const diffStr = data.diff || "";

            const folderPath = tab.path.split("/").slice(0, -1).join("/") || ".";
            const folderName = folderPath.split("/").pop() || "workspace";

            const breadcrumbHtml = this.buildBreadcrumbBarHtml(tab.path, "diff");

            let toolbarHtml = `
                <div class="diff-toolbar-actions">
                    <span class="diff-toolbar-title">${escapeHTML(tab.path)}</span>
                    <div class="diff-toolbar-btns">
                        <button type="button" class="diff-action-btn" id="diffTabAcceptBtn">Accept All</button>
                        <button type="button" class="diff-action-btn secondary" id="diffTabRevertBtn">Revert All</button>
                    </div>
                </div>
            `;

            const diffCardHtml = renderDiffCardHtml({
                diffStr,
                filePath: tab.path,
                maxHeight: 750,
                hideWhitespace: this.hideWhitespace
            });

            const splitContainerHtml = `
                ${breadcrumbHtml}
                <div class="viewer-split-container ${this.isSidebarOpen ? "" : "sidebar-collapsed"}">
                    <div class="viewer-editor-pane">
                        ${toolbarHtml}
                        ${diffCardHtml}
                    </div>
                    <div class="viewer-sidebar-pane">
                        <div class="viewer-sidebar-header">
                            <span class="viewer-sidebar-folder" title="${escapeHTML(folderPath)}">... / ${escapeHTML(folderName)} ...</span>
                        </div>
                        <div class="viewer-sidebar-list" id="viewerSidebarList">
                            <div class="tasks-empty-state">Loading files…</div>
                        </div>
                    </div>
                </div>
            `;

            this.viewerMountEl.innerHTML = splitContainerHtml;
            bindDiffViewerCards(this.viewerMountEl);
            renderIcons(this.viewerMountEl);
            this.bindBreadcrumbEvents(this.viewerMountEl, tab.path, diffStr);
            this.loadViewerSidebar(folderPath, tab.path, true);

            const acceptBtn = document.getElementById("diffTabAcceptBtn");
            const revertBtn = document.getElementById("diffTabRevertBtn");

            if (acceptBtn) {
                acceptBtn.addEventListener("click", async () => {
                    acceptBtn.disabled = true;
                    acceptBtn.textContent = "Accepting…";
                    try {
                        await fetch("/api/history/accept", { method: "POST" });
                        this.closeTab(tab.id);
                        this.checkWorkspaceChanges();
                    } catch (e) {
                        console.error(e);
                    }
                });
            }

            if (revertBtn) {
                revertBtn.addEventListener("click", async () => {
                    if (!window.confirm("Revert workspace modifications for this file?")) return;
                    revertBtn.disabled = true;
                    try {
                        await fetch("/api/history/revert", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ file: tab.path })
                        });
                        this.closeTab(tab.id);
                        this.checkWorkspaceChanges();
                    } catch (e) {
                        console.error(e);
                    }
                });
            }
        } catch (err) {
            console.error("[RightPanel] Render diff tab error:", err);
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Failed to render diff.</div>';
        }
    }

    openFileTab(filePath) {
        const tabId = `file_${filePath}`;
        const existing = this.tabs.find(t => t.id === tabId);
        if (existing) {
            this.switchTab(tabId);
            return;
        }

        this.tabs.push({
            id: tabId,
            type: "file",
            title: filePath.split("/").pop(),
            path: filePath
        });

        this.switchTab(tabId);
    }

    async renderFileTab(tab) {
        if (!this.viewerMountEl) return;
        this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading file…</div>';

        try {
            const res = await fetch("/api/file/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: tab.path, numbered: false })
            });

            if (!res.ok) {
                this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Unable to read file content.</div>';
                return;
            }

            const data = await res.json();
            const content = data.content || "";

            const folderPath = tab.path.split("/").slice(0, -1).join("/") || ".";
            const folderName = folderPath.split("/").pop() || "workspace";

            const breadcrumbHtml = this.buildBreadcrumbBarHtml(tab.path, "single edit");

            const codeCardHtml = renderCodeViewerCardHtml({
                code: content,
                filePath: tab.path,
                maxHeight: 750
            });

            const splitContainerHtml = `
                ${breadcrumbHtml}
                <div class="viewer-split-container ${this.isSidebarOpen ? "" : "sidebar-collapsed"}">
                    <div class="viewer-editor-pane">
                        ${codeCardHtml}
                    </div>
                    <div class="viewer-sidebar-pane">
                        <div class="viewer-sidebar-header">
                            <span class="viewer-sidebar-folder" title="${escapeHTML(folderPath)}">... / ${escapeHTML(folderName)} ...</span>
                        </div>
                        <div class="viewer-sidebar-list" id="viewerSidebarList">
                            <div class="tasks-empty-state">Loading files…</div>
                        </div>
                    </div>
                </div>
            `;

            this.viewerMountEl.innerHTML = splitContainerHtml;
            bindDiffViewerCards(this.viewerMountEl);
            renderIcons(this.viewerMountEl);
            this.bindBreadcrumbEvents(this.viewerMountEl, tab.path, content);
            this.loadViewerSidebar(folderPath, tab.path, false);
        } catch (err) {
            console.error("[RightPanel] Render file tab error:", err);
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Failed to read file.</div>';
        }
    }

    openTerminalTab() {
        if (!this.isOpen) {
            this.open();
        }

        const existing = this.tabs.find(t => t.type === "terminal");
        if (existing) {
            this.switchTab(existing.id);
            return;
        }

        const tabId = "tab_terminal";
        this.tabs.push({
            id: tabId,
            type: "terminal",
            title: "Terminal"
        });

        this.switchTab(tabId);
    }

    fuseTerminal() {
        if (!this.fusedTerminalContainer || !terminalDrawer) return;

        if (!terminalDrawer.drawerEl) {
            terminalDrawer.init();
        }

        if (terminalDrawer.drawerEl) {
            if (terminalDrawer.drawerEl.parentElement !== this.fusedTerminalContainer) {
                this.fusedTerminalContainer.appendChild(terminalDrawer.drawerEl);
            }
            terminalDrawer.drawerEl.classList.add("fused-mode");
            terminalDrawer.drawerEl.classList.add("open");
            terminalDrawer.drawerEl.style.display = "flex";
            terminalDrawer.drawerEl.style.opacity = "1";
            terminalDrawer.drawerEl.style.pointerEvents = "auto";
            terminalDrawer.drawerEl.style.width = "100%";
            terminalDrawer.drawerEl.style.height = "100%";
        }

        terminalDrawer.isOpen = true;

        if (terminalDrawer.sessions.length === 0) {
            terminalDrawer.createSession();
        } else {
            const active = terminalDrawer.getActiveSession();
            if (active && active.mount) {
                active.mount.style.display = "block";
            }
            if (active && (!active.ws || active.ws.readyState > 1)) {
                try {
                    terminalDrawer.connectSessionStream(active);
                } catch (_) {}
            }
        }

        const doFit = () => {
            terminalDrawer.fitActiveTerminal();
            const activeSession = terminalDrawer.sessions.find(s => s.id === terminalDrawer.activeSessionId);
            if (activeSession?.term) {
                activeSession.term.focus();
            }
        };

        requestAnimationFrame(doFit);
        setTimeout(doFit, 80);
        setTimeout(doFit, 260);
    }

    openBrowserTab(url) {
        let cleanUrl = url.trim();
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
            cleanUrl = "http://" + cleanUrl;
        }

        let hostname = cleanUrl;
        try {
            hostname = new URL(cleanUrl).host;
        } catch (_) {}

        const tabId = `browser_${Date.now()}`;
        this.tabs.push({
            id: tabId,
            type: "browser",
            title: hostname || "Browser",
            url: cleanUrl
        });

        this.switchTab(tabId);
    }

    renderBrowserTab(tab) {
        if (this.browserUrlInput) this.browserUrlInput.value = tab.url;
        if (this.browserIframe && this.browserIframe.src !== tab.url) {
            this.browserIframe.src = tab.url;
        }
        renderIcons(this.browserMountEl);
    }

    openExtensionsTab() {
        const tabId = "tab_extensions";
        let tab = this.tabs.find(t => t.id === tabId);
        if (!tab) {
            this.tabs.push({
                id: tabId,
                type: "extensions",
                title: "Extensions"
            });
        }
        this.switchTab(tabId);
    }

    async renderExtensionsTab() {
        if (!this.viewerMountEl) return;
        this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading extensions…</div>';

        try {
            const res = await fetch("/api/skills");
            const data = res.ok ? await res.json() : {};
            const skills = Array.isArray(data.skills) ? data.skills : [];

            let html = `
                <div class="extensions-view-container">
                    <div class="extensions-header-title">Extensions & Agent Skills (${skills.length})</div>
            `;
            if (skills.length === 0) {
                html += '<div class="tasks-empty-state">No skills registered.</div>';
            } else {
                skills.forEach(s => {
                    html += `
                        <div class="extension-card-item">
                            <div class="extension-card-header">
                                <span class="extension-card-name">${escapeHTML(s.name || s.id)}</span>
                                <span class="search-result-badge">active</span>
                            </div>
                            <div class="extension-card-desc">${escapeHTML(s.description || "Agent capability")}</div>
                        </div>
                    `;
                });
            }
            html += `</div>`;
            this.viewerMountEl.innerHTML = html;
        } catch (err) {
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Unable to load extensions.</div>';
        }
    }

    // ── Search & Autocomplete Pill ────────────────────────────
    handleSearchInput(query) {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (!query) {
            this.hideSearchResults();
            return;
        }

        this.searchDebounceTimer = setTimeout(() => {
            this.executeSearch(query);
        }, 160);
    }

    handleSearchSubmit() {
        if (!this.searchInputEl) return;
        const q = this.searchInputEl.value.trim();
        if (!q) return;

        if (this.isUrlString(q)) {
            this.openBrowserTab(q);
            this.hideSearchResults();
            return;
        }

        this.openFileTab(q);
        this.hideSearchResults();
    }

    isUrlString(str) {
        const s = str.toLowerCase();
        return s.startsWith("http://") ||
               s.startsWith("https://") ||
               s.startsWith("localhost:") ||
               s.startsWith("127.0.0.1:") ||
               /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(s);
    }

    async executeSearch(query) {
        if (!this.searchResultsEl) return;

        if (this.isUrlString(query)) {
            this.searchResultsEl.innerHTML = `
                <div class="search-result-item" data-action="url" data-val="${escapeHTML(query)}">
                    <div class="search-result-left">
                        <i data-lucide="globe" style="color: #86efac;"></i>
                        <span>Open URL: <strong>${escapeHTML(query)}</strong></span>
                    </div>
                    <span class="search-result-badge">web</span>
                </div>
            `;
            this.showSearchResults();
            this.bindSearchResultClicks();
            return;
        }

        try {
            const dirToQuery = query.includes("/") ? query.substring(0, query.lastIndexOf("/") || 1) : ".";
            const term = query.includes("/") ? query.substring(query.lastIndexOf("/") + 1).toLowerCase() : query.toLowerCase();

            const res = await fetch("/api/file/list-dir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: dirToQuery })
            });

            if (!res.ok) {
                this.hideSearchResults();
                return;
            }

            const data = await res.json();
            const entries = Array.isArray(data.entries) ? data.entries : [];
            const filtered = entries.filter(e => !term || e.name.toLowerCase().includes(term));

            if (filtered.length === 0) {
                this.searchResultsEl.innerHTML = '<div style="padding: 8px 12px; font-size: 12px; color: var(--text-tertiary);">No files or folders matched.</div>';
                this.showSearchResults();
                return;
            }

            let html = "";
            filtered.slice(0, 15).forEach((entry) => {
                const isDir = entry.isDir;
                const fullPath = dirToQuery === "." ? entry.name : `${dirToQuery}/${entry.name}`;
                const meta = isDir ? { icon: "folder", color: "#60a5fa" } : getLanguageMeta(entry.name);

                html += `
                    <div class="search-result-item" data-action="${isDir ? "dir" : "file"}" data-val="${escapeHTML(fullPath)}">
                        <div class="search-result-left">
                            <i data-lucide="${meta.icon}" style="color: ${meta.color};"></i>
                            <span>${escapeHTML(entry.name)}${isDir ? "/" : ""}</span>
                        </div>
                        <span class="search-result-badge">${isDir ? "folder" : "file"}</span>
                    </div>
                `;
            });

            this.searchResultsEl.innerHTML = html;
            this.showSearchResults();
            this.bindSearchResultClicks();
        } catch (err) {
            console.error("[RightPanel] Search error:", err);
            this.hideSearchResults();
        }
    }

    async loadDirectoryContents(dirPath = ".") {
        if (!this.searchResultsEl) return;
        try {
            const res = await fetch("/api/file/list-dir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: dirPath })
            });
            if (!res.ok) return;
            const data = await res.json();
            const entries = Array.isArray(data.entries) ? data.entries : [];

            let html = "";
            entries.slice(0, 20).forEach((entry) => {
                const isDir = entry.isDir;
                const fullPath = dirPath === "." ? entry.name : `${dirPath}/${entry.name}`;
                const meta = isDir ? { icon: "folder", color: "#60a5fa" } : getLanguageMeta(entry.name);

                html += `
                    <div class="search-result-item" data-action="${isDir ? "dir" : "file"}" data-val="${escapeHTML(fullPath)}">
                        <div class="search-result-left">
                            <i data-lucide="${meta.icon}" style="color: ${meta.color};"></i>
                            <span>${escapeHTML(entry.name)}${isDir ? "/" : ""}</span>
                        </div>
                        <span class="search-result-badge">${isDir ? "folder" : "file"}</span>
                    </div>
                `;
            });

            this.searchResultsEl.innerHTML = html;
            this.showSearchResults();
            this.bindSearchResultClicks();
        } catch (err) {
            console.error("[RightPanel] Load dir error:", err);
        }
    }

    bindSearchResultClicks() {
        if (!this.searchResultsEl) return;
        renderIcons(this.searchResultsEl);

        this.searchResultsEl.querySelectorAll(".search-result-item").forEach((item) => {
            item.addEventListener("click", () => {
                const action = item.getAttribute("data-action");
                const val = item.getAttribute("data-val");

                if (action === "url") {
                    this.openBrowserTab(val);
                    this.hideSearchResults();
                } else if (action === "file") {
                    this.openFileTab(val);
                    this.hideSearchResults();
                } else if (action === "dir") {
                    if (this.searchInputEl) {
                        this.searchInputEl.value = `${val}/`;
                        this.searchInputEl.focus();
                    }
                    this.loadDirectoryContents(val);
                }
            });
        });
    }

    showSearchResults() {
        if (this.searchResultsEl) this.searchResultsEl.style.display = "flex";
    }

    hideSearchResults() {
        if (this.searchResultsEl) this.searchResultsEl.style.display = "none";
    }

    // ── Background Tasks List (Matches Reference Image) ───────
    async loadTasks(isBackground = false) {
        try {
            const res = await fetch("/api/task/list");
            if (!res.ok) return;
            const data = await res.json();

            const activeTasks = [];
            const completedTasks = [];

            for (const [id, t] of Object.entries(data)) {
                if (!t || typeof t !== "object") continue;
                const item = {
                    id,
                    running: Boolean(t.running),
                    exitCode: t.exit_code,
                    command: t.command || "Shell task",
                    startTime: t.start_time
                };
                if (item.running) {
                    activeTasks.push(item);
                } else {
                    completedTasks.push(item);
                }
            }

            this.lastActiveTasks = activeTasks;
            this.lastCompletedTasks = completedTasks;

            const total = activeTasks.length + completedTasks.length;
            if (this.tasksBadgeEl) {
                if (total > 0) {
                    this.tasksBadgeEl.textContent = String(total);
                    this.tasksBadgeEl.style.display = "inline-block";
                } else {
                    this.tasksBadgeEl.style.display = "none";
                }
            }

            this.renderTasksList(activeTasks, completedTasks);
        } catch (err) {
            if (!isBackground) console.error("[RightPanel] Load tasks error:", err);
        }
    }

    renderTasksList(activeTasks, completedTasks) {
        if (!this.tasksListEl) return;

        const allTasks = [...activeTasks, ...completedTasks];
        if (allTasks.length === 0) {
            this.tasksListEl.innerHTML = '<div class="launcher-tasks-empty">No active background tasks.</div>';
            if (this.seeAllBtn) this.seeAllBtn.style.display = "none";
            return;
        }

        const displayLimit = this.showAllTasks ? allTasks.length : 4;
        const visibleTasks = allTasks.slice(0, displayLimit);

        let html = "";
        visibleTasks.forEach((task) => {
            const nowSec = Math.round(Date.now() / 1000);
            const elapsed = task.startTime ? Math.max(0, nowSec - task.startTime) : 0;
            const durStr = task.running ? `${elapsed}s` : (task.exitCode === 0 ? "done" : `exit ${task.exitCode}`);

            html += `
                <div class="launcher-task-row" data-task-id="${escapeHTML(task.id)}">
                    <div class="launcher-task-left">
                        <i data-lucide="timer"></i>
                        <span class="launcher-task-name">${escapeHTML(task.command)}</span>
                    </div>
                    <span class="launcher-task-dur">${escapeHTML(durStr)}</span>
                </div>
            `;
        });

        this.tasksListEl.innerHTML = html;
        renderIcons(this.tasksListEl);

        // Show/hide "See all" button
        if (this.seeAllBtn) {
            this.seeAllBtn.style.display = allTasks.length > 4 ? "block" : "none";
        }

        // Clicking a task attaches to terminal or opens log output
        this.tasksListEl.querySelectorAll(".launcher-task-row").forEach((row) => {
            row.addEventListener("click", () => {
                const tid = row.getAttribute("data-task-id");
                const task = allTasks.find(t => t.id === tid);
                if (task) {
                    if (task.running) {
                        this.openTerminalTab();
                    } else {
                        this.openTaskLogTab(task);
                    }
                }
            });
        });
    }

    async openTaskLogTab(task) {
        const tabId = `task_${task.id}`;
        let tab = this.tabs.find(t => t.id === tabId);
        if (!tab) {
            this.tabs.push({
                id: tabId,
                type: "file",
                title: `task-${task.id}.log`,
                path: `task-${task.id}.log`
            });
        }
        this.switchTab(tabId);

        if (this.viewerMountEl) {
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading task output…</div>';
            try {
                const res = await fetch(`/api/task/stdout/${encodeURIComponent(task.id)}`);
                const resData = res.ok ? await res.json() : {};
                const outputText = resData.stdout || resData.output || "(No output recorded for this task)";

                this.viewerMountEl.innerHTML = renderCodeViewerCardHtml({
                    code: outputText,
                    filePath: `task-${task.id}.log`,
                    maxHeight: 750
                });
                bindDiffViewerCards(this.viewerMountEl);
                renderIcons(this.viewerMountEl);
            } catch (_) {
                this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Unable to load task output.</div>';
            }
        }
    }
}

export const rightPanel = new RightPanelManager();

export function initRightPanel() {
    rightPanel.init();
}

export function toggleRightPanel() {
    rightPanel.toggle();
}

export function openRightPanel() {
    rightPanel.open();
}

export function closeRightPanel() {
    rightPanel.close();
}

if (typeof window !== "undefined") {
    window.rightPanel = rightPanel;
    window.closeRightPanel = closeRightPanel;
    window.openRightPanel = openRightPanel;
    window.toggleRightPanel = toggleRightPanel;
}
