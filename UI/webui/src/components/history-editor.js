/* =========================================================
   CONVERSATION HISTORY EDITOR COMPONENT
   Full visual & raw JSON history editor with snapshots, undo/redo,
   message removal, filtering, and Ace Editor integration.
   ========================================================= */

import { state } from "../state/index.js";
import { renderIcons } from "../utils/icons.js";
import { saveStoredChats, saveBuildChatToDisk } from "../services/storage.js";
import { renderChatList } from "./chat-history-list.js";
import { renderSessionMessages } from "./chat-ui.js";
import { bindInteractiveCodeBlocks } from "./renderer.js";
import { showToast } from "./bottom-sheet.js";

// Modal and Editor Singletons
let _modalBackdrop = null;
let _aceEditor = null;
let _activeChatId = null;
let _currentSession = null;
let _currentMessages = [];
let _undoStack = [];
let _redoStack = [];
let _activeTab = "visual"; // "visual" | "json"
let _snapshotsOpen = false;
let _activeRoleFilter = "all";
let _searchQuery = "";
let _isSaving = false;
let _hasJsonSyntaxError = false;

/* ── Snapshots Storage (Micro-backups) ──────────────────── */

function getSnapshotKey(chatId) {
    return `multiai_history_snapshots_${chatId}`;
}

function loadSnapshots(chatId) {
    try {
        const raw = localStorage.getItem(getSnapshotKey(chatId));
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

function persistSnapshots(chatId, snapshots) {
    try {
        localStorage.setItem(getSnapshotKey(chatId), JSON.stringify(snapshots.slice(-30))); // Keep last 30 snapshots
    } catch (_) {}
}

function takeSnapshot(chatId, name = null) {
    const list = loadSnapshots(chatId);
    const snap = {
        id: "snap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        name: name || `Snapshot ${list.length + 1}`,
        timestamp: Date.now(),
        messageCount: _currentMessages.length,
        messages: JSON.parse(JSON.stringify(_currentMessages))
    };
    list.unshift(snap);
    persistSnapshots(chatId, list);
    renderSnapshotsDrawer();
    updateSnapshotCountBadge();
    return snap;
}

function deleteSnapshot(chatId, snapId) {
    let list = loadSnapshots(chatId);
    list = list.filter(s => s.id !== snapId);
    persistSnapshots(chatId, list);
    renderSnapshotsDrawer();
    updateSnapshotCountBadge();
}

function restoreSnapshot(snap) {
    if (!snap || !Array.isArray(snap.messages)) return;
    pushUndoState();
    _currentMessages = JSON.parse(JSON.stringify(snap.messages));
    _redoStack = [];
    syncViews();
    showToast(`Restored snapshot: ${snap.name}`);
}

/* ── Undo / Redo Management ─────────────────────────────── */

function pushUndoState() {
    // Keep max 50 undo states to preserve memory
    if (_undoStack.length >= 50) {
        _undoStack.shift();
    }
    _undoStack.push(JSON.parse(JSON.stringify(_currentMessages)));
    _redoStack = [];
    updateUndoRedoControls();
}

function undo() {
    if (_undoStack.length === 0) return;
    _redoStack.push(JSON.parse(JSON.stringify(_currentMessages)));
    _currentMessages = _undoStack.pop();
    updateUndoRedoControls();
    syncViews();
    showToast("Undo");
}

function redo() {
    if (_redoStack.length === 0) return;
    _undoStack.push(JSON.parse(JSON.stringify(_currentMessages)));
    _currentMessages = _redoStack.pop();
    updateUndoRedoControls();
    syncViews();
    showToast("Redo");
}

function updateUndoRedoControls() {
    const undoBtn = document.getElementById("heUndoBtn");
    const redoBtn = document.getElementById("heRedoBtn");
    if (undoBtn) undoBtn.disabled = _undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _redoStack.length === 0;
    updateMessageCountBadge();
}

/* ── View Synchronization (Visual vs Ace) ───────────────── */

function syncViews() {
    if (_activeTab === "visual") {
        renderVisualTimeline();
    } else if (_activeTab === "json" && _aceEditor) {
        const jsonStr = JSON.stringify(_currentMessages, null, 2);
        _aceEditor.setValue(jsonStr, -1);
        validateAceJson();
    }
    updateMessageCountBadge();
}

function switchTab(newTab) {
    if (newTab === _activeTab) return;

    if (newTab === "visual") {
        // Leaving JSON tab: validate and commit edits to _currentMessages
        if (_aceEditor) {
            const raw = _aceEditor.getValue();
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    showToast("Root JSON must be an array of messages.");
                    return;
                }
                const oldStr = JSON.stringify(_currentMessages);
                if (oldStr !== JSON.stringify(parsed)) {
                    pushUndoState();
                    _currentMessages = parsed;
                }
            } catch (err) {
                showToast(`Cannot switch: JSON syntax error: ${err.message}`);
                return;
            }
        }
    } else if (newTab === "json") {
        // Entering JSON tab: update ace editor text from _currentMessages
        ensureAceEditor();
        if (_aceEditor) {
            _aceEditor.setValue(JSON.stringify(_currentMessages, null, 2), -1);
            validateAceJson();
        }
    }

    _activeTab = newTab;

    const visualBtn = document.getElementById("heTabVisualBtn");
    const jsonBtn = document.getElementById("heTabJsonBtn");
    const visualView = document.getElementById("heVisualView");
    const jsonView = document.getElementById("heJsonView");

    if (visualBtn) visualBtn.classList.toggle("active", newTab === "visual");
    if (jsonBtn) jsonBtn.classList.toggle("active", newTab === "json");
    if (visualView) visualView.style.display = newTab === "visual" ? "flex" : "none";
    if (jsonView) jsonView.style.display = newTab === "json" ? "flex" : "none";

    if (newTab === "visual") {
        renderVisualTimeline();
    } else if (_aceEditor) {
        setTimeout(() => _aceEditor.resize(), 50);
    }
}

/* ── Ace Editor Integration ─────────────────────────────── */

function ensureAceEditor() {
    const mount = document.getElementById("heAceEditorMount");
    if (!mount) return;

    if (_aceEditor) {
        return _aceEditor;
    }

    if (typeof window.ace === "undefined") {
        mount.innerHTML = '<div class="he-empty-state">Ace Editor could not be loaded.</div>';
        return null;
    }

    try {
        window.ace.config.set("basePath", "/vendor/ace");
        _aceEditor = window.ace.edit(mount);

        const curTheme = document.documentElement.getAttribute("data-theme") || "dark";
        const isLight = curTheme === "light" || (curTheme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
        _aceEditor.setTheme(isLight ? "ace/theme/tomorrow" : "ace/theme/tomorrow_night");
        _aceEditor.session.setMode("ace/mode/json");

        _aceEditor.setOptions({
            fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
            fontSize: "13px",
            tabSize: 2,
            useSoftTabs: true,
            showPrintMargin: false,
            wrap: true,
            highlightActiveLine: true,
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: false
        });

        _aceEditor.on("change", () => {
            validateAceJson();
        });

        // Add Ctrl+S / Cmd+S save command inside Ace
        _aceEditor.commands.addCommand({
            name: "saveHistory",
            bindKey: { win: "Ctrl-S", mac: "Command-S" },
            exec: () => {
                saveHistory();
            }
        });

        return _aceEditor;
    } catch (err) {
        console.error("[HistoryEditor] Failed initializing Ace editor:", err);
        return null;
    }
}

function validateAceJson() {
    if (!_aceEditor) return true;
    const errorBanner = document.getElementById("heErrorBanner");
    const saveBtn = document.getElementById("heSaveBtn");
    const raw = _aceEditor.getValue();

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error("Top-level JSON must be an array of messages.");
        }
        _hasJsonSyntaxError = false;
        if (errorBanner) errorBanner.style.display = "none";
        if (saveBtn) saveBtn.disabled = false;
        return true;
    } catch (err) {
        _hasJsonSyntaxError = true;
        if (errorBanner) {
            errorBanner.style.display = "flex";
            errorBanner.textContent = `Syntax Error: ${err.message}`;
        }
        if (saveBtn) saveBtn.disabled = true;
        return false;
    }
}

function formatAceJson() {
    if (!_aceEditor) return;
    try {
        const raw = _aceEditor.getValue();
        const parsed = JSON.parse(raw);
        _aceEditor.setValue(JSON.stringify(parsed, null, 2), -1);
        validateAceJson();
        showToast("JSON formatted");
    } catch (err) {
        showToast(`Cannot format invalid JSON: ${err.message}`);
    }
}

/* ── Visual Timeline Rendering ──────────────────────────── */

function renderVisualTimeline() {
    const listEl = document.getElementById("heMessageList");
    if (!listEl) return;

    listEl.innerHTML = "";

    // Calculate role counts
    let userCount = 0;
    let asstCount = 0;
    let toolCount = 0;
    let sysCount = 0;

    _currentMessages.forEach(m => {
        const r = (m.role || "").toLowerCase();
        if (r === "user") userCount++;
        else if (r === "assistant") asstCount++;
        else if (r === "tool") toolCount++;
        else if (r === "system") sysCount++;
    });

    updateFilterPillCounts(userCount, asstCount, toolCount, sysCount);

    const q = _searchQuery.trim().toLowerCase();
    const filteredEntries = [];

    _currentMessages.forEach((msg, idx) => {
        const role = (msg.role || "").toLowerCase();
        if (_activeRoleFilter !== "all" && role !== _activeRoleFilter) {
            return;
        }

        if (q) {
            const contentStr = typeof msg.content === "string" 
                ? msg.content 
                : JSON.stringify(msg.content || "");
            const toolStr = msg.tool_calls ? JSON.stringify(msg.tool_calls) : "";
            if (!contentStr.toLowerCase().includes(q) && !toolStr.toLowerCase().includes(q) && !role.includes(q)) {
                return;
            }
        }

        filteredEntries.push({ msg, originalIndex: idx });
    });

    if (filteredEntries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "he-empty-state";
        empty.innerHTML = `
            <i data-lucide="search" style="width: 24px; height: 24px; opacity: 0.5;"></i>
            <span>${_currentMessages.length === 0 ? "No messages in conversation history." : "No messages match your search or filter."}</span>
        `;
        listEl.appendChild(empty);
        renderIcons(empty);
        return;
    }

    filteredEntries.forEach(({ msg, originalIndex }) => {
        const card = createMessageCard(msg, originalIndex);
        listEl.appendChild(card);
    });

    renderIcons(listEl);
}

function createMessageCard(msg, index) {
    const card = document.createElement("div");
    card.className = "he-msg-card";
    card.dataset.index = index;

    const role = (msg.role || "user").toLowerCase();
    const roleBadgeClass = `role-${role}`;

    // Header
    const header = document.createElement("div");
    header.className = "he-msg-header";

    const left = document.createElement("div");
    left.className = "he-msg-header-left";

    const indexSpan = document.createElement("span");
    indexSpan.className = "he-msg-index";
    indexSpan.textContent = `#${index + 1}`;

    const roleBadge = document.createElement("span");
    roleBadge.className = `he-role-badge ${roleBadgeClass}`;
    roleBadge.textContent = role;

    const roleSelect = document.createElement("select");
    roleSelect.className = "he-role-select";
    roleSelect.setAttribute("aria-label", "Change message role");
    ["user", "assistant", "system", "tool"].forEach(r => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (r === role) opt.selected = true;
        roleSelect.appendChild(opt);
    });

    roleSelect.addEventListener("change", (e) => {
        const newRole = e.target.value;
        pushUndoState();
        _currentMessages[index].role = newRole;
        renderVisualTimeline();
    });

    left.appendChild(indexSpan);
    left.appendChild(roleBadge);
    left.appendChild(roleSelect);

    // Actions on right (Move up, Move down, Remove)
    const actions = document.createElement("div");
    actions.className = "he-msg-actions";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "he-msg-action-btn";
    moveUpBtn.title = "Move Up";
    moveUpBtn.disabled = index === 0;
    moveUpBtn.innerHTML = '<i data-lucide="arrow-up" style="width: 13px; height: 13px;"></i>';
    moveUpBtn.addEventListener("click", () => {
        if (index > 0) {
            pushUndoState();
            const temp = _currentMessages[index];
            _currentMessages[index] = _currentMessages[index - 1];
            _currentMessages[index - 1] = temp;
            renderVisualTimeline();
        }
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "he-msg-action-btn";
    moveDownBtn.title = "Move Down";
    moveDownBtn.disabled = index === _currentMessages.length - 1;
    moveDownBtn.innerHTML = '<i data-lucide="arrow-down" style="width: 13px; height: 13px;"></i>';
    moveDownBtn.addEventListener("click", () => {
        if (index < _currentMessages.length - 1) {
            pushUndoState();
            const temp = _currentMessages[index];
            _currentMessages[index] = _currentMessages[index + 1];
            _currentMessages[index + 1] = temp;
            renderVisualTimeline();
        }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "he-msg-action-btn danger";
    deleteBtn.title = "Remove Message";
    deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>';
    deleteBtn.addEventListener("click", () => {
        pushUndoState();
        _currentMessages.splice(index, 1);
        renderVisualTimeline();
        showToast("Message removed");
    });

    actions.appendChild(moveUpBtn);
    actions.appendChild(moveDownBtn);
    actions.appendChild(deleteBtn);

    header.appendChild(left);
    header.appendChild(actions);
    card.appendChild(header);

    // Body: Content textarea
    const contentVal = typeof msg.content === "string" 
        ? msg.content 
        : JSON.stringify(msg.content ?? "", null, 2);

    const textarea = document.createElement("textarea");
    textarea.className = "he-msg-textarea";
    textarea.value = contentVal;
    textarea.placeholder = "Message content…";
    textarea.spellcheck = false;

    // Auto-expand textarea to fit content up to max-height
    const autoResize = () => {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(260, Math.max(54, textarea.scrollHeight + 2)) + "px";
    };
    setTimeout(autoResize, 0);

    let originalVal = contentVal;
    textarea.addEventListener("input", autoResize);
    textarea.addEventListener("blur", () => {
        if (textarea.value !== originalVal) {
            pushUndoState();
            // Try parsing if original was object/array, else treat as string
            if (typeof msg.content === "object" && msg.content !== null) {
                try {
                    _currentMessages[index].content = JSON.parse(textarea.value);
                } catch (_) {
                    _currentMessages[index].content = textarea.value;
                }
            } else {
                _currentMessages[index].content = textarea.value;
            }
            originalVal = textarea.value;
            updateMessageCountBadge();
        }
    });

    card.appendChild(textarea);

    // Collapsible tool calls details if present
    if (msg.tool_calls || msg.function_call || msg.tool_call_id) {
        const details = document.createElement("details");
        details.className = "he-tool-details";
        const summary = document.createElement("summary");
        summary.className = "he-tool-summary-toggle";
        const toolLabel = msg.tool_call_id 
            ? `Tool Output (ID: ${msg.tool_call_id})` 
            : `Tool Calls (${(msg.tool_calls || []).length})`;
        summary.textContent = toolLabel;
        details.appendChild(summary);

        const toolJsonArea = document.createElement("textarea");
        toolJsonArea.className = "he-msg-textarea";
        toolJsonArea.style.marginTop = "6px";
        toolJsonArea.style.fontSize = "11.5px";
        const toolPayload = msg.tool_calls || msg.function_call || { tool_call_id: msg.tool_call_id, name: msg.name };
        toolJsonArea.value = JSON.stringify(toolPayload, null, 2);
        toolJsonArea.addEventListener("blur", () => {
            try {
                const parsed = JSON.parse(toolJsonArea.value);
                pushUndoState();
                if (msg.tool_calls) _currentMessages[index].tool_calls = parsed;
                else if (msg.function_call) _currentMessages[index].function_call = parsed;
                showToast("Tool details updated");
            } catch (err) {
                showToast(`Invalid tool JSON: ${err.message}`);
            }
        });

        details.appendChild(toolJsonArea);
        card.appendChild(details);
    }

    return card;
}

function updateFilterPillCounts(u, a, t, s) {
    const total = _currentMessages.length;
    const elAll = document.getElementById("hePillAllCount");
    const elUser = document.getElementById("hePillUserCount");
    const elAsst = document.getElementById("hePillAsstCount");
    const elTool = document.getElementById("hePillToolCount");
    const elSys = document.getElementById("hePillSysCount");

    if (elAll) elAll.textContent = `(${total})`;
    if (elUser) elUser.textContent = `(${u})`;
    if (elAsst) elAsst.textContent = `(${a})`;
    if (elTool) elTool.textContent = `(${t})`;
    if (elSys) elSys.textContent = `(${s})`;
}

function updateMessageCountBadge() {
    const badge = document.getElementById("heMsgCountBadge");
    if (badge) {
        badge.textContent = `${_currentMessages.length} turns`;
    }
}

function updateSnapshotCountBadge() {
    const badge = document.getElementById("heSnapshotCountBadge");
    if (badge && _activeChatId) {
        const snaps = loadSnapshots(_activeChatId);
        badge.textContent = snaps.length;
    }
}

/* ── Snapshots Drawer UI ─────────────────────────────────── */

function renderSnapshotsDrawer() {
    const listEl = document.getElementById("heSnapshotsList");
    if (!listEl || !_activeChatId) return;

    listEl.innerHTML = "";
    const snapshots = loadSnapshots(_activeChatId);

    if (snapshots.length === 0) {
        listEl.innerHTML = '<span style="font-size: 11px; color: var(--text-tertiary); padding: 4px 0;">No snapshots recorded yet.</span>';
        return;
    }

    snapshots.forEach(snap => {
        const card = document.createElement("div");
        card.className = "he-snapshot-card";

        const top = document.createElement("div");
        top.className = "he-snapshot-card-top";

        const nameSpan = document.createElement("span");
        nameSpan.className = "he-snapshot-name";
        nameSpan.textContent = snap.name;
        nameSpan.title = snap.name;

        top.appendChild(nameSpan);

        const meta = document.createElement("div");
        meta.className = "he-snapshot-meta";
        const timeStr = new Date(snap.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        meta.innerHTML = `<span>${timeStr}</span><span>${snap.messageCount} turns</span>`;

        const actions = document.createElement("div");
        actions.className = "he-snapshot-actions";

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "he-snapshot-restore-btn";
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", () => restoreSnapshot(snap));

        const delBtn = document.createElement("button");
        delBtn.className = "he-snapshot-delete-btn";
        delBtn.title = "Delete snapshot";
        delBtn.innerHTML = '<i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>';
        delBtn.addEventListener("click", () => deleteSnapshot(_activeChatId, snap.id));

        actions.appendChild(restoreBtn);
        actions.appendChild(delBtn);

        card.appendChild(top);
        card.appendChild(meta);
        card.appendChild(actions);

        listEl.appendChild(card);
    });

    renderIcons(listEl);
}

function toggleSnapshotsDrawer() {
    _snapshotsOpen = !_snapshotsOpen;
    const drawer = document.getElementById("heSnapshotsDrawer");
    const toggleBtn = document.getElementById("heSnapshotsToggleBtn");

    if (drawer) {
        drawer.style.display = _snapshotsOpen ? "flex" : "none";
        if (_snapshotsOpen) renderSnapshotsDrawer();
    }
    if (toggleBtn) {
        toggleBtn.classList.toggle("active", _snapshotsOpen);
    }
}

/* ── Save Action ─────────────────────────────────────────── */

async function saveHistory() {
    if (_isSaving) return;

    // If currently in JSON mode, commit and validate
    if (_activeTab === "json" && _aceEditor) {
        const raw = _aceEditor.getValue();
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                showToast("Cannot save: Root JSON must be an array of messages.");
                return;
            }
            _currentMessages = parsed;
        } catch (err) {
            showToast(`Cannot save: JSON syntax error: ${err.message}`);
            return;
        }
    }

    _isSaving = true;
    const saveBtn = document.getElementById("heSaveBtn");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader" class="spin"></i><span>Saving…</span>';
        renderIcons(saveBtn);
    }

    try {
        // Silent micro-backup before saving (User Rule 3)
        takeSnapshot(_activeChatId, "Auto-backup (Pre-save)");

        const title = _currentSession?.title || "Conversation";
        const payload = {
            id: _activeChatId,
            title,
            messages: _currentMessages,
            forceOverwrite: true,
            updatedAt: Date.now()
        };

        const res = await fetch("/api/chats/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        // Update in-memory session
        if (!state.chatSessions[_activeChatId]) {
            state.chatSessions[_activeChatId] = { id: _activeChatId };
        }
        state.chatSessions[_activeChatId].messages = _currentMessages;
        state.chatSessions[_activeChatId].messageCount = _currentMessages.length;
        state.chatSessions[_activeChatId].updatedAt = Date.now();

        // If it's a build project chat, also update build project persistence
        if (_currentSession?.projectId) {
            saveBuildChatToDisk(_currentSession.projectId, state.chatSessions[_activeChatId]);
        } else {
            saveStoredChats(true);
        }

        // If this is the active chat currently displayed on screen, re-render it
        if (_activeChatId === state.currentChatId) {
            state.messages = _currentMessages;
            const chatEl = document.getElementById("chat");
            if (chatEl) {
                renderSessionMessages(state.chatSessions[_activeChatId], chatEl);
                bindInteractiveCodeBlocks(chatEl);
                renderIcons(chatEl);
            }
        }

        // Re-render sidebar chat list to update counts/titles
        renderChatList();

        showToast("Conversation history saved successfully");
        closeHistoryEditor();
    } catch (err) {
        console.error("[HistoryEditor] Failed to save conversation history:", err);
        showToast(`Failed to save: ${err.message}`);
    } finally {
        _isSaving = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="check"></i><span>Save Changes</span>';
            renderIcons(saveBtn);
        }
    }
}

/* ── Modal Creation & Event Wiring ───────────────────────── */

function buildModalDOM() {
    if (_modalBackdrop) return _modalBackdrop;

    const backdrop = document.createElement("div");
    backdrop.id = "historyEditorBackdrop";
    backdrop.className = "he-backdrop";
    backdrop.style.display = "none";

    backdrop.innerHTML = `
        <div class="he-modal" role="dialog" aria-modal="true" aria-labelledby="heModalTitle">
            <!-- Header -->
            <div class="he-header">
                <div class="he-header-left">
                    <div class="he-title-group">
                        <i data-lucide="history" style="width: 16px; height: 16px; color: var(--text-secondary);"></i>
                        <h2 id="heModalTitle" class="he-title">Edit History</h2>
                        <span id="heChatTitleBadge" class="he-chat-badge"></span>
                        <span id="heMsgCountBadge" class="he-count-badge">0 turns</span>
                    </div>
                </div>

                <!-- Tabs: Visual vs JSON -->
                <div class="he-tabs" role="tablist">
                    <button type="button" class="he-tab-btn active" id="heTabVisualBtn" role="tab" aria-selected="true">
                        <i data-lucide="list" style="width: 13px; height: 13px;"></i>
                        <span>Visual Timeline</span>
                    </button>
                    <button type="button" class="he-tab-btn" id="heTabJsonBtn" role="tab" aria-selected="false">
                        <i data-lucide="code" style="width: 13px; height: 13px;"></i>
                        <span>Raw JSON (Ace)</span>
                    </button>
                </div>

                <!-- Controls & Actions -->
                <div class="he-header-right">
                    <button type="button" class="he-icon-btn" id="heUndoBtn" title="Undo (Ctrl+Z)" disabled aria-label="Undo">
                        <i data-lucide="undo-2" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button type="button" class="he-icon-btn" id="heRedoBtn" title="Redo (Ctrl+Y)" disabled aria-label="Redo">
                        <i data-lucide="redo-2" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button type="button" class="he-action-btn" id="heSnapshotsToggleBtn">
                        <i data-lucide="camera" style="width: 13px; height: 13px;"></i>
                        <span>Snapshots</span>
                        <span class="he-count-badge" id="heSnapshotCountBadge">0</span>
                    </button>
                    <button type="button" class="he-save-btn" id="heSaveBtn">
                        <i data-lucide="check" style="width: 13px; height: 13px;"></i>
                        <span>Save Changes</span>
                    </button>
                    <button type="button" class="he-close-btn" id="heCloseBtn" aria-label="Close editor">
                        <i data-lucide="x" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            </div>

            <!-- Snapshots Drawer (Collapsible) -->
            <div id="heSnapshotsDrawer" class="he-snapshots-drawer" style="display: none;">
                <div class="he-snapshots-header">
                    <span class="he-snapshots-title">Conversation Snapshots</span>
                    <button type="button" class="he-action-btn" id="heTakeSnapshotBtn">
                        <i data-lucide="plus" style="width: 12px; height: 12px;"></i>
                        <span>Take Snapshot</span>
                    </button>
                </div>
                <div id="heSnapshotsList" class="he-snapshots-list"></div>
            </div>

            <!-- Body Area -->
            <div class="he-body">
                <!-- Visual View -->
                <div id="heVisualView" class="he-visual-view">
                    <div class="he-visual-toolbar">
                        <div class="he-filter-pills" id="heFilterPills">
                            <button type="button" class="he-filter-pill active" data-filter="all">
                                All <span id="hePillAllCount"></span>
                            </button>
                            <button type="button" class="he-filter-pill" data-filter="user">
                                User <span id="hePillUserCount"></span>
                            </button>
                            <button type="button" class="he-filter-pill" data-filter="assistant">
                                Assistant <span id="hePillAsstCount"></span>
                            </button>
                            <button type="button" class="he-filter-pill" data-filter="tool">
                                Tool <span id="hePillToolCount"></span>
                            </button>
                            <button type="button" class="he-filter-pill" data-filter="system">
                                System <span id="hePillSysCount"></span>
                            </button>
                        </div>
                        <div class="he-visual-toolbar-right">
                            <input type="text" id="heSearchInput" class="he-search-input" placeholder="Search turns…" aria-label="Search turns" />
                            <button type="button" class="he-add-msg-btn" id="heAddMsgBtn">
                                <i data-lucide="plus" style="width: 13px; height: 13px;"></i>
                                <span>Add Turn</span>
                            </button>
                        </div>
                    </div>
                    <div id="heMessageList" class="he-message-list"></div>
                </div>

                <!-- JSON View (Ace) -->
                <div id="heJsonView" class="he-json-view" style="display: none;">
                    <div class="he-json-toolbar">
                        <span>Edit conversation turns directly as a JSON array</span>
                        <div class="he-json-toolbar-right">
                            <button type="button" class="he-format-btn" id="heFormatJsonBtn">Prettify JSON</button>
                        </div>
                    </div>
                    <div id="heAceEditorMount" class="he-ace-mount"></div>
                    <div id="heErrorBanner" class="he-error-banner" style="display: none;"></div>
                </div>
            </div>

            <!-- Footer Shortcuts Hint -->
            <div class="he-footer-info">
                <div class="he-shortcuts-hint">
                    <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> Undo</span>
                    <span><kbd>Ctrl</kbd>+<kbd>Y</kbd> Redo</span>
                    <span><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
                    <span><kbd>Esc</kbd> Close</span>
                </div>
                <span>MultiAI History Editor</span>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);
    _modalBackdrop = backdrop;

    bindModalEvents();
    renderIcons(backdrop);
    return backdrop;
}

function bindModalEvents() {
    if (!_modalBackdrop) return;

    // Backdrop click dismiss
    _modalBackdrop.addEventListener("click", (e) => {
        if (e.target === _modalBackdrop) {
            closeHistoryEditor();
        }
    });

    // Close button
    const closeBtn = document.getElementById("heCloseBtn");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => closeHistoryEditor());
    }

    // Tab buttons
    const visualBtn = document.getElementById("heTabVisualBtn");
    const jsonBtn = document.getElementById("heTabJsonBtn");
    if (visualBtn) visualBtn.addEventListener("click", () => switchTab("visual"));
    if (jsonBtn) jsonBtn.addEventListener("click", () => switchTab("json"));

    // Undo / Redo
    const undoBtn = document.getElementById("heUndoBtn");
    const redoBtn = document.getElementById("heRedoBtn");
    if (undoBtn) undoBtn.addEventListener("click", () => undo());
    if (redoBtn) redoBtn.addEventListener("click", () => redo());

    // Snapshots drawer toggle & creation
    const snapToggle = document.getElementById("heSnapshotsToggleBtn");
    if (snapToggle) snapToggle.addEventListener("click", () => toggleSnapshotsDrawer());

    const takeSnapBtn = document.getElementById("heTakeSnapshotBtn");
    if (takeSnapBtn) {
        takeSnapBtn.addEventListener("click", () => {
            const name = window.prompt("Snapshot name:", `Snapshot ${loadSnapshots(_activeChatId).length + 1}`);
            if (name !== null) {
                takeSnapshot(_activeChatId, name.trim() || undefined);
                showToast("Snapshot created");
            }
        });
    }

    // Save button
    const saveBtn = document.getElementById("heSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", () => saveHistory());

    // Format JSON button
    const formatBtn = document.getElementById("heFormatJsonBtn");
    if (formatBtn) formatBtn.addEventListener("click", () => formatAceJson());

    // Role filters
    const filterPills = document.querySelectorAll(".he-filter-pill");
    filterPills.forEach(pill => {
        pill.addEventListener("click", () => {
            filterPills.forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            _activeRoleFilter = pill.dataset.filter || "all";
            renderVisualTimeline();
        });
    });

    // Search input
    const searchInput = document.getElementById("heSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            _searchQuery = e.target.value;
            renderVisualTimeline();
        });
    }

    // Add Turn button
    const addMsgBtn = document.getElementById("heAddMsgBtn");
    if (addMsgBtn) {
        addMsgBtn.addEventListener("click", () => {
            pushUndoState();
            _currentMessages.push({
                role: "user",
                content: ""
            });
            renderVisualTimeline();
            // Scroll to bottom of message list
            const listEl = document.getElementById("heMessageList");
            if (listEl) {
                setTimeout(() => {
                    listEl.scrollTop = listEl.scrollHeight;
                    const lastTextarea = listEl.querySelector(".he-msg-card:last-child .he-msg-textarea");
                    if (lastTextarea) lastTextarea.focus();
                }, 50);
            }
        });
    }

    // Global Keydown Handler for shortcuts inside History Editor
    window.addEventListener("keydown", handleKeydown, true);
}

function handleKeydown(e) {
    if (!_modalBackdrop || _modalBackdrop.style.display === "none") return;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeHistoryEditor();
        return;
    }

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (isCtrlOrMeta) {
        // Save: Ctrl+S
        if (e.key.toLowerCase() === "s") {
            e.preventDefault();
            e.stopPropagation();
            saveHistory();
            return;
        }

        // Redo: Ctrl+Y or Ctrl+Shift+Z
        if (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z")) {
            // If active in Ace Editor, let Ace handle its internal undo/redo or sync
            if (document.activeElement?.closest("#heAceEditorMount")) return;
            e.preventDefault();
            e.stopPropagation();
            redo();
            return;
        }

        // Undo: Ctrl+Z (without shift)
        if (e.key.toLowerCase() === "z" && !e.shiftKey) {
            if (document.activeElement?.closest("#heAceEditorMount")) return;
            e.preventDefault();
            e.stopPropagation();
            undo();
            return;
        }
    }
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Opens the History Editor modal for the specified chatId.
 */
export async function openHistoryEditor(chatId) {
    if (!chatId) return;

    _activeChatId = chatId;
    _currentSession = state.chatSessions[chatId] || { id: chatId, title: "Conversation" };

    // Fetch full messages from server to guarantee we have all disk turns
    try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
        if (res.ok) {
            const data = await res.json();
            const sessionData = data.session || data;
            if (sessionData && Array.isArray(sessionData.messages)) {
                _currentSession.messages = sessionData.messages;
                if (sessionData.title) _currentSession.title = sessionData.title;
            }
        }
    } catch (_) {}

    _currentMessages = JSON.parse(JSON.stringify(_currentSession.messages || []));
    _undoStack = [];
    _redoStack = [];
    _activeTab = "visual";
    _snapshotsOpen = false;
    _activeRoleFilter = "all";
    _searchQuery = "";
    _hasJsonSyntaxError = false;

    // Silent micro-backup snapshot on open (User Rule 3)
    const existingSnaps = loadSnapshots(chatId);
    if (existingSnaps.length === 0 || existingSnaps[0].messageCount !== _currentMessages.length) {
        takeSnapshot(chatId, "Auto-backup (Pre-edit)");
    }

    const backdrop = buildModalDOM();
    backdrop.style.display = "flex";

    // Update title badges
    const titleBadge = document.getElementById("heChatTitleBadge");
    if (titleBadge) {
        titleBadge.textContent = _currentSession.title || chatId;
        titleBadge.title = `${_currentSession.title || "Chat"} (${chatId})`;
    }

    const drawer = document.getElementById("heSnapshotsDrawer");
    if (drawer) drawer.style.display = "none";
    const snapToggle = document.getElementById("heSnapshotsToggleBtn");
    if (snapToggle) snapToggle.classList.remove("active");

    updateUndoRedoControls();
    updateSnapshotCountBadge();

    // Reset tab to Visual
    switchTab("visual");
    renderVisualTimeline();
    renderIcons(backdrop);
}

/**
 * Closes the History Editor modal.
 */
export function closeHistoryEditor() {
    if (_modalBackdrop) {
        _modalBackdrop.style.display = "none";
    }
    _activeChatId = null;
    _currentSession = null;
    _currentMessages = [];
    _undoStack = [];
    _redoStack = [];
}

/**
 * Initialize history editor listeners on startup.
 */
export function initHistoryEditor() {
    // Expose openHistoryEditor on window for convenience and debugging
    window.openHistoryEditor = openHistoryEditor;
}
