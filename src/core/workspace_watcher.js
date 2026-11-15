/**
 * MultiAI Workspace File Watcher & Change Event Server
 * Provides real-time filesystem change notifications for live file tree updates.
 */

const fs = require("fs");
const path = require("path");

class WorkspaceWatcher {
    constructor() {
        this.fsWatcher = null;
        this.watchedDir = null;
        this.currentVersion = Date.now();
        this.clients = new Set();
        this.debounceTimer = null;
        this.heartbeatTimer = null;
    }

    getWorkspaceRoot() {
        return path.resolve(process.env.MULTIAI_WORKSPACE_DIR || process.cwd());
    }

    getWorkspaceVersion() {
        return this.currentVersion;
    }

    isIgnored(filename) {
        if (!filename) return false;
        const norm = filename.replace(/\\/g, "/");
        const parts = norm.split("/");
        const ignoredDirs = new Set([
            "node_modules",
            ".git",
            ".MultiAI",
            ".gemini",
            ".cache",
            "__pycache__",
            ".pytest_cache",
            ".idea",
            ".vscode"
        ]);

        for (const p of parts) {
            if (ignoredDirs.has(p)) return true;
        }

        // Temporary or backup files
        if (norm.endsWith("~") || norm.endsWith(".swp") || norm.endsWith(".tmp") || norm.endsWith(".bak")) {
            return true;
        }

        return false;
    }

    init(targetDir = null) {
        const root = targetDir ? path.resolve(targetDir) : this.getWorkspaceRoot();
        if (this.fsWatcher && this.watchedDir === root) {
            return;
        }

        this.stop();
        this.watchedDir = root;

        if (!fs.existsSync(root)) {
            try {
                fs.mkdirSync(root, { recursive: true });
            } catch (_) {}
        }

        try {
            this.fsWatcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
                if (filename && this.isIgnored(filename)) {
                    return;
                }
                this.scheduleNotification(eventType, filename);
            });

            this.fsWatcher.on("error", (err) => {
                console.warn("[WorkspaceWatcher] Watcher warning:", err.message);
            });
        } catch (err) {
            console.warn("[WorkspaceWatcher] Could not start recursive fs.watch on", root, err.message);
        }

        // Setup SSE heartbeat to prevent reverse proxies / browser connection drops
        if (!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => {
                this.broadcastComment("keep-alive");
            }, 25000);
            if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
        }
    }

    scheduleNotification(eventType = "change", filename = "") {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.notifyChange(eventType, filename);
        }, 120);
    }

    notifyChange(eventType = "change", filename = "") {
        this.currentVersion = Date.now();
        const payload = JSON.stringify({
            type: "change",
            event: eventType,
            file: filename ? String(filename).replace(/\\/g, "/") : "",
            version: this.currentVersion
        });

        for (const client of this.clients) {
            try {
                client.write(`data: ${payload}\n\n`);
            } catch (_) {
                this.clients.delete(client);
            }
        }
    }

    broadcastComment(comment) {
        for (const client of this.clients) {
            try {
                client.write(`: ${comment}\n\n`);
            } catch (_) {
                this.clients.delete(client);
            }
        }
    }

    handleEventsSSE(req, res) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no"
        });

        res.write(`data: ${JSON.stringify({ type: "init", version: this.currentVersion, workspace: this.watchedDir })}\n\n`);
        this.clients.add(res);

        req.on("close", () => {
            this.clients.delete(res);
        });
    }

    stop() {
        if (this.fsWatcher) {
            try {
                this.fsWatcher.close();
            } catch (_) {}
            this.fsWatcher = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.watchedDir = null;
    }
}

const workspaceWatcher = new WorkspaceWatcher();

module.exports = {
    workspaceWatcher
};

