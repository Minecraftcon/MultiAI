/**
 * MultiAI Cloud Git & File Upload Handler
 * =======================================
 * Endpoints for:
 * - Direct file upload to /tmp/user/files
 * - Listing uploaded files in /tmp/user/files
 * - Git repository branch inspection and clone operations
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { sendJSON } = require("../utils");

const UPLOAD_DIR = "/tmp/user/files";
const WORKSPACE_DIR = "/tmp/workspace";

// In-memory or file-backed active workdir for chats
let activeWorkdirs = {};
const WORKDIRS_FILE = "/tmp/multiai_active_workdirs.json";

function loadActiveWorkdirs() {
    try {
        if (fs.existsSync(WORKDIRS_FILE)) {
            activeWorkdirs = JSON.parse(fs.readFileSync(WORKDIRS_FILE, "utf8"));
        }
    } catch (_) {}
}

function saveActiveWorkdirs() {
    try {
        fs.writeFileSync(WORKDIRS_FILE, JSON.stringify(activeWorkdirs, null, 2), "utf8");
    } catch (_) {}
}

loadActiveWorkdirs();

function getChatWorkdir(chatId) {
    if (!chatId) return WORKSPACE_DIR;
    return activeWorkdirs[chatId] || WORKSPACE_DIR;
}

function setChatWorkdir(chatId, workdir) {
    if (!chatId) return;
    activeWorkdirs[chatId] = workdir;
    saveActiveWorkdirs();
}

function ensureDirs() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    if (!fs.existsSync(WORKSPACE_DIR)) {
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }
}

/**
 * Lists all available workspaces: Default (/tmp/workspace) plus any cloned repos under /tmp/workspace/
 */
async function handleListWorkspaces(req, res) {
    ensureDirs();
    try {
        const entries = await fs.promises.readdir(WORKSPACE_DIR, { withFileTypes: true });
        const repos = entries
            .filter(d => d.isDirectory() && !d.name.startsWith("."))
            .map(d => ({
                name: d.name,
                path: path.join(WORKSPACE_DIR, d.name)
            }));

        const chatId = req.headers["x-chat-id"] || "";
        const current = getChatWorkdir(chatId);

        return sendJSON(res, 200, {
            success: true,
            default: WORKSPACE_DIR,
            current,
            repos
        });
    } catch (e) {
        return sendJSON(res, 500, { error: e.message });
    }
}

/**
 * Sets active working directory for a chat session
 */
async function handleSelectWorkspace(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const chatId = data.chatId || req.headers["x-chat-id"] || "global";
        const selectedPath = data.path || WORKSPACE_DIR;

        if (!fs.existsSync(selectedPath)) {
            fs.mkdirSync(selectedPath, { recursive: true });
        }

        setChatWorkdir(chatId, selectedPath);
        return sendJSON(res, 200, { success: true, chatId, workdir: selectedPath });
    } catch (e) {
        return sendJSON(res, 500, { error: e.message });
    }
}

/**
 * Handle multipart/form-data or binary file uploads directly to /tmp/user/files
 */
async function handleFileUpload(req, res) {
    ensureUploadDir();
    const contentType = req.headers["content-type"] || "";

    // 1. If JSON base64 upload: { filename, contentBase64 }
    if (contentType.includes("application/json")) {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const filename = path.basename(data.filename || `upload-${Date.now()}.bin`);
            const targetPath = path.join(UPLOAD_DIR, filename);

            const buffer = Buffer.from(data.contentBase64 || data.content || "", data.contentBase64 ? "base64" : "utf8");
            await fs.promises.writeFile(targetPath, buffer);

            return sendJSON(res, 200, {
                success: true,
                filename,
                path: targetPath,
                size: buffer.length
            });
        } catch (e) {
            return sendJSON(res, 500, { error: e.message });
        }
    }

    // 2. Raw binary upload with X-Filename header
    const rawFilename = req.headers["x-filename"];
    if (rawFilename) {
        try {
            const filename = path.basename(decodeURIComponent(rawFilename));
            const targetPath = path.join(UPLOAD_DIR, filename);
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            await fs.promises.writeFile(targetPath, buffer);

            return sendJSON(res, 200, {
                success: true,
                filename,
                path: targetPath,
                size: buffer.length
            });
        } catch (e) {
            return sendJSON(res, 500, { error: e.message });
        }
    }

    // 3. Simple boundary parser for multipart/form-data
    if (contentType.includes("multipart/form-data")) {
        try {
            const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
            const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
            if (!boundary) {
                return sendJSON(res, 400, { error: "Missing multipart boundary" });
            }

            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const fullBuffer = Buffer.concat(chunks);

            const boundaryBuf = Buffer.from(`--${boundary}`);
            let start = fullBuffer.indexOf(boundaryBuf);
            let uploaded = [];

            while (start !== -1) {
                const next = fullBuffer.indexOf(boundaryBuf, start + boundaryBuf.length);
                if (next === -1) break;

                const part = fullBuffer.slice(start + boundaryBuf.length, next);
                const headerEnd = part.indexOf("\r\n\r\n");
                if (headerEnd !== -1) {
                    const headerStr = part.slice(0, headerEnd).toString("utf-8");
                    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
                    if (filenameMatch) {
                        const filename = path.basename(filenameMatch[1]);
                        const targetPath = path.join(UPLOAD_DIR, filename);
                        // File payload starts after \r\n\r\n and ends before trailing \r\n
                        const filePayload = part.slice(headerEnd + 4, part.length - 2);
                        await fs.promises.writeFile(targetPath, filePayload);
                        uploaded.push({ filename, path: targetPath, size: filePayload.length });
                    }
                }
                start = next;
            }

            return sendJSON(res, 200, { success: true, files: uploaded });
        } catch (e) {
            return sendJSON(res, 500, { error: e.message });
        }
    }

    return sendJSON(res, 400, { error: "Unsupported upload format. Use application/json or provide X-Filename." });
}

/**
 * List files in /tmp/user/files
 */
async function handleListUploadedFiles(req, res) {
    ensureUploadDir();
    try {
        const files = await fs.promises.readdir(UPLOAD_DIR);
        const fileDetails = await Promise.all(files.map(async (name) => {
            const p = path.join(UPLOAD_DIR, name);
            const stat = await fs.promises.stat(p);
            return {
                name,
                path: p,
                size: stat.size,
                updatedAt: stat.mtime
            };
        }));
        return sendJSON(res, 200, { success: true, files: fileDetails });
    } catch (e) {
        return sendJSON(res, 500, { error: e.message });
    }
}

/**
 * Inspect branches of a remote git repository without cloning full repo
 */
async function handleGitInspectRepo(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const url = (data.url || "").trim();
        if (!url) {
            return sendJSON(res, 400, { error: "Git repository URL is required." });
        }

        // Run git ls-remote to list branches
        let out = "";
        try {
            out = execSync(`git ls-remote --heads "${url}"`, { encoding: "utf8", timeout: 15000 });
        } catch (err) {
            return sendJSON(res, 400, { error: `Could not reach git repository: ${err.message}` });
        }

        const branches = [];
        for (const line of out.split("\n")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const ref = parts[1];
                if (ref.startsWith("refs/heads/")) {
                    branches.push(ref.replace("refs/heads/", ""));
                }
            }
        }

        return sendJSON(res, 200, {
            success: true,
            url,
            branches: branches.length > 0 ? branches : ["main", "master"]
        });
    } catch (e) {
        return sendJSON(res, 500, { error: e.message });
    }
}

/**
 * Clone a git repository into /tmp/workspace or specific target
 */
async function handleGitClone(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const url = (data.url || "").trim();
        const branch = (data.branch || "").trim();
        const cloneAll = Boolean(data.cloneAll);

        if (!url) {
            return sendJSON(res, 400, { error: "Git repository URL is required." });
        }

        // Default workspace location
        const targetDir = data.targetDir || path.join("/tmp", "workspace", path.basename(url, ".git"));
        if (!fs.existsSync(path.dirname(targetDir))) {
            fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        }

        // If directory already exists, clear or handle it
        if (fs.existsSync(targetDir)) {
            try {
                fs.rmSync(targetDir, { recursive: true, force: true });
            } catch (_) {}
        }

        let cmd = ["git", "clone"];
        if (branch && branch !== "all" && !cloneAll) {
            cmd.push("--branch", branch, "--single-branch");
        }
        cmd.push(url, targetDir);

        const out = execSync(cmd.join(" "), { encoding: "utf8", timeout: 45000 });

        return sendJSON(res, 200, {
            success: true,
            url,
            branch: branch || "default",
            targetDir,
            output: out
        });
    } catch (e) {
        return sendJSON(res, 500, { error: `Clone failed: ${e.message}` });
    }
}

async function handleCloudToolsRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    if (req.method === "POST" && reqUrl === "/api/cloud/upload") {
        return handleFileUpload(req, res);
    }
    if (req.method === "GET" && reqUrl === "/api/cloud/uploads") {
        return handleListUploadedFiles(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/cloud/git/inspect") {
        return handleGitInspectRepo(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/cloud/git/clone") {
        return handleGitClone(req, res);
    }
    if (req.method === "GET" && reqUrl === "/api/cloud/workspaces") {
        return handleListWorkspaces(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/cloud/workspaces/select") {
        return handleSelectWorkspace(req, res);
    }

    sendJSON(res, 404, { error: "Cloud tools endpoint not found" });
}

module.exports = {
    handleCloudToolsRoute,
    getChatWorkdir,
    setChatWorkdir,
    UPLOAD_DIR,
    WORKSPACE_DIR
};

