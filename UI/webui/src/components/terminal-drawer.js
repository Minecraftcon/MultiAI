/**
 * MultiAI Real Pseudo-Terminal (PTY) Drawer Component
 * ====================================================
 * Provides full interactive PTY terminal emulation using xterm.js
 * over real-time WebSocket with HTTP SSE fallback.
 */

class TerminalDrawerManager {
    constructor() {
        this.isOpen = false;
        this.isFullscreen = false;
        this.drawerEl = null;
        this.tabsEl = null;
        this.bodyEl = null;
        this.sessions = [];
        this.activeSessionId = null;
        this.sessionCounter = 0;
        this.height = 340;
    }

    init() {
        if (this.drawerEl) return;
        this.renderDrawerDOM();
        this.bindGlobalEvents();
    }

    renderDrawerDOM() {
        const drawer = document.createElement("div");
        drawer.id = "terminalDrawer";
        drawer.className = "terminal-drawer";
        drawer.innerHTML = `
            <div class="terminal-resizer" id="terminalResizer" title="Drag to resize terminal"></div>
            <div class="terminal-header">
                <div class="terminal-header-left">
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

        // Event listeners
        drawer.querySelector("#terminalCloseBtn").addEventListener("click", () => this.close());
        drawer.querySelector("#terminalExpandBtn").addEventListener("click", () => this.toggleFullscreen());
        drawer.querySelector("#terminalClearBtn").addEventListener("click", () => this.clearActiveTerminal());
        drawer.querySelector("#terminalNewTabBtn").addEventListener("click", () => this.createSession());

        this.initResizer(drawer.querySelector("#terminalResizer"));
    }

    initResizer(resizerEl) {
        let isResizing = false;
        let startY = 0;
        let startH = 0;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const dy = startY - e.clientY;
            const newH = Math.max(160, Math.min(window.innerHeight * 0.9, startH + dy));
            this.height = newH;
            this.drawerEl.style.height = `${newH}px`;
            this.fitActiveTerminal();
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            resizerEl.classList.remove("resizing");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this.fitActiveTerminal();
        };

        resizerEl.addEventListener("mousedown", (e) => {
            isResizing = true;
            startY = e.clientY;
            startH = this.drawerEl.getBoundingClientRect().height;
            resizerEl.classList.add("resizing");
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
                this.fitActiveTerminal();
            }
        });
    }

    open(options = {}) {
        if (!this.drawerEl) this.init();
        this.isOpen = true;
        this.drawerEl.classList.add("open");

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
        if (!this.isFullscreen) {
            this.drawerEl.style.height = `${this.height}px`;
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

        if (this.sessions.length > 0) {
            const nextActive = this.sessions[Math.max(0, idx - 1)];
            this.switchSession(nextActive.id);
        } else {
            this.close();
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

