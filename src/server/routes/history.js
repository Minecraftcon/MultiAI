/**
 * History & Unaccepted Changes API Routes
 * Backed by the Shadow Git Manager.
 */

const path = require("path");
const { sendJSON, getChatWorkspace } = require("../utils");
const shadowGit = require("../../core/shadow_git_manager");

function resolveWorkspacesForChat(chatId) {
    if (chatId) {
        return shadowGit.getWorkspacesForChat(chatId);
    }
    return [process.cwd()];
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
                workspaces,
                totalFiles: allFiles.length,
                totalAdditions,
                totalDeletions,
                files: allFiles
            });
        }

        // 2. POST /api/history/accept - mark all unaccepted changes accepted
        if (req.method === "POST" && reqPath === "/api/history/accept") {
            for (const ws of workspaces) {
                try {
                    shadowGit.acceptChanges(ws);
                } catch (_) {}
            }
            return sendJSON(res, 200, { status: "success", accepted: true });
        }

        // 3. POST /api/history/revert - revert single file or all files
        if (req.method === "POST" && reqPath === "/api/history/revert") {
            const targetRel = body.path || body.relativePath || "";
            const targetWs = body.workspace || null;
            const targetWorkspaces = targetWs ? [targetWs] : workspaces;

            if (targetRel) {
                for (const ws of targetWorkspaces) {
                    try {
                        shadowGit.revertFile(ws, targetRel);
                    } catch (_) {}
                }
                return sendJSON(res, 200, { status: "success", reverted: targetRel });
            } else {
                for (const ws of targetWorkspaces) {
                    try {
                        shadowGit.revertAll(ws);
                    } catch (_) {}
                }
                return sendJSON(res, 200, { status: "success", revertedAll: true });
            }
        }

        // 4. GET /api/history/diff - unified diff for unaccepted changes
        if (req.method === "GET" && reqPath === "/api/history/diff") {
            const targetRel = parsedUrl.searchParams.get("path") || "";
            const targetWs = parsedUrl.searchParams.get("workspace") || null;
            const targetWorkspaces = targetWs ? [targetWs] : workspaces;
            let diff = "";
            for (const ws of targetWorkspaces) {
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
