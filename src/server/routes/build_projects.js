// Build Projects and Directory Validation Route Handlers
const fs = require("fs");
const path = require("path");
const os = require("os");
const conversationsManager = require("../../core/conversations_manager");
const { sendJSON } = require("../utils");

async function parseBodyJSON(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    return body ? JSON.parse(body) : {};
}

/**
 * Handles /api/fs/validate-dir
 * Provides directory suggestions or validates whether a path is an existing directory.
 */
async function handleValidateDirRoute(req, res) {
    if (req.method !== "GET") {
        return sendJSON(res, 405, { error: "Method not allowed" });
    }

    try {
        const parsedUrl = new URL(req.url, "http://localhost");
        const queryPath = parsedUrl.searchParams.get("path");

        if (!queryPath) {
            const home = os.homedir();
            const candidatePaths = [
                path.join(home, "Documents"),
                path.join(home, "Projects"),
                path.join(home, "Documents", "Web-projects"),
                path.join(home, "Desktop"),
                path.join(home, "Downloads"),
                home
            ];

            // Include any already-registered build projects
            try {
                const existing = conversationsManager.listProjects();
                for (const p of existing) {
                    if (p.rootPath && fs.existsSync(p.rootPath)) {
                        candidatePaths.unshift(p.rootPath);
                    }
                }
            } catch (_) {}

            const seen = new Set();
            const suggestions = [];

            for (const cand of candidatePaths) {
                if (!cand || seen.has(cand)) continue;
                seen.add(cand);
                try {
                    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
                        suggestions.push({
                            path: cand,
                            name: path.basename(cand) || cand
                        });
                    }
                } catch (_) {}
            }

            return sendJSON(res, 200, { success: true, suggestions });
        }

        const trimmed = queryPath.trim();
        const resolved = conversationsManager.resolveHome(trimmed);

        if (!fs.existsSync(resolved)) {
            return sendJSON(res, 200, {
                valid: false,
                error: `Directory does not exist: ${trimmed}`
            });
        }

        const stat = await fs.promises.stat(resolved);
        if (!stat.isDirectory()) {
            return sendJSON(res, 200, {
                valid: false,
                error: `Path is a file, not a directory: ${trimmed}`
            });
        }

        return sendJSON(res, 200, {
            valid: true,
            resolvedPath: resolved,
            normalizedPath: resolved,
            basename: path.basename(resolved) || "Project",
            name: path.basename(resolved) || "Project"
        });
    } catch (err) {
        return sendJSON(res, 500, { valid: false, error: err.message });
    }
}

/**
 * Handles /api/build/projects and nested chat routes
 */
async function handleBuildProjectsRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    try {
        // 1. GET /api/build/projects - list all projects
        if (req.method === "GET" && reqUrl === "/api/build/projects") {
            const projects = conversationsManager.listProjects();
            return sendJSON(res, 200, { success: true, projects });
        }

        // 2. POST /api/build/projects - register a new project directory
        if (req.method === "POST" && reqUrl === "/api/build/projects") {
            const body = await parseBodyJSON(req);
            const folderPath = body.path || body.folderPath;
            const customName = body.name || body.customName || "";

            if (!folderPath) {
                return sendJSON(res, 400, { error: "Parameter 'path' is required to register a project." });
            }

            const project = conversationsManager.addProject(folderPath, customName);
            return sendJSON(res, 200, { success: true, project });
        }

        // Match /api/build/projects/:projectId/...
        const matchProject = reqUrl.match(/^\/api\/build\/projects\/([^/]+)(.*)$/);
        if (matchProject) {
            const projectId = decodeURIComponent(matchProject[1]);
            const subPath = matchProject[2] || "";

            // 3. DELETE /api/build/projects/:projectId - remove project
            if (req.method === "DELETE" && !subPath) {
                const deleted = conversationsManager.removeProject(projectId);
                return sendJSON(res, 200, { success: true, deleted });
            }

            // 4. POST /api/build/projects/:projectId/chats/session - initialize chat workspace
            if (req.method === "POST" && subPath === "/chats/session") {
                const body = await parseBodyJSON(req);
                const chatId = body.chatId;
                if (!chatId) {
                    return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
                }
                const workspace = conversationsManager.ensureProjectChatWorkspace(projectId, chatId);
                return sendJSON(res, 200, { success: true, workspace });
            }

            // 5. POST /api/build/projects/:projectId/chats/save - save chat session
            if (req.method === "POST" && subPath === "/chats/save") {
                const chatSession = await parseBodyJSON(req);
                if (!chatSession || !chatSession.id) {
                    return sendJSON(res, 400, { error: "Valid chat session with 'id' is required." });
                }
                const workspace = conversationsManager.saveProjectChat(projectId, chatSession);
                return sendJSON(res, 200, { success: true, workspace });
            }

            // Match /api/build/projects/:projectId/chats/:chatId
            const matchChat = subPath.match(/^\/chats\/([^/]+)$/);
            if (matchChat) {
                const chatId = decodeURIComponent(matchChat[1]);

                // 6. GET /api/build/projects/:projectId/chats/:chatId - get project chat
                if (req.method === "GET") {
                    const data = conversationsManager.getProjectChat(projectId, chatId);
                    if (!data) {
                        return sendJSON(res, 404, { error: `Project chat '${chatId}' not found.` });
                    }
                    return sendJSON(res, 200, { success: true, ...data });
                }

                // 7. DELETE /api/build/projects/:projectId/chats/:chatId - delete project chat
                if (req.method === "DELETE") {
                    const deleted = conversationsManager.deleteProjectChat(projectId, chatId);
                    return sendJSON(res, 200, { success: true, deleted });
                }
            }
        }

        res.writeHead(404);
        res.end("Not found");
    } catch (err) {
        console.error("[BUILD_PROJECTS ROUTE ERROR]", req.method, req.url, err);
        return sendJSON(res, 500, { error: err.message });
    }
}

module.exports = {
    handleValidateDirRoute,
    handleBuildProjectsRoute
};
