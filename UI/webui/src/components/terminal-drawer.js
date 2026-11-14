/**
 * MultiAI Real Pseudo-Terminal (PTY) Drawer & Panel Component
 * ============================================================
 * Provides full interactive PTY terminal emulation using xterm.js
 * over real-time WebSocket with HTTP SSE fallback.
 * 
 * Supports 4 Dock Positions:
 * - Left (Default: starts as a left panel pushing chat to the right)
 * - Right (settles on right pushing chat to the left)
 * - Down / Bottom (settles at the bottom pushing chat up)
 * - Up / Top (settles at the top pushing chat down)
 */

class TerminalDrawerManager {
    constructor() {
        this.isOpen = false;
        this.isFullscreen = false;
        this.drawerEl = null;
        this.tabsEl = null;
        this.bodyEl = null;
        this.dockPickerEl = null;
        this.dockPopoverEl = null;
        this.sessions = [];
        this.activeSessionId = null;
        this.sessionCounter = 0;

        // Dock position defaults to 'left' as requested
        const getStorage = (key) => (typeof localStorage !== "undefined" ? localStorage.getItem(key) : null);
        this.dockPosition = getStorage("multiai_term_dock_pos") || "left";
        const savedW = parseInt(getStorage("multiai_term_dock_width"), 10);
        this.width = (savedW && savedW <= 2000 && savedW >= 160) ? savedW : 360;
        const savedH = parseInt(getStorage("multiai_term_dock_height"), 10);
        this.height = (savedH && savedH <= 1500 && savedH >= 120) ? savedH : 320;
    }

    init() {
        if (this.drawerEl) return;
        this.renderDrawerDOM();
        this.bindGlobalEvents();
        this.applyDockStyles();

        const headerPill = document.getElementById("headerTerminalPill");
        if (headerPill) {
            headerPill.addEventListener("click", () => {
                this.open();
            });
        }
    }

    renderDrawerDOM() {
        const drawer = document.createElement("div");
        drawer.id = "terminalDrawer";
        drawer.className = `terminal-drawer dock-${this.dockPosition}`;
        drawer.innerHTML = `
            <div class="terminal-resizer" id="terminalResizer" title="Drag to resize terminal"></div>
            <div class="terminal-header">
                <div class="terminal-header-left">
                    <button type="button" class="terminal-chat-switch-btn" id="terminalChatSwitchBtn" title="Switch back to Chat (Session preserved in background)" aria-label="Switch to Chat">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                        <span>Chat</span>
                    </button>
                    <div class="terminal-title-badge">
                        <span class="terminal-status-dot" id="terminalStatusDot" title="Terminal Connected"></span>
                        <span>Terminal</span>
                    </div>
                    <div class="terminal-tabs" id="terminalTabs"></div>
                    <button type="button" class="terminal-new-tab-btn" id="terminalNewTabBtn" title="New Terminal Session" aria-label="New Session">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
                <div class="terminal-header-right">
                    <!-- 4-Square Switcher Icon (2 on top, 2 on bottom) -->
                    <div class="terminal-dock-picker" id="terminalDockPicker">
                        <button type="button" class="terminal-action-btn" id="terminalDockBtn" title="Change Dock Position (Left, Right, Down, Up)" aria-label="Dock Position" aria-haspopup="true" aria-expanded="false">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                                <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                                <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                                <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                            </svg>
                        </button>
                        <div class="terminal-dock-popover" id="terminalDockPopover" role="menu" aria-label="Dock Position">
                            <button type="button" class="dock-option-btn ${this.dockPosition === 'left' ? 'active' : ''}" data-dock="left" role="menuitem">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="3" y="3" width="7" height="18" rx="1" fill="currentColor" opacity="0.3"></rect></svg>
                                <span>Left</span>
                            </button>
                            <button type="button" class="dock-option-btn ${this.dockPosition === 'right' ? 'active' : ''}" data-dock="right" role="menuitem">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="14" y="3" width="7" height="18" rx="1" fill="currentColor" opacity="0.3"></rect></svg>
                                <span>Right</span>
                            </button>
                            <button type="button" class="dock-option-btn ${this.dockPosition === 'bottom' ? 'active' : ''}" data-dock="bottom" role="menuitem">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="3" y="14" width="18" height="7" rx="1" fill="currentColor" opacity="0.3"></rect></svg>
                                <span>Down</span>
                            </button>
                            <button type="button" class="dock-option-btn ${this.dockPosition === 'top' ? 'active' : ''}" data-dock="top" role="menuitem">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="3" y="3" width="18" height="7" rx="1" fill="currentColor" opacity="0.3"></rect></svg>
                                <span>Up</span>
                            </button>
                        </div>
                    </div>

                    <button type="button" class="terminal-action-btn" id="terminalClearBtn" title="Clear Terminal (Ctrl+L)" aria-label="Clear">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                    <button type="button" class="terminal-action-btn" id="terminalExpandBtn" title="Toggle Fullscreen" aria-label="Fullscreen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                    </button>
                    <button type="button" class="terminal-action-btn" id="terminalCloseBtn" title="Close Terminal (Ctrl+\`)" aria-label="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            <div class="terminal-body" id="terminalBody"></div>
        `;

        document.body.appendChild(drawer);
        this.drawerEl = drawer;
        this.tabsEl = drawer.querySelector("#terminalTabs");
        this.bodyEl = drawer.querySelector("#terminalBody");
        this.dockPickerEl = drawer.querySelector("#terminalDockPicker");
        this.dockPopoverEl = drawer.querySelector("#terminalDockPopover");

        // Action listeners
        drawer.querySelector("#terminalChatSwitchBtn")?.addEventListener("click", () => this.close());
        drawer.querySelector("#terminalCloseBtn").addEventListener("click", () => this.close());
        drawer.querySelector("#terminalExpandBtn").addEventListener("click", () => this.toggleFullscreen());
        drawer.querySelector("#terminalClearBtn").addEventListener("click", () => this.clearActiveTerminal());
        drawer.querySelector("#terminalNewTabBtn").addEventListener("click", () => this.createSession());

        // Dock picker dropdown listeners
        const dockBtn = drawer.querySelector("#terminalDockBtn");
        dockBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleDockPopover();
        });

        this.dockPopoverEl.querySelectorAll(".dock-option-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetDock = btn.getAttribute("data-dock");
                if (targetDock) {
                    this.setDockPosition(targetDock);
                    this.closeDockPopover();
                }
            });
        });

        document.addEventListener("click", (e) => {
            if (this.dockPopoverEl && !this.dockPickerEl.contains(e.target)) {
                this.closeDockPopover();
            }
        });

        // Header Terminal persistence pill in Chat view
        const headerPill = document.getElementById("headerTerminalPill");
        if (headerPill && !headerPill.dataset.bound) {
            headerPill.dataset.bound = "true";
            headerPill.addEventListener("click", () => {
                this.open();
            });
        }

        this.initResizer(drawer.querySelector("#terminalResizer"));
    }

    toggleDockPopover() {
        if (!this.dockPopoverEl) return;
        const isOpen = this.dockPopoverEl.classList.contains("is-open");
        if (isOpen) {
            this.closeDockPopover();
        } else {
            this.dockPopoverEl.classList.add("is-open");
            this.drawerEl.querySelector("#terminalDockBtn")?.setAttribute("aria-expanded", "true");
        }
    }

    closeDockPopover() {
        if (!this.dockPopoverEl) return;
        this.dockPopoverEl.classList.remove("is-open");
        this.drawerEl.querySelector("#terminalDockBtn")?.setAttribute("aria-expanded", "false");
    }

    setDockPosition(pos) {
        if (!["left", "right", "bottom", "top"].includes(pos)) return;
        this.dockPosition = pos;
        if (typeof localStorage !== "undefined") {
            try { localStorage.setItem("multiai_term_dock_pos", pos); } catch (_) {}
        }

        // Update drawer classes
        this.drawerEl.classList.remove("dock-left", "dock-right", "dock-bottom", "dock-top");
        this.drawerEl.classList.add(`dock-${pos}`);

        // Update popover active buttons
        this.dockPopoverEl?.querySelectorAll(".dock-option-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-dock") === pos);
        });

        // Update body pushing classes if open
        if (this.isOpen) {
            document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
            document.body.classList.add(`term-open-${pos}`);
        }

        this.applyDockStyles();

        setTimeout(() => {
            this.fitActiveTerminal();
            this.focusActiveTerminal();
        }, 60);
    }

    applyDockStyles() {
        if (!this.drawerEl) return;

        document.documentElement.style.setProperty("--term-panel-width", `${this.width}px`);
        document.documentElement.style.setProperty("--term-panel-height", `${this.height}px`);

        if (this.dockPosition === "left" || this.dockPosition === "right") {
            this.drawerEl.style.width = `${this.width}px`;
            this.drawerEl.style.height = "100vh";
        } else {
            this.drawerEl.style.width = "100%";
            this.drawerEl.style.height = `${this.height}px`;
        }
    }

    initResizer(resizerEl) {
        let isResizing = false;

        const onMouseMove = (e) => {
            if (!isResizing) return;

            if (this.dockPosition === "left") {
                const minAllowedW = 160;
                const maxAllowedW = Math.max(minAllowedW, window.innerWidth - 220);
                const newW = Math.max(minAllowedW, Math.min(maxAllowedW, e.clientX));
                this.width = newW;
                document.documentElement.style.setProperty("--term-panel-width", `${newW}px`);
                this.drawerEl.style.width = `${newW}px`;
            } else if (this.dockPosition === "right") {
                const minAllowedW = 160;
                const maxAllowedW = Math.max(minAllowedW, window.innerWidth - 220);
                const newW = Math.max(minAllowedW, Math.min(maxAllowedW, window.innerWidth - e.clientX));
                this.width = newW;
                document.documentElement.style.setProperty("--term-panel-width", `${newW}px`);
                this.drawerEl.style.width = `${newW}px`;
            } else if (this.dockPosition === "bottom") {
                const minAllowedH = 120;
                const maxAllowedH = Math.max(minAllowedH, window.innerHeight - 100);
                const newH = Math.max(minAllowedH, Math.min(maxAllowedH, window.innerHeight - e.clientY));
                this.height = newH;
                document.documentElement.style.setProperty("--term-panel-height", `${newH}px`);
                this.drawerEl.style.height = `${newH}px`;
            } else if (this.dockPosition === "top") {
                const minAllowedH = 120;
                const maxAllowedH = Math.max(minAllowedH, window.innerHeight - 100);
                const newH = Math.max(minAllowedH, Math.min(maxAllowedH, e.clientY));
                this.height = newH;
                document.documentElement.style.setProperty("--term-panel-height", `${newH}px`);
                this.drawerEl.style.height = `${newH}px`;
            }

            this.fitActiveTerminal();
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            resizerEl.classList.remove("resizing");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            const contentEl = this.drawerEl.querySelector(".terminal-content");
            if (contentEl) contentEl.style.pointerEvents = "";

            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            if (typeof localStorage !== "undefined") {
                try {
                    if (this.dockPosition === "left" || this.dockPosition === "right") {
                        localStorage.setItem("multiai_term_dock_width", String(this.width));
                    } else {
                        localStorage.setItem("multiai_term_dock_height", String(this.height));
                    }
                } catch (_) {}
            }

            this.fitActiveTerminal();
        };

        resizerEl.addEventListener("mousedown", (e) => {
            isResizing = true;
            resizerEl.classList.add("resizing");
            document.body.style.cursor = (this.dockPosition === "left" || this.dockPosition === "right") ? "col-resize" : "row-resize";
            document.body.style.userSelect = "none";
            const contentEl = this.drawerEl.querySelector(".terminal-content");
            if (contentEl) contentEl.style.pointerEvents = "none";

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            e.preventDefault();
        });
    }

    bindGlobalEvents() {
        // Toggle terminal with Ctrl + ` (backtick) or Ctrl + Shift + `
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && (e.key === "`" || e.key === "~")) {
                e.preventDefault();
                this.toggle();
            }
        });

        // Window resize refits terminal
        window.addEventListener("resize", () => {
            if (this.isOpen) {
                const isMobile = window.innerWidth <= 768 || document.documentElement.classList.contains("is-android");
                if (isMobile) {
                    this.isFullscreen = true;
                    this.drawerEl.classList.add("fullscreen");
                    document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
                }
                this.fitActiveTerminal();
            }
        });
    }

    open(options = {}) {
        if (!this.drawerEl) this.init();
        this.isOpen = true;
        this.drawerEl.classList.add("open");

        const isMobile = window.innerWidth <= 768 || document.documentElement.classList.contains("is-android");
        if (isMobile) {
            this.isFullscreen = true;
            this.drawerEl.classList.add("fullscreen");
            document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
        } else {
            this.drawerEl.classList.toggle("fullscreen", !!this.isFullscreen);
            if (!this.isFullscreen) {
                document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
                document.body.classList.add(`term-open-${this.dockPosition}`);
            } else {
                document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
            }
        }

        this.updatePersistenceIndicators();

        // If no active session, spawn one
        if (this.sessions.length === 0) {
            this.createSession(options);
        } else {
            setTimeout(() => {
                this.fitActiveTerminal();
                this.focusActiveTerminal();
            }, 60);
        }
    }

    close() {
        if (!this.drawerEl) return;
        this.isOpen = false;
        this.drawerEl.classList.remove("open");
        document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
        this.updatePersistenceIndicators();
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        this.drawerEl.classList.toggle("fullscreen", this.isFullscreen);
        if (this.isFullscreen) {
            document.body.classList.remove("term-open-left", "term-open-right", "term-open-bottom", "term-open-top");
        } else {
            const isMobile = window.innerWidth <= 768 || document.documentElement.classList.contains("is-android");
            if (!isMobile) {
                this.applyDockStyles();
                if (this.isOpen) {
                    document.body.classList.add(`term-open-${this.dockPosition}`);
                }
            }
        }
        setTimeout(() => this.fitActiveTerminal(), 50);
    }

    createSession(options = {}) {
        this.sessionCounter++;
        const sessionIdx = this.sessionCounter;
        const sessionId = `term_sess_${Date.now()}_${sessionIdx}`;
        const name = options.name || `bash (${sessionIdx})`;

        // Mount container for xterm
        const mount = document.createElement("div");
        mount.className = "terminal-container";
        mount.id = `mount_${sessionId}`;
        this.bodyEl.appendChild(mount);

        const session = {
            id: sessionId,
            ptyId: null,
            name,
            mount,
            term: null,
            fitAddon: null,
            webLinksAddon: null,
            ws: null,
            sseEventSource: null,
            connected: false
        };

        this.sessions.push(session);
        this.renderTabs();
        this.switchSession(sessionId);
        this.updatePersistenceIndicators();

        // Initialize xterm instance
        this.setupXterm(session, options);
        return session;
    }

    setupXterm(session, options = {}) {
        const TerminalClass = window.Terminal;
        if (!TerminalClass) {
            console.error("[PTY] xterm.js not loaded on window.Terminal");
            session.mount.innerHTML = `<div style="color:#e06c75;padding:16px;">Error: xterm.js library could not be loaded.</div>`;
            return;
        }

        const term = new TerminalClass({
            cursorBlink: true,
            cursorStyle: "block",
            fontSize: 13,
            lineHeight: 1.25,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            theme: {
                background: "#09090b",
                foreground: "#f2f2f2",
                cursor: "#ffffff",
                cursorAccent: "#09090b",
                selectionBackground: "rgba(255, 255, 255, 0.2)",
                black: "#1c1c1f",
                red: "#e06c75",
                green: "#98c379",
                yellow: "#e5c07b",
                blue: "#61afef",
                magenta: "#c678dd",
                cyan: "#56b6c2",
                white: "#abb2bf",
                brightBlack: "#5c6370",
                brightRed: "#be5046",
                brightGreen: "#98c379",
                brightYellow: "#d19a66",
                brightBlue: "#61afef",
                brightMagenta: "#c678dd",
                brightCyan: "#56b6c2",
                brightWhite: "#ffffff"
            },
            convertEol: true,
            allowProposedApi: true
        });

        session.term = term;

        // Load Addons safely (handle both function and UMD namespace exports)
        const FitAddonClass = typeof window.FitAddon === "function" ? window.FitAddon : (window.FitAddon?.FitAddon || null);
        if (FitAddonClass) {
            try {
                const fitAddon = new FitAddonClass();
                term.loadAddon(fitAddon);
                session.fitAddon = fitAddon;
            } catch (err) {
                console.warn("[PTY] FitAddon load error:", err);
            }
        }

        const WebLinksAddonClass = typeof window.WebLinksAddon === "function" ? window.WebLinksAddon : (window.WebLinksAddon?.WebLinksAddon || null);
        if (WebLinksAddonClass) {
            try {
                const webLinksAddon = new WebLinksAddonClass();
                term.loadAddon(webLinksAddon);
                session.webLinksAddon = webLinksAddon;
            } catch (err) {
                console.warn("[PTY] WebLinksAddon load error:", err);
            }
        }

        term.open(session.mount);
        term.focus();

        setTimeout(() => {
            if (session.fitAddon) {
                try { session.fitAddon.fit(); } catch (_) {}
            }
            this.connectSessionStream(session, options);
        }, 50);

        // Keystroke forwarding
        term.onData((data) => {
            this.sendInput(session, data);
        });

        // Resize forwarding
        term.onResize(({ cols, rows }) => {
            this.sendResize(session, cols, rows);
        });
    }

    connectSessionStream(session, options = {}) {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/ws/pty`;

        let wsConnected = false;
        try {
            const ws = new WebSocket(wsUrl);
            session.ws = ws;

            ws.onopen = () => {
                wsConnected = true;
                session.connected = true;
                this.updateStatusDot(true);

                // Propose initial terminal dimensions
                const cols = session.term.cols || 80;
                const rows = session.term.rows || 24;

                ws.send(JSON.stringify({
                    action: "spawn",
                    shell: options.shell || null,
                    command: options.command || null,
                    cwd: options.cwd || null,
                    cols,
                    rows
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === "spawned") {
                        session.ptyId = msg.pty_id;
                    } else if (msg.type === "init") {
                        session.ptyId = msg.pty_id;
                        if (msg.history) session.term.write(msg.history);
                    } else if (msg.type === "data") {
                        session.term.write(msg.data);
                    } else if (msg.type === "exit") {
                        session.term.write(`\r\n\x1b[33m[Process exited with code ${msg.exit_code}]\x1b[0m\r\n`);
                    } else if (msg.type === "error") {
                        session.term.write(`\r\n\x1b[31m[PTY Error: ${msg.error}]\x1b[0m\r\n`);
                        if (msg.error && (msg.error.includes("ENOENT") || msg.error.includes("ECONNREFUSED") || msg.error.includes("daemon"))) {
                            session.term.write(`\x1b[33m[PTY] Auto-reconnecting to task daemon...\x1b[0m\r\n`);
                            setTimeout(() => {
                                if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                                    session.ws.send(JSON.stringify({
                                        action: "spawn",
                                        shell: options.shell || "bash",
                                        cwd: options.cwd || "",
                                        cols: session.term?.cols || 80,
                                        rows: session.term?.rows || 24
                                    }));
                                }
                            }, 1000);
                        }
                    }
                } catch (_) {
                    session.term.write(event.data);
                }
            };

            ws.onerror = () => {
                if (!wsConnected) {
                    console.warn("[PTY] WebSocket connection failed, falling back to HTTP SSE...");
                    this.fallbackSSEStream(session, options);
                }
            };

            ws.onclose = () => {
                session.connected = false;
                this.updateStatusDot(false);
            };
        } catch (e) {
            this.fallbackSSEStream(session, options);
        }
    }

    async fallbackSSEStream(session, options = {}) {
        try {
            const cols = session.term?.cols || 80;
            const rows = session.term?.rows || 24;

            const res = await fetch("/api/pty/spawn", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shell: options.shell,
                    command: options.command,
                    cwd: options.cwd,
                    cols,
                    rows
                })
            });

            const data = await res.json();
            if (!data.pty_id) throw new Error(data.error || "Failed to spawn PTY");

            session.ptyId = data.pty_id;
            session.connected = true;
            this.updateStatusDot(true);

            // Connect SSE
            const eventSource = new EventSource(`/api/pty/stream/${encodeURIComponent(session.ptyId)}`);
            session.sseEventSource = eventSource;

            eventSource.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === "init" && msg.history) {
                        session.term.write(msg.history);
                    } else if (msg.type === "data") {
                        session.term.write(msg.data);
                    } else if (msg.type === "exit") {
                        session.term.write(`\r\n\x1b[33m[Process exited with code ${msg.exit_code}]\x1b[0m\r\n`);
                        eventSource.close();
                    }
                } catch (_) {}
            };

            eventSource.onerror = () => {
                session.connected = false;
                this.updateStatusDot(false);
            };
        } catch (err) {
            session.term?.write(`\r\n\x1b[31m[Failed to connect: ${err.message}]\x1b[0m\r\n`);
        }
    }

    sendInput(session, data) {
        if (!session) return;
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ action: "input", input: data }));
        } else if (session.ptyId) {
            fetch(`/api/pty/input/${encodeURIComponent(session.ptyId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input: data })
            }).catch(() => {});
        }
    }

    sendResize(session, cols, rows) {
        if (!session) return;
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ action: "resize", cols, rows }));
        } else if (session.ptyId) {
            fetch(`/api/pty/resize/${encodeURIComponent(session.ptyId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cols, rows })
            }).catch(() => {});
        }
    }

    renderTabs() {
        if (!this.tabsEl) return;
        this.tabsEl.innerHTML = "";

        for (const s of this.sessions) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `terminal-tab ${s.id === this.activeSessionId ? "active" : ""}`;
            tab.innerHTML = `
                <span>${s.name}</span>
                <span class="terminal-tab-close" title="Close Session">×</span>
            `;

            tab.addEventListener("click", (e) => {
                if (e.target.classList.contains("terminal-tab-close")) {
                    this.closeSession(s.id);
                } else {
                    this.switchSession(s.id);
                }
            });

            this.tabsEl.appendChild(tab);
        }
    }

    switchSession(sessionId) {
        this.activeSessionId = sessionId;
        for (const s of this.sessions) {
            const isActive = s.id === sessionId;
            if (s.mount) s.mount.style.display = isActive ? "block" : "none";
        }
        this.renderTabs();
        this.fitActiveTerminal();
        this.focusActiveTerminal();
    }

    closeSession(sessionId) {
        const idx = this.sessions.findIndex(s => s.id === sessionId);
        if (idx === -1) return;

        const session = this.sessions[idx];
        if (session.ws) {
            try { session.ws.close(); } catch (_) {}
        }
        if (session.sseEventSource) {
            try { session.sseEventSource.close(); } catch (_) {}
        }
        if (session.mount) {
            session.mount.remove();
        }

        this.sessions.splice(idx, 1);
        this.updatePersistenceIndicators();

        if (this.sessions.length > 0) {
            const nextActive = this.sessions[Math.max(0, idx - 1)];
            this.switchSession(nextActive.id);
        } else {
            this.close();
        }
    }

    updatePersistenceIndicators() {
        const count = this.sessions.length;
        const panelBtn = document.getElementById("panelTerminalBtn");
        if (panelBtn) {
            panelBtn.classList.toggle("has-active-session", count > 0);
        }

        const headerPill = document.getElementById("headerTerminalPill");
        if (headerPill) {
            if (count > 0 && !this.isOpen) {
                headerPill.style.display = "inline-flex";
                const labelSpan = headerPill.querySelector("span:not(.terminal-pulsing-dot)");
                if (labelSpan) {
                    labelSpan.textContent = count > 1 ? `Terminal (${count})` : "Terminal";
                }
            } else {
                headerPill.style.display = "none";
            }
        }
    }

    getActiveSession() {
        return this.sessions.find(s => s.id === this.activeSessionId) || null;
    }

    fitActiveTerminal() {
        const active = this.getActiveSession();
        if (active && active.fitAddon && active.term) {
            try {
                active.fitAddon.fit();
            } catch (_) {}
        }
    }

    focusActiveTerminal() {
        const active = this.getActiveSession();
        if (active && active.term) {
            active.term.focus();
        }
    }

    clearActiveTerminal() {
        const active = this.getActiveSession();
        if (active && active.term) {
            active.term.clear();
        }
    }

    updateStatusDot(connected) {
        const dot = this.drawerEl?.querySelector("#terminalStatusDot");
        if (dot) {
            dot.classList.toggle("disconnected", !connected);
            dot.title = connected ? "Terminal Connected" : "Terminal Disconnected";
        }
    }
}

// Global Singleton
export const terminalDrawer = new TerminalDrawerManager();
if (typeof window !== "undefined") {
    window.terminalDrawer = terminalDrawer;
    window.openTerminal = openTerminal;
    window.closeTerminal = closeTerminal;
    window.toggleTerminal = toggleTerminal;
}

export function initTerminalDrawer() {
    terminalDrawer.init();
}

export function openTerminal(options) {
    terminalDrawer.open(options);
}

export function closeTerminal() {
    terminalDrawer.close();
}

export function toggleTerminal() {
    terminalDrawer.toggle();
}
