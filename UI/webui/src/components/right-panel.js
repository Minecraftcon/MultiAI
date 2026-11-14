/* =========================================================
   RIGHT WORKSPACE PANEL (TABS, EDITOR, DIFFS, TERMINAL, SEARCH, TASKS)
   Minimalist Warm Monochrome Aesthetic (Rule 2 / Minimalist UI)
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { renderDiffCardHtml, renderCodeViewerCardHtml, bindDiffViewerCards, getLanguageMeta } from "./diff-viewer.js";
import { terminalDrawer } from "./terminal-drawer.js";
import { closePanel, getIsPanelOpen } from "./gestures.js";

function getFileBadgeInfo(fileName = "") {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
        case "js": case "mjs": case "cjs":
            return { text: "js", color: "#f59e0b" };
        case "ts":
            return { text: "ts", color: "#3b82f6" };
        case "jsx": case "tsx":
            return { text: "jsx", color: "#00d8ff" };
        case "html": case "htm":
            return { text: "</>", color: "#f97316" };
        case "css": case "scss": case "less":
            return { text: "css", color: "#38bdf8" };
        case "json":
            return { text: "{}", color: "#eab308" };
        case "py":
            return { text: "py", color: "#10b981" };
        case "md": case "markdown":
            return { text: "M+", color: "#06b6d4" };
        case "h": case "hpp":
            return { text: "h", color: "#38bdf8" };
        case "c": case "cpp": case "cc":
            return { text: "c++", color: "#38bdf8" };
        case "go":
            return { text: "go", color: "#00add8" };
        case "rs":
            return { text: "rs", color: "#ef4444" };
        case "sh": case "bash":
            return { text: ">_", color: "#84cc16" };
        default:
            return { text: ext ? ext.slice(0, 3) : "txt", color: "#9ca3af" };
    }
}

class RightPanelManager {
    constructor() {
        this.isOpen = false;
        this.tabs = []; // Array of { id, type, title, path, url, badge }
        this.activeTabId = null; // null = Launcher / Empty view
        this.pollTimer = null;
        this.isResizing = false;
        this.justFinishedResizing = false;
        this.width = 500;
        const savedSplit = parseFloat(localStorage.getItem("multiai_search_split_percent") || "52");
        this.searchSplitPercent = (!isNaN(savedSplit) && savedSplit >= 15 && savedSplit <= 85) ? savedSplit : 52;
        const savedViewerSidebarW = parseInt(localStorage.getItem("multiai_viewer_sidebar_width") || "240", 10);
        this.viewerSidebarWidth = (!isNaN(savedViewerSidebarW) && savedViewerSidebarW >= 140 && savedViewerSidebarW <= 500) ? savedViewerSidebarW : 240;
        document.documentElement.style.setProperty("--viewer-sidebar-width", `${this.viewerSidebarWidth}px`);
        this.viewerSidebarScrollTop = 0;
        this.launcherTreeScrollTop = 0;
        this.launcherDetailsScrollTop = 0;
        this.showSearchTree = false;
        this.searchDebounceTimer = null;
        this.searchRequestId = 0;
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
        this.treeExpandedPaths = new Set(["."]);
        this.treeCache = new Map();

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

        // Click outside search results to hide (never hide on panel resize or clicks inside panel)
        document.addEventListener("click", (e) => {
            if (this.isResizing || this.justFinishedResizing) return;
            if (!e.target.closest("#rightPanel") && !e.target.closest("#headerRightPanelBtn")) {
                if (!this.searchInputEl?.value.trim() && !this.showSearchTree) {
                    this.hideSearchResults();
                }
            }
        });

        // 3 Dots Button after search pill (explicitly triggers/toggles File Tree)
        if (this.moreBtn) {
            this.moreBtn.title = "Toggle File Tree";
            this.moreBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleSearchTree();
            });
        }

        // Primary Navigation Menu List Handlers
        if (this.itemReview) {
            this.itemReview.addEventListener("click", () => this.openReviewTab());
        }
        if (this.itemOpenFile) {
            this.itemOpenFile.addEventListener("click", () => {
                this.showSearchTree = true;
                if (this.moreBtn) this.moreBtn.classList.add("active");
                if (this.searchInputEl) {
                    this.searchInputEl.value = "";
                    this.searchInputEl.focus();
                }
                this.showSearchResults();
                this.renderSearchResults("");
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
                const u = this.normalizeUrl(this.browserUrlInput?.value || "http://localhost:4440");
                this.browserIframe.src = this.resolveIframeSrc(u);
            });
        }
        if (this.browserUrlInput && this.browserIframe) {
            this.browserUrlInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    const u = this.normalizeUrl(this.browserUrlInput.value);
                    this.browserUrlInput.value = u;
                    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
                    if (activeTab && activeTab.type === "browser") {
                        activeTab.url = u;
                        try {
                            activeTab.title = new URL(u).host || "Browser";
                            this.renderTabStrip();
                        } catch (_) {}
                    }
                    this.browserIframe.src = this.resolveIframeSrc(u);
                }
            });
        }
        if (this.browserOpenExternalBtn) {
            this.browserOpenExternalBtn.addEventListener("click", () => {
                const u = this.normalizeUrl(this.browserUrlInput?.value || "http://localhost:4440");
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
            this.justFinishedResizing = true;
            setTimeout(() => { this.justFinishedResizing = false; }, 200);
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
            this.justFinishedResizing = true;
            setTimeout(() => { this.justFinishedResizing = false; }, 200);
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
            this.panelEl.setAttribute("aria-hidden", "false");
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
            this.panelEl.setAttribute("aria-hidden", "true");
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
                iconOrBadgeHtml = '<i data-lucide="globe"></i>';
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

    openDiffTab(filePath, workspace = "") {
        if (!this.isOpen) {
            this.open();
        }
        const tabId = `diff_${filePath}`;
        let tab = this.tabs.find(t => t.id === tabId);
        if (!tab) {
            this.tabs.push({
                id: tabId,
                type: "diff",
                title: filePath.split("/").pop() || "Review",
                path: filePath,
                workspace: workspace || ""
            });
        } else if (workspace) {
            tab.workspace = workspace;
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
                    <button type="button" class="breadcrumb-btn" id="breadcrumbWrapBtn" title="Toggle Word Wrap">
                        <i data-lucide="wrap-text"></i>
                    </button>
                    <button type="button" class="breadcrumb-btn" id="breadcrumbCopyBtn" title="Copy Content">
                        <i data-lucide="copy"></i>
                    </button>
                    <button type="button" class="breadcrumb-btn" id="breadcrumbMoreBtn" title="More options">
                        <i data-lucide="more-vertical"></i>
                    </button>
                    <button type="button" class="breadcrumb-btn" id="breadcrumbSidebarBtn" title="Toggle sidebar">
                        <i data-lucide="panel-left"></i>
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
        const copyBtn = container.querySelector("#breadcrumbCopyBtn");
        const wrapBtn = container.querySelector("#breadcrumbWrapBtn");
        const menu = container.querySelector("#breadcrumbDropdownMenu");

        if (sidebarBtn) {
            sidebarBtn.addEventListener("click", () => this.toggleSidebar());
        }

        if (copyBtn) {
            copyBtn.addEventListener("click", async () => {
                if (!rawContent) return;
                try {
                    await navigator.clipboard.writeText(rawContent);
                    const origHtml = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<i data-lucide="check"></i>';
                    renderIcons(copyBtn);
                    setTimeout(() => {
                        copyBtn.innerHTML = origHtml;
                        renderIcons(copyBtn);
                    }, 2000);
                } catch (e) {
                    console.error("Copy content failed:", e);
                }
            });
        }

        if (wrapBtn) {
            wrapBtn.addEventListener("click", () => {
                const viewerWin = container.querySelector(".modern-viewer-window");
                if (viewerWin) {
                    viewerWin.classList.toggle("word-wrap");
                    wrapBtn.classList.toggle("active", viewerWin.classList.contains("word-wrap"));
                }
            });
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
        const filterInput = document.getElementById("viewerSidebarFilterInput");
        if (!listEl) return;

        if (filterInput) {
            filterInput.value = "";
            filterInput.oninput = (e) => {
                const val = e.target.value.trim();
                this.renderViewerSidebarContent(listEl, val, currentFilePath, isDiffMode);
            };
        }

        // Auto-expand ancestors of currentFilePath so active file is visible in tree
        if (currentFilePath && !isDiffMode) {
            const cleanPath = currentFilePath.replace(/\\/g, "/").replace(/^\.\//, "");
            const parts = cleanPath.split("/").filter(Boolean);
            parts.pop(); // Remove file name
            let accumulated = "";
            for (const p of parts) {
                accumulated = accumulated ? `${accumulated}/${p}` : p;
                this.treeExpandedPaths.add(accumulated);
            }
        }

        await this.renderViewerSidebarContent(listEl, "", currentFilePath, isDiffMode);
    }

    async renderViewerSidebarContent(listEl, filterTerm, currentFilePath, isDiffMode) {
        if (!listEl) return;

        if (isDiffMode) {
            try {
                const changesRes = await fetch("/api/history/changes");
                if (!changesRes.ok) {
                    listEl.innerHTML = '<div class="tasks-empty-state">Unable to load changes.</div>';
                    return;
                }
                const changesData = await changesRes.json();
                let changedFiles = Array.isArray(changesData.files) ? changesData.files : [];
                if (filterTerm) {
                    changedFiles = changedFiles.filter(f => {
                        const p = (f.displayPath || f.path || "").toLowerCase();
                        return p.includes(filterTerm.toLowerCase());
                    });
                }
                if (changedFiles.length === 0) {
                    listEl.innerHTML = '<div class="tasks-empty-state">No changed files found.</div>';
                    return;
                }
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
                const prevScrollTop = this.viewerSidebarScrollTop !== undefined
                    ? this.viewerSidebarScrollTop
                    : (listEl.scrollTop || 0);

                listEl.innerHTML = html;
                renderIcons(listEl);
                this.bindViewerSidebarClicks(listEl);

                listEl.scrollTop = prevScrollTop;
                const activeDiff = listEl.querySelector(".viewer-sidebar-item.active");
                if (activeDiff) {
                    activeDiff.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
                listEl.onscroll = () => {
                    this.viewerSidebarScrollTop = listEl.scrollTop;
                };
            } catch (_) {
                listEl.innerHTML = '<div class="tasks-empty-state">Unable to load changes.</div>';
            }
            return;
        }

        // Normal file mode: VS Code Tree
        try {
            let treeHtml = "";
            if (filterTerm) {
                const res = await fetch("/api/file/find", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: filterTerm })
                });
                const data = res.ok ? await res.json() : { results: [] };
                const results = Array.isArray(data.results) ? data.results : [];
                if (results.length === 0) {
                    listEl.innerHTML = `<div class="tasks-empty-state">No matching files found.</div>`;
                    return;
                }
                const hierarchy = this.buildHierarchyFromFlatList(results);
                treeHtml = this.renderHierarchyHtml(hierarchy, 0, filterTerm.toLowerCase(), currentFilePath);
            } else {
                treeHtml = await this.buildDirectoryTreeHtml(".", 0, currentFilePath);
            }

            const prevScrollTop = this.viewerSidebarScrollTop !== undefined
                ? this.viewerSidebarScrollTop
                : (listEl.scrollTop || 0);

            if (!treeHtml.trim()) {
                listEl.innerHTML = '<div class="tasks-empty-state">Empty workspace.</div>';
            } else {
                listEl.innerHTML = treeHtml;
            }
            renderIcons(listEl);
            this.bindTreeContainerClicks(listEl, false, currentFilePath);

            listEl.scrollTop = prevScrollTop;
            const activeNode = listEl.querySelector(".search-tree-node.active, .search-tree-node.selected");
            if (activeNode) {
                activeNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
            listEl.onscroll = () => {
                this.viewerSidebarScrollTop = listEl.scrollTop;
            };
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

    bindViewerColResizer(containerEl) {
        if (!containerEl) return;
        const resizer = containerEl.querySelector("#viewerColResizer");
        const sidebar = containerEl.querySelector(".viewer-sidebar-pane");
        const splitCont = containerEl.querySelector(".viewer-split-container") || containerEl;
        if (!resizer || !sidebar) return;

        let isDragging = false;

        const updateWidth = (clientX) => {
            const rect = splitCont.getBoundingClientRect();
            if (rect.width <= 0) return;
            // Sidebar is on the RIGHT side, so its width is (rect.right - clientX)
            const newW = Math.max(140, Math.min(Math.min(500, rect.width - 200), rect.right - clientX));
            this.viewerSidebarWidth = newW;
            sidebar.style.width = `${newW}px`;
            document.documentElement.style.setProperty("--viewer-sidebar-width", `${newW}px`);
        };

        const onMouseMove = (moveEvt) => {
            if (!isDragging) return;
            updateWidth(moveEvt.clientX);
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            this.isResizing = false;
            this.justFinishedResizing = true;
            setTimeout(() => { this.justFinishedResizing = false; }, 200);
            resizer.classList.remove("is-dragging");
            document.body.classList.remove("viewer-sidebar-resizing");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            try {
                localStorage.setItem("multiai_viewer_sidebar_width", String(this.viewerSidebarWidth));
            } catch (_) {}
        };

        resizer.addEventListener("mousedown", (downEvt) => {
            downEvt.preventDefault();
            downEvt.stopPropagation();
            isDragging = true;
            this.isResizing = true;
            resizer.classList.add("is-dragging");
            document.body.classList.add("viewer-sidebar-resizing");
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });

        // Touch support
        const onTouchMove = (tEvt) => {
            if (!isDragging || !tEvt.touches || !tEvt.touches[0]) return;
            updateWidth(tEvt.touches[0].clientX);
        };
        const onTouchEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            this.isResizing = false;
            this.justFinishedResizing = true;
            setTimeout(() => { this.justFinishedResizing = false; }, 200);
            resizer.classList.remove("is-dragging");
            document.body.classList.remove("viewer-sidebar-resizing");
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            try {
                localStorage.setItem("multiai_viewer_sidebar_width", String(this.viewerSidebarWidth));
            } catch (_) {}
        };
        resizer.addEventListener("touchstart", (downEvt) => {
            if (!downEvt.touches || !downEvt.touches[0]) return;
            isDragging = true;
            this.isResizing = true;
            resizer.classList.add("is-dragging");
            document.body.classList.add("viewer-sidebar-resizing");
            document.addEventListener("touchmove", onTouchMove, { passive: true });
            document.addEventListener("touchend", onTouchEnd);
        }, { passive: true });
    }

    async renderDiffTab(tab) {
        if (!this.viewerMountEl) return;
        if (!tab.path) {
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Working tree clean. No unaccepted file modifications.</div>';
            return;
        }

        this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading unified diff…</div>';

        try {
            const chatId = state?.currentChatId || "";
            let diffUrl = `/api/history/diff?path=${encodeURIComponent(tab.path)}`;
            if (chatId) diffUrl += `&chatId=${encodeURIComponent(chatId)}`;
            if (tab.workspace) diffUrl += `&workspace=${encodeURIComponent(tab.workspace)}`;
            const res = await fetch(diffUrl);
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

            const existingContainer = this.viewerMountEl.querySelector("#viewerSplitContainer");
            if (existingContainer) {
                // In-place update: preserve picker position and do not reload sidebar
                const sidebarTitle = this.viewerMountEl.querySelector(".viewer-sidebar-title");
                if (sidebarTitle) sidebarTitle.textContent = "Modified Files";

                const breadcrumbBar = this.viewerMountEl.querySelector(".right-panel-breadcrumb-bar");
                if (breadcrumbBar) {
                    breadcrumbBar.outerHTML = breadcrumbHtml;
                }
                const editorPane = this.viewerMountEl.querySelector(".viewer-editor-pane");
                if (editorPane) {
                    editorPane.innerHTML = `${toolbarHtml}${diffCardHtml}`;
                    bindDiffViewerCards(editorPane);
                    renderIcons(editorPane);
                }
                this.bindBreadcrumbEvents(this.viewerMountEl, tab.path, diffStr);

                const listEl = document.getElementById("viewerSidebarList");
                if (listEl) {
                    const hasDiffItems = listEl.querySelector(".viewer-sidebar-item");
                    if (hasDiffItems) {
                        listEl.querySelectorAll(".viewer-sidebar-item, .search-tree-node").forEach((n) => {
                            n.classList.remove("active", "selected");
                        });
                        const activeNode = listEl.querySelector(`.viewer-sidebar-item[data-path="${escapeHTML(tab.path)}"]`);
                        if (activeNode) {
                            activeNode.classList.add("active");
                            activeNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        } else {
                            this.loadViewerSidebar(folderPath, tab.path, true);
                        }
                    } else {
                        this.loadViewerSidebar(folderPath, tab.path, true);
                    }
                }
                this.bindDiffTabButtons(tab);
                return;
            }

            const splitContainerHtml = `
                ${breadcrumbHtml}
                <div class="viewer-split-container ${this.isSidebarOpen ? "" : "sidebar-collapsed"}" id="viewerSplitContainer">
                    <div class="viewer-editor-pane">
                        ${toolbarHtml}
                        ${diffCardHtml}
                    </div>
                    <div class="viewer-col-resizer" id="viewerColResizer" title="Drag to resize sidebar"></div>
                    <div class="viewer-sidebar-pane">
                        <div class="viewer-sidebar-header">
                            <span class="viewer-sidebar-title">Changes</span>
                        </div>
                        <div class="viewer-sidebar-search-box">
                            <i data-lucide="search" class="viewer-sidebar-search-icon"></i>
                            <input type="text" class="viewer-sidebar-filter-input" id="viewerSidebarFilterInput" placeholder="Filter changes..." autocomplete="off" spellcheck="false">
                        </div>
                        <div class="viewer-sidebar-list" id="viewerSidebarList">
                            <div class="tasks-empty-state">Loading changes…</div>
                        </div>
                    </div>
                </div>
            `;

            this.viewerMountEl.innerHTML = splitContainerHtml;
            bindDiffViewerCards(this.viewerMountEl);
            renderIcons(this.viewerMountEl);
            this.bindViewerColResizer(this.viewerMountEl);
            this.bindBreadcrumbEvents(this.viewerMountEl, tab.path, diffStr);
            this.loadViewerSidebar(folderPath, tab.path, true);
            this.bindDiffTabButtons(tab);
        } catch (err) {
            console.error("[RightPanel] Render diff tab error:", err);
            this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Failed to render diff.</div>';
        }
    }

    bindDiffTabButtons(tab) {
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
    }

    openFileTab(filePath, workspace = "") {
        if (!this.isOpen) {
            this.open();
        }
        const tabId = `file_${filePath}`;
        const existing = this.tabs.find(t => t.id === tabId);
        if (existing) {
            if (workspace) existing.workspace = workspace;
            this.switchTab(tabId);
            return;
        }

        this.tabs.push({
            id: tabId,
            type: "file",
            title: filePath.split("/").pop(),
            path: filePath,
            workspace: workspace || ""
        });

        this.switchTab(tabId);
    }

    async renderFileTab(tab) {
        if (!this.viewerMountEl) return;
        this.viewerMountEl.innerHTML = '<div class="tasks-empty-state">Loading file…</div>';

        try {
            const chatId = state?.currentChatId || "";
            const res = await fetch("/api/file/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    path: tab.path, 
                    chatId,
                    workspace: tab.workspace || "",
                    numbered: false 
                })
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

            const existingContainer = this.viewerMountEl.querySelector("#viewerSplitContainer");
            if (existingContainer) {
                // In-place update: preserve picker position and do not reload sidebar
                const sidebarTitle = this.viewerMountEl.querySelector(".viewer-sidebar-title");
                if (sidebarTitle) sidebarTitle.textContent = "Workspace";

                const breadcrumbBar = this.viewerMountEl.querySelector(".right-panel-breadcrumb-bar");
                if (breadcrumbBar) {
                    breadcrumbBar.outerHTML = breadcrumbHtml;
                }
                const editorPane = this.viewerMountEl.querySelector(".viewer-editor-pane");
                if (editorPane) {
                    editorPane.innerHTML = codeCardHtml;
                    bindDiffViewerCards(editorPane);
                    renderIcons(editorPane);
                }
                this.bindBreadcrumbEvents(this.viewerMountEl, tab.path, content);

                const listEl = document.getElementById("viewerSidebarList");
                if (listEl) {
                    const hasTreeNodes = listEl.querySelector(".search-tree-node");
                    if (hasTreeNodes) {
                        listEl.querySelectorAll(".search-tree-node, .viewer-sidebar-item").forEach((n) => {
                            n.classList.remove("active", "selected");
                        });
                        const activeNode = listEl.querySelector(`.search-tree-node[data-path="${escapeHTML(tab.path)}"], .viewer-sidebar-item[data-path="${escapeHTML(tab.path)}"]`);
                        if (activeNode) {
                            activeNode.classList.add("active");
                            activeNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        } else {
                            this.loadViewerSidebar(folderPath, tab.path, false);
                        }
                    } else {
                        this.loadViewerSidebar(folderPath, tab.path, false);
                    }
                }
                return;
            }

            const splitContainerHtml = `
                ${breadcrumbHtml}
                <div class="viewer-split-container ${this.isSidebarOpen ? "" : "sidebar-collapsed"}" id="viewerSplitContainer">
                    <div class="viewer-editor-pane">
                        ${codeCardHtml}
                    </div>
                    <div class="viewer-col-resizer" id="viewerColResizer" title="Drag to resize sidebar"></div>
                    <div class="viewer-sidebar-pane">
                        <div class="viewer-sidebar-header">
                            <span class="viewer-sidebar-title">Workspace</span>
                        </div>
                        <div class="viewer-sidebar-search-box">
                            <i data-lucide="search" class="viewer-sidebar-search-icon"></i>
                            <input type="text" class="viewer-sidebar-filter-input" id="viewerSidebarFilterInput" placeholder="Filter files..." autocomplete="off" spellcheck="false">
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
            this.bindViewerColResizer(this.viewerMountEl);
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

    normalizeUrl(rawUrl) {
        let u = (rawUrl || "").trim();
        if (!u) return "http://localhost:4440";
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            if (u.startsWith("localhost") || u.startsWith("127.0.0.1") || u.startsWith("0.0.0.0") || /:\d+/.test(u)) {
                u = "http://" + u;
            } else {
                u = "https://" + u;
            }
        }
        return u;
    }

    resolveIframeSrc(cleanUrl) {
        if (!cleanUrl) return "about:blank";
        const isLocal = cleanUrl.includes("localhost") || cleanUrl.includes("127.0.0.1") || cleanUrl.includes("0.0.0.0");
        if (isLocal) {
            return cleanUrl;
        }
        return `/api/browser/proxy?url=${encodeURIComponent(cleanUrl)}`;
    }

    openBrowserTab(url) {
        const cleanUrl = this.normalizeUrl(url);

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
        const targetSrc = this.resolveIframeSrc(tab.url);
        if (this.browserIframe && this.browserIframe.getAttribute("data-src") !== targetSrc) {
            this.browserIframe.setAttribute("data-src", targetSrc);
            this.browserIframe.src = targetSrc;
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

        // Live instant update on every letter
        this.executeSearch(query);
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
        const s = (str || "").trim().toLowerCase();
        return s.startsWith("http://") ||
               s.startsWith("https://") ||
               s.startsWith("localhost:") ||
               s.startsWith("127.0.0.1:") ||
               /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(s);
    }

    async fetchDirectory(dirPath = ".") {
        try {
            const res = await fetch("/api/file/list-dir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: dirPath })
            });
            if (!res.ok) return [];
            const data = await res.json();
            const entries = Array.isArray(data.entries) ? data.entries : [];
            this.treeCache.set(dirPath, entries);
            return entries;
        } catch (_) {
            return [];
        }
    }

    buildHierarchyFromFlatList(flatList) {
        const root = { name: "", path: ".", isDir: true, children: {} };
        for (const item of flatList) {
            const clean = (item.path || "").replace(/\\/g, "/").replace(/^\.\//, "");
            const parts = clean.split("/").filter(Boolean);
            let curr = root;
            let accumulated = "";
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                accumulated = accumulated ? `${accumulated}/${part}` : part;
                const isLast = i === parts.length - 1;
                if (!curr.children[part]) {
                    curr.children[part] = {
                        name: part,
                        path: accumulated,
                        isDir: isLast ? Boolean(item.isDir) : true,
                        children: {}
                    };
                }
                curr = curr.children[part];
            }
        }
        return root;
    }

    renderHierarchyHtml(node, depth = 0, term = "", activePath = "") {
        let html = "";
        const children = Object.values(node.children || {});
        children.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const child of children) {
            const isDir = Boolean(child.isDir);
            const nameLower = child.name.toLowerCase();
            const paddingLeft = depth * 14 + 6;

            let labelHtml = escapeHTML(child.name);
            if (term && nameLower.includes(term)) {
                const idx = nameLower.indexOf(term);
                const before = escapeHTML(child.name.slice(0, idx));
                const matched = escapeHTML(child.name.slice(idx, idx + term.length));
                const after = escapeHTML(child.name.slice(idx + term.length));
                labelHtml = `${before}<span class="search-tree-match">${matched}</span>${after}`;
            }

            if (isDir) {
                const isExpanded = term ? true : this.treeExpandedPaths.has(child.path);
                html += `
                    <div class="search-tree-node ${isExpanded ? "is-open" : ""}" data-action="toggle-folder" data-path="${escapeHTML(child.path)}" style="padding-left: ${paddingLeft}px;">
                        <span class="search-tree-chevron">
                            <i data-lucide="chevron-right"></i>
                        </span>
                        <span class="search-tree-icon" style="color: #60a5fa;">
                            <i data-lucide="${isExpanded ? "folder-open" : "folder"}"></i>
                        </span>
                        <span class="search-tree-label">${labelHtml}</span>
                    </div>
                `;
                if (isExpanded) {
                    html += this.renderHierarchyHtml(child, depth + 1, term, activePath);
                }
            } else {
                const isActive = activePath && (activePath === child.path || activePath.endsWith("/" + child.name));
                const meta = getLanguageMeta(child.name);
                const ext = child.name.split(".").pop()?.toLowerCase() || "";
                html += `
                    <div class="search-tree-node ${isActive ? "active" : ""}" data-action="open-file" data-path="${escapeHTML(child.path)}" style="padding-left: ${paddingLeft + 14}px;">
                        <span class="search-tree-icon" style="color: ${meta.color || "inherit"};">
                            <i data-lucide="${meta.icon || "file-text"}"></i>
                        </span>
                        <span class="search-tree-label">${labelHtml}</span>
                        ${ext && ext.length <= 4 ? `<span class="search-tree-badge">${escapeHTML(ext)}</span>` : ""}
                    </div>
                `;
            }
        }
        return html;
    }

    async buildDirectoryTreeHtml(dirPath = ".", depth = 0, activePath = "") {
        const entries = this.treeCache.get(dirPath) || await this.fetchDirectory(dirPath);
        let html = "";
        for (const entry of entries) {
            const isDir = Boolean(entry.isDir);
            const fullPath = dirPath === "." ? entry.name : `${dirPath}/${entry.name}`;
            const paddingLeft = depth * 14 + 6;
            const labelHtml = escapeHTML(entry.name);

            if (isDir) {
                const isExpanded = this.treeExpandedPaths.has(fullPath);
                html += `
                    <div class="search-tree-node ${isExpanded ? "is-open" : ""}" data-action="toggle-folder" data-path="${escapeHTML(fullPath)}" style="padding-left: ${paddingLeft}px;">
                        <span class="search-tree-chevron">
                            <i data-lucide="chevron-right"></i>
                        </span>
                        <span class="search-tree-icon" style="color: #60a5fa;">
                            <i data-lucide="${isExpanded ? "folder-open" : "folder"}"></i>
                        </span>
                        <span class="search-tree-label">${labelHtml}</span>
                    </div>
                `;
                if (isExpanded) {
                    html += await this.buildDirectoryTreeHtml(fullPath, depth + 1, activePath);
                }
            } else {
                const isActive = activePath && (activePath === fullPath || activePath.endsWith("/" + entry.name));
                const meta = getLanguageMeta(entry.name);
                const ext = entry.name.split(".").pop()?.toLowerCase() || "";
                html += `
                    <div class="search-tree-node ${isActive ? "active" : ""}" data-action="open-file" data-path="${escapeHTML(fullPath)}" style="padding-left: ${paddingLeft + 14}px;">
                        <span class="search-tree-icon" style="color: ${meta.color || "inherit"};">
                            <i data-lucide="${meta.icon || "file-text"}"></i>
                        </span>
                        <span class="search-tree-label">${labelHtml}</span>
                        ${ext && ext.length <= 4 ? `<span class="search-tree-badge">${escapeHTML(ext)}</span>` : ""}
                    </div>
                `;
            }
        }
        return html;
    }

    async executeSearch(query) {
        if (!this.searchResultsEl) return;
        const currentReqId = ++this.searchRequestId;

        // 1. If confirmed URL: show direct URL launch pill immediately
        if (this.isUrlString(query)) {
            this.searchResultsEl.innerHTML = `
                <div class="search-result-item" data-action="url" data-val="${escapeHTML(query)}">
                    <div class="search-result-left">
                        <i data-lucide="globe"></i>
                        <span>Open URL: <strong style="color: var(--accent);">${escapeHTML(query)}</strong></span>
                    </div>
                    <span class="search-result-badge">web</span>
                </div>
            `;
            this.showSearchResults();
            renderIcons(this.searchResultsEl);
            const urlItem = this.searchResultsEl.querySelector('.search-result-item[data-action="url"]');
            if (urlItem) {
                urlItem.addEventListener("click", () => {
                    this.openBrowserTab(query);
                    this.hideSearchResults();
                });
            }
            return;
        }

        // 2. Render search results (Tree only shown when explicitly triggered)
        await this.renderSearchResults(query, currentReqId);
    }

    async renderFileTree(filterQuery = "", expectedReqId = null) {
        return this.renderSearchResults(filterQuery, expectedReqId);
    }

    async renderSearchResults(filterQuery = "", expectedReqId = null) {
        if (!this.searchResultsEl) return;
        const term = (filterQuery || "").trim().toLowerCase();

        let treeHtml = "";
        let matchingFiles = [];
        let matchingCode = [];

        if (this.showSearchTree) {
            // Tree explicitly triggered by clicking 3 dots button
            if (term) {
                try {
                    const [findRes, grepRes] = await Promise.allSettled([
                        fetch("/api/file/find", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: term })
                        }),
                        term.length >= 2 ? fetch("/api/code/grep", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: term, search_path: "." })
                        }) : Promise.resolve(null)
                    ]);

                    if (findRes.status === "fulfilled" && findRes.value?.ok) {
                        const data = await findRes.value.json();
                        const results = Array.isArray(data.results) ? data.results : [];
                        matchingFiles = results.filter(r => !r.isDir);
                        const hierarchy = this.buildHierarchyFromFlatList(results);
                        treeHtml = this.renderHierarchyHtml(hierarchy, 0, term, "");
                    }

                    if (grepRes.status === "fulfilled" && grepRes.value?.ok) {
                        const grepData = await grepRes.value.json();
                        matchingCode = Array.isArray(grepData.matches) ? grepData.matches : [];
                    }
                } catch (_) {}
            } else {
                treeHtml = await this.buildDirectoryTreeHtml(".", 0, "");
            }
        } else {
            // Normal search: do NOT show tree! Only fetch matching files & code
            if (term) {
                try {
                    const [findRes, grepRes] = await Promise.allSettled([
                        fetch("/api/file/find", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: term })
                        }),
                        term.length >= 2 ? fetch("/api/code/grep", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: term, search_path: "." })
                        }) : Promise.resolve(null)
                    ]);

                    if (findRes.status === "fulfilled" && findRes.value?.ok) {
                        const data = await findRes.value.json();
                        const results = Array.isArray(data.results) ? data.results : [];
                        matchingFiles = results.filter(r => !r.isDir);
                    }

                    if (grepRes.status === "fulfilled" && grepRes.value?.ok) {
                        const grepData = await grepRes.value.json();
                        matchingCode = Array.isArray(grepData.matches) ? grepData.matches : [];
                    }
                } catch (_) {}
            }
        }

        if (expectedReqId && expectedReqId !== this.searchRequestId) {
            return;
        }

        // Build Files List HTML
        let filesHtml = "";
        if (matchingFiles.length === 0) {
            filesHtml = '<div class="search-code-empty">No matching files.</div>';
        } else {
            matchingFiles.forEach((file) => {
                const badge = getFileBadgeInfo(file.name);
                const parts = file.path.split("/");
                parts.pop();
                const dirPath = parts.join("/") || ".";

                let nameHtml = escapeHTML(file.name);
                if (term && file.name.toLowerCase().includes(term)) {
                    const idx = file.name.toLowerCase().indexOf(term);
                    const before = escapeHTML(file.name.slice(0, idx));
                    const matched = escapeHTML(file.name.slice(idx, idx + term.length));
                    const after = escapeHTML(file.name.slice(idx + term.length));
                    nameHtml = `${before}<span class="search-tree-match">${matched}</span>${after}`;
                }

                filesHtml += `
                    <div class="search-file-item" data-action="open-file" data-path="${escapeHTML(file.path)}" title="${escapeHTML(file.path)}">
                        <span class="search-file-badge" style="color: ${badge.color};">${escapeHTML(badge.text)}</span>
                        <span class="search-file-name">${nameHtml}</span>
                        <span class="search-file-path">${escapeHTML(dirPath)}</span>
                    </div>
                `;
            });
        }

        // Build Code Matches HTML (grouped by filename)
        let codeHtml = "";
        if (matchingCode.length === 0) {
            codeHtml = term.length < 2
                ? '<div class="search-code-empty">Type at least 2 characters to search code.</div>'
                : '<div class="search-code-empty">No code matches found.</div>';
        } else {
            const fileGroups = new Map();
            matchingCode.forEach((m) => {
                if (!fileGroups.has(m.filename)) {
                    fileGroups.set(m.filename, []);
                }
                fileGroups.get(m.filename).push(m);
            });

            fileGroups.forEach((matches, fileName) => {
                const badge = getFileBadgeInfo(fileName);
                const baseName = fileName.split("/").pop() || fileName;

                let matchesHtml = "";
                matches.forEach((m) => {
                    const lineContent = m.line_content || "";
                    let contentHtml = escapeHTML(lineContent.trim());
                    if (term && contentHtml.toLowerCase().includes(term)) {
                        const idx = contentHtml.toLowerCase().indexOf(term);
                        const before = escapeHTML(contentHtml.slice(0, idx));
                        const matched = escapeHTML(contentHtml.slice(idx, idx + term.length));
                        const after = escapeHTML(contentHtml.slice(idx + term.length));
                        contentHtml = `${before}<span class="search-tree-match">${matched}</span>${after}`;
                    }

                    matchesHtml += `
                        <div class="search-code-match-item" data-action="open-file" data-path="${escapeHTML(m.filename)}" data-line="${m.line_number}" title="${escapeHTML(m.filename)}:${m.line_number}">
                            <span class="search-code-line-num">:${m.line_number}</span>
                            <span class="search-code-line-content">${contentHtml}</span>
                        </div>
                    `;
                });

                const dirParts = fileName.split("/");
                dirParts.pop();
                const dirPath = dirParts.join("/") || ".";

                codeHtml += `
                    <div class="search-code-group">
                        <div class="search-code-group-header" data-action="open-file" data-path="${escapeHTML(fileName)}" title="${escapeHTML(fileName)}">
                            <span class="search-file-badge" style="color: ${badge.color};">${escapeHTML(badge.text)}</span>
                            <span class="search-code-file-name">${escapeHTML(baseName)}</span>
                            <span class="search-code-file-path">${escapeHTML(dirPath)}</span>
                        </div>
                        <div class="search-code-group-matches">
                            ${matchesHtml}
                        </div>
                    </div>
                `;
            });
        }

        let finalHtml = "";
        if (!this.showSearchTree) {
            // Normal mode: only Files & Code, full width!
            finalHtml = `
                <div class="search-details-pane full-width">
                    <div class="search-section">
                        <div class="search-section-header">
                            <span class="search-section-title">Files</span>
                        </div>
                        <div class="search-files-list">
                            ${filesHtml}
                        </div>
                    </div>
                    <div class="search-section">
                        <div class="search-section-header">
                            <span class="search-section-title">Code</span>
                        </div>
                        <div class="search-code-list">
                            ${codeHtml}
                        </div>
                    </div>
                </div>
            `;
        } else if (!term) {
            // Tree explicitly triggered with no search query: full-width Tree explorer!
            finalHtml = `
                <div class="search-tree-pane full-width">
                    <div class="search-section-header">
                        <span class="search-section-title">Workspace Tree</span>
                    </div>
                    <div class="search-tree-content" id="launcherTreeContainer">
                        ${treeHtml.trim() ? treeHtml : '<div class="tasks-empty-state">No files.</div>'}
                    </div>
                </div>
            `;
        } else {
            // Tree explicitly triggered with search query: 2-column split layout!
            finalHtml = `
                <div class="search-split-container" id="searchSplitContainer">
                    <!-- Left Column: Files & Code matches -->
                    <div class="search-details-pane" style="flex: 0 0 ${this.searchSplitPercent}%; width: ${this.searchSplitPercent}%;">
                        <div class="search-section">
                            <div class="search-section-header">
                                <span class="search-section-title">Files</span>
                            </div>
                            <div class="search-files-list">
                                ${filesHtml}
                            </div>
                        </div>
                        <div class="search-section">
                            <div class="search-section-header">
                                <span class="search-section-title">Code</span>
                            </div>
                            <div class="search-code-list">
                                ${codeHtml}
                            </div>
                        </div>
                    </div>

                    <!-- Column Splitter Resizer (Draggable to resize files panel) -->
                    <div class="search-col-resizer" id="searchColResizer" title="Drag to resize"></div>

                    <!-- Right Column: Collapsible File Tree -->
                    <div class="search-tree-pane" style="flex: 1 1 ${100 - this.searchSplitPercent}%;">
                        <div class="search-section-header">
                            <span class="search-section-title">Tree</span>
                        </div>
                        <div class="search-tree-content" id="launcherTreeContainer">
                            ${treeHtml.trim() ? treeHtml : '<div class="tasks-empty-state">No files.</div>'}
                        </div>
                    </div>
                </div>
            `;
        }

        const oldDetailsPane = this.searchResultsEl.querySelector(".search-details-pane");
        const oldTreeCont = this.searchResultsEl.querySelector("#launcherTreeContainer");
        if (oldDetailsPane) this.launcherDetailsScrollTop = oldDetailsPane.scrollTop;
        if (oldTreeCont) this.launcherTreeScrollTop = oldTreeCont.scrollTop;

        this.searchResultsEl.innerHTML = finalHtml;
        this.showSearchResults();
        renderIcons(this.searchResultsEl);
        this.bindLauncherSearchResultsEvents();

        const newDetailsPane = this.searchResultsEl.querySelector(".search-details-pane");
        const newTreeCont = this.searchResultsEl.querySelector("#launcherTreeContainer");
        if (newDetailsPane && this.launcherDetailsScrollTop) {
            newDetailsPane.scrollTop = this.launcherDetailsScrollTop;
        }
        if (newTreeCont && this.launcherTreeScrollTop) {
            newTreeCont.scrollTop = this.launcherTreeScrollTop;
        }
        if (newDetailsPane) {
            newDetailsPane.onscroll = () => {
                this.launcherDetailsScrollTop = newDetailsPane.scrollTop;
            };
        }
        if (newTreeCont) {
            newTreeCont.onscroll = () => {
                this.launcherTreeScrollTop = newTreeCont.scrollTop;
            };
        }
    }

    bindLauncherSearchResultsEvents() {
        if (!this.searchResultsEl) return;
        renderIcons(this.searchResultsEl);

        const treeCont = this.searchResultsEl.querySelector("#launcherTreeContainer");
        if (treeCont) {
            this.bindTreeContainerClicks(treeCont, true, "");
        }

        // Interactive Column Resizer between Files & Tree
        const colResizer = this.searchResultsEl.querySelector("#searchColResizer");
        const leftPane = this.searchResultsEl.querySelector(".search-details-pane");
        const rightPane = this.searchResultsEl.querySelector(".search-tree-pane");
        const splitCont = this.searchResultsEl.querySelector("#searchSplitContainer");

        if (colResizer && leftPane && rightPane && splitCont) {
            let isColDragging = false;

            const updateSplit = (clientX) => {
                const rect = splitCont.getBoundingClientRect();
                if (rect.width <= 0) return;
                const offsetX = clientX - rect.left;
                const percent = Math.max(15, Math.min(85, (offsetX / rect.width) * 100));
                this.searchSplitPercent = percent;
                leftPane.style.flex = `0 0 ${percent}%`;
                leftPane.style.width = `${percent}%`;
                rightPane.style.flex = `1 1 ${100 - percent}%`;
            };

            const onMouseMove = (moveEvt) => {
                if (!isColDragging) return;
                updateSplit(moveEvt.clientX);
            };

            const onMouseUp = () => {
                if (!isColDragging) return;
                isColDragging = false;
                this.isResizing = false;
                this.justFinishedResizing = true;
                setTimeout(() => { this.justFinishedResizing = false; }, 200);
                colResizer.classList.remove("is-dragging");
                document.body.classList.remove("right-panel-resizing");
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                try {
                    localStorage.setItem("multiai_search_split_percent", String(this.searchSplitPercent));
                } catch (_) {}
            };

            colResizer.addEventListener("mousedown", (downEvt) => {
                downEvt.preventDefault();
                downEvt.stopPropagation();
                isColDragging = true;
                this.isResizing = true;
                colResizer.classList.add("is-dragging");
                document.body.classList.add("right-panel-resizing");
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });

            // Touch support for column resizer
            const onTouchMove = (tEvt) => {
                if (!isColDragging || !tEvt.touches || !tEvt.touches[0]) return;
                updateSplit(tEvt.touches[0].clientX);
            };
            const onTouchEnd = () => {
                if (!isColDragging) return;
                isColDragging = false;
                this.isResizing = false;
                this.justFinishedResizing = true;
                setTimeout(() => { this.justFinishedResizing = false; }, 200);
                colResizer.classList.remove("is-dragging");
                document.body.classList.remove("right-panel-resizing");
                document.removeEventListener("touchmove", onTouchMove);
                document.removeEventListener("touchend", onTouchEnd);
                try {
                    localStorage.setItem("multiai_search_split_percent", String(this.searchSplitPercent));
                } catch (_) {}
            };
            colResizer.addEventListener("touchstart", (downEvt) => {
                if (!downEvt.touches || !downEvt.touches[0]) return;
                isColDragging = true;
                this.isResizing = true;
                colResizer.classList.add("is-dragging");
                document.body.classList.add("right-panel-resizing");
                document.addEventListener("touchmove", onTouchMove, { passive: true });
                document.addEventListener("touchend", onTouchEnd);
            }, { passive: true });
        }

        this.searchResultsEl.querySelectorAll('.search-file-item[data-action="open-file"]').forEach((item) => {
            item.addEventListener("click", () => {
                const p = item.getAttribute("data-path");
                if (p) {
                    this.openFileTab(p);
                    this.hideSearchResults();
                }
            });
        });

        this.searchResultsEl.querySelectorAll('.search-code-match-item, .search-code-group-header').forEach((item) => {
            item.addEventListener("click", () => {
                const p = item.getAttribute("data-path");
                if (p) {
                    this.openFileTab(p);
                    this.hideSearchResults();
                }
            });
        });
    }

    async loadDirectoryContents(dirPath = ".") {
        this.treeExpandedPaths.add(dirPath);
        await this.renderFileTree(this.searchInputEl?.value.trim() || "");
    }

    bindTreeContainerClicks(containerEl, isLauncher = false, currentFilePath = "") {
        if (!containerEl) return;
        renderIcons(containerEl);

        containerEl.querySelectorAll(".search-tree-node").forEach((node) => {
            node.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = node.getAttribute("data-action");
                const pathVal = node.getAttribute("data-path");

                if (action === "toggle-folder") {
                    if (this.treeExpandedPaths.has(pathVal)) {
                        this.treeExpandedPaths.delete(pathVal);
                    } else {
                        this.treeExpandedPaths.add(pathVal);
                        if (!this.treeCache.has(pathVal)) {
                            await this.fetchDirectory(pathVal);
                        }
                    }
                    if (isLauncher) {
                        await this.renderFileTree(this.searchInputEl?.value.trim() || "");
                    } else {
                        const filterVal = document.getElementById("viewerSidebarFilterInput")?.value.trim() || "";
                        await this.renderViewerSidebarContent(containerEl, filterVal, currentFilePath, false);
                    }
                } else if (action === "open-file") {
                    this.openFileTab(pathVal);
                    if (isLauncher) this.hideSearchResults();
                }
            });
        });
    }

    showSearchResults() {
        if (this.launcherViewEl) this.launcherViewEl.classList.add("is-searching");
        if (this.searchResultsEl) this.searchResultsEl.style.display = "flex";
    }

    hideSearchResults() {
        if (this.launcherViewEl) this.launcherViewEl.classList.remove("is-searching");
        if (this.searchResultsEl) {
            this.searchResultsEl.style.display = "none";
            this.searchResultsEl.innerHTML = "";
        }
        this.showSearchTree = false;
        if (this.moreBtn) this.moreBtn.classList.remove("active");
    }

    async toggleSearchTree() {
        this.showSearchTree = !this.showSearchTree;
        if (this.moreBtn) {
            this.moreBtn.classList.toggle("active", this.showSearchTree);
        }
        const query = this.searchInputEl?.value.trim() || "";
        if (this.showSearchTree) {
            this.showSearchResults();
            await this.renderSearchResults(query);
        } else {
            if (query) {
                await this.renderSearchResults(query);
            } else {
                this.hideSearchResults();
            }
        }
    }

    // ── Background Tasks List (Matches Reference Image) ───────
    async loadTasks(isBackground = false) {
        try {
            const res = await fetch("/api/task/list");
            if (!res.ok) return;
            const data = await res.json();

            const backgroundTasks = [];
            const nowSec = Math.round(Date.now() / 1000);

            for (const [id, t] of Object.entries(data)) {
                if (!t || typeof t !== "object") continue;
                // Background tasks must be actively running
                if (!t.running) continue;

                const elapsed = t.start_time ? Math.max(0, nowSec - t.start_time) : 0;
                // Background tasks must be running over 30+ seconds
                if (elapsed >= 30) {
                    backgroundTasks.push({
                        id,
                        running: true,
                        exitCode: null,
                        command: t.command || "Shell task",
                        startTime: t.start_time,
                        elapsed
                    });
                }
            }

            this.lastActiveTasks = backgroundTasks;
            this.lastCompletedTasks = [];

            if (this.tasksBadgeEl) {
                if (backgroundTasks.length > 0) {
                    this.tasksBadgeEl.textContent = String(backgroundTasks.length);
                    this.tasksBadgeEl.style.display = "inline-block";
                } else {
                    this.tasksBadgeEl.style.display = "none";
                }
            }

            this.renderTasksList(backgroundTasks);
        } catch (err) {
            if (!isBackground) console.error("[RightPanel] Load tasks error:", err);
        }
    }

    renderTasksList(backgroundTasks = []) {
        if (!this.tasksListEl) return;

        if (!backgroundTasks || backgroundTasks.length === 0) {
            this.tasksListEl.innerHTML = '<div class="launcher-tasks-empty">No active background tasks.</div>';
            if (this.seeAllBtn) this.seeAllBtn.style.display = "none";
            return;
        }

        const displayLimit = this.showAllTasks ? backgroundTasks.length : 4;
        const visibleTasks = backgroundTasks.slice(0, displayLimit);

        let html = "";
        visibleTasks.forEach((task) => {
            const nowSec = Math.round(Date.now() / 1000);
            const elapsed = task.startTime ? Math.max(0, nowSec - task.startTime) : (task.elapsed || 30);
            const durStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;

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
            this.seeAllBtn.style.display = backgroundTasks.length > 4 ? "block" : "none";
        }

        // Clicking a task attaches to terminal or opens log output
        this.tasksListEl.querySelectorAll(".launcher-task-row").forEach((row) => {
            row.addEventListener("click", () => {
                const tid = row.getAttribute("data-task-id");
                const task = backgroundTasks.find(t => t.id === tid);
                if (task) {
                    this.openTerminalTab();
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
