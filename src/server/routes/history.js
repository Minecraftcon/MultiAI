/**
 * History & Unaccepted Changes API Routes
 * Backed by the Shadow Git Manager.
 */

const fs = require("fs");
const path = require("path");
const { sendJSON, getChatWorkspace } = require("../utils");
const shadowGit = require("../../core/shadow_git_manager");
const { workspaceWatcher } = require("../../core/workspace_watcher");

function getActiveWorkspaceRoot(chatId = null) {
    if (chatId) {
        try {
            const wsContext = getChatWorkspace(chatId);
            if (wsContext && wsContext.project && wsContext.project.rootPath) {
                return path.resolve(wsContext.project.rootPath);
            }
        } catch (_) {}
    }
    const envWs = process.env.MULTIAI_WORKSPACE_DIR;
    if (envWs) {
        return path.resolve(envWs);
    }
    return path.resolve(process.cwd());
}

function resolveWorkspacesForChat(chatId) {
    const activeRoot = getActiveWorkspaceRoot(chatId);
    return [activeRoot];
}

async function handleHistoryRoute(req, res) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const reqPath = parsedUrl.pathname;
    const queryChatId = parsedUrl.searchParams.get("chatId") || "";

    try {
        let body = {};
        if (req.method === "POST") {
            let rawBody = "";
            for await (const chunk of req) rawBody += chunk;
            try {
                body = JSON.parse(rawBody || "{}");
            } catch (_) {
                body = {};
            }
        }

        const chatId = req.headers["x-chat-id"] || body.chatId || queryChatId;
        const workspaces = resolveWorkspacesForChat(chatId);
        const queryWs = parsedUrl.searchParams.get("workspace") || body.workspace || "";
        if (queryWs && fs.existsSync(queryWs)) {
            const resolvedQueryWs = path.resolve(queryWs);
            if (!workspaces.includes(resolvedQueryWs)) {
                workspaces.unshift(resolvedQueryWs);
            }
        }

        // 1. GET /api/history/changes - current unaccepted changes
        if (req.method === "GET" && reqPath === "/api/history/changes") {
            const allFiles = [];
            let totalAdditions = 0;
            let totalDeletions = 0;

            for (const ws of workspaces) {
                const changes = shadowGit.getUnacceptedChanges(ws);
                for (const f of changes.files) {
                    allFiles.push({
                        ...f,
                        workspace: ws,
                        displayPath: workspaces.length > 1 ? `${path.basename(ws)}/${f.path}` : f.path
                    });
                    totalAdditions += f.additions;
                    totalDeletions += f.deletions;
                }
            }

            return sendJSON(res, 200, {
                status: "success",
                version: workspaceWatcher.getWorkspaceVersion(),
                workspaces,
                totalFiles: allFiles.length,
                totalAdditions,
                totalDeletions,
                files: allFiles
            });
        }

        // 2. POST /api/history/accept - mark unaccepted changes accepted (all or single file)
        if (req.method === "POST" && reqPath === "/api/history/accept") {
            const rawTarget = body.path || body.file || body.relativePath || "";
            let targetRel = rawTarget;
            const activeWs = workspaces[0];

            if (targetRel && activeWs) {
                if (path.isAbsolute(targetRel)) {
                    const rel = path.relative(activeWs, targetRel);
                    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
                        targetRel = rel;
                    }
                }
            }

            for (const ws of workspaces) {
                try {
                    if (targetRel) {
                        shadowGit.acceptFile(ws, targetRel);
                    } else {
                        shadowGit.acceptChanges(ws);
                    }
                } catch (_) {}
            }
            return sendJSON(res, 200, { status: "success", accepted: true, path: targetRel || null });
        }

        // 3. POST /api/history/revert - revert single file or all files
        if (req.method === "POST" && reqPath === "/api/history/revert") {
            const rawTarget = body.path || body.file || body.relativePath || "";
            let targetRel = rawTarget;
            const activeWs = workspaces[0];

            if (targetRel && activeWs) {
                if (path.isAbsolute(targetRel)) {
                    const rel = path.relative(activeWs, targetRel);
                    if (rel.startsWith("..") || path.isAbsolute(rel)) {
                        return sendJSON(res, 200, { status: "ignored_outside_workspace", reverted: null });
                    }
                    targetRel = rel;
                } else if (targetRel.startsWith("..")) {
                    return sendJSON(res, 200, { status: "ignored_outside_workspace", reverted: null });
                }
            }

            if (targetRel) {
                for (const ws of workspaces) {
                    try {
                        shadowGit.revertFile(ws, targetRel);
                    } catch (_) {}
                }
                return sendJSON(res, 200, { status: "success", reverted: targetRel });
            } else {
                for (const ws of workspaces) {
                    try {
                        shadowGit.revertAll(ws);
                    } catch (_) {}
                }
                return sendJSON(res, 200, { status: "success", revertedAll: true });
            }
        }

        // 4. GET /api/history/diff - unified diff for unaccepted changes
        if (req.method === "GET" && reqPath === "/api/history/diff") {
            const rawTarget = parsedUrl.searchParams.get("path") || "";
            let targetRel = rawTarget;
            const activeWs = workspaces[0];

            if (targetRel && activeWs) {
                if (path.isAbsolute(targetRel)) {
                    const rel = path.relative(activeWs, targetRel);
                    if (rel.startsWith("..") || path.isAbsolute(rel)) {
                        return sendJSON(res, 200, { status: "success", path: rawTarget, diff: "" });
                    }
                    targetRel = rel;
                } else if (targetRel.startsWith("..")) {
                    return sendJSON(res, 200, { status: "success", path: rawTarget, diff: "" });
                }
            }

            let diff = "";
            for (const ws of workspaces) {
                try {
                    const d = shadowGit.getUnifiedDiff(ws, targetRel);
                    if (d) { diff = d; break; }
                } catch (_) {}
            }
            return sendJSON(res, 200, {
                status: "success",
                path: targetRel || null,
                diff
            });
        }

        // 5. GET /api/history/timeline - full chronological modification timeline
        if (req.method === "GET" && reqPath === "/api/history/timeline") {
            const targetRel = parsedUrl.searchParams.get("path") || null;
            const allTimeline = [];
            for (const ws of workspaces) {
                try {
                    const timeline = shadowGit.getFileHistoryTimeline(ws, targetRel);
                    allTimeline.push(...timeline);
                } catch (_) {}
            }
            return sendJSON(res, 200, {
                status: "success",
                workspaces,
                timeline: allTimeline
            });
        }

        res.writeHead(404);
        res.end();
    } catch (err) {
        console.error("[HistoryRoute] Error:", err.message);
        return sendJSON(res, 500, { error: err.message });
    }
}

module.exports = {
    handleHistoryRoute,
    resolveWorkspacesForChat
};
