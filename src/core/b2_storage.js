/**
 * MultiAI Backblaze B2 Persistent Storage Adapter
 * ================================================
 * Provides persistent workspace snapshots and synchronization for MultiAI.
 * Uses native Node.js HTTPS with zero external dependencies.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const B2_REGISTRY_FILE = "projects/projects.json";
const LOCAL_REGISTRY_CACHE = "/tmp/b2_projects_cache.json";
const WORKSPACE_DIR = process.env.MULTIAI_WORKSPACE_DIR || "/tmp/workspace";

class B2Storage {
    constructor() {
        this.authData = null;
        this.authExpiresAt = 0;
        this.dirtyProjects = new Set();
        this.autoSyncTimer = null;
        this.isSyncing = false;
        this.activeProject = null;
    }

    getConfig() {
        let keyId = process.env.B2_KEY_ID;
        let appKey = process.env.B2_APPLICATION_KEY;
        let bucketId = process.env.B2_BUCKET_ID;
        let bucketName = process.env.B2_BUCKET_NAME;
        let endpoint = process.env.B2_ENDPOINT || "https://s3.us-west-004.backblazeb2.com";
        let region = process.env.B2_REGION || "us-west-004";

        // Fallback to reading .env file if not set in process.env
        if (!keyId || !appKey || !bucketId || !bucketName) {
            try {
                const envPath = path.resolve(__dirname, "../../.env");
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, "utf8");
                    for (const line of content.split("\n")) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                            const idx = trimmed.indexOf("=");
                            const k = trimmed.slice(0, idx).trim();
                            const v = trimmed.slice(idx + 1).trim();
                            if (k === "B2_KEY_ID" && !keyId) keyId = v;
                            if (k === "B2_APPLICATION_KEY" && !appKey) appKey = v;
                            if (k === "B2_BUCKET_ID" && !bucketId) bucketId = v;
                            if (k === "B2_BUCKET_NAME" && !bucketName) bucketName = v;
                            if (k === "B2_ENDPOINT" && !endpoint) endpoint = v;
                            if (k === "B2_REGION" && !region) region = v;
                        }
                    }
                }
            } catch (_) {}
        }

        return {
            keyId: (keyId || "").trim(),
            appKey: (appKey || "").trim(),
            bucketId: (bucketId || "").trim(),
            bucketName: (bucketName || "").trim(),
            endpoint: (endpoint || "").trim(),
            region: (region || "").trim(),
            isConfigured: Boolean(keyId && appKey && bucketId && bucketName)
        };
    }

    isConfigured() {
        return this.getConfig().isConfigured;
    }

    /**
     * Helper for making HTTPS requests to B2 API
     */
    request(url, options = {}, postData = null) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const req = https.request({
                hostname: u.hostname,
                port: u.port || 443,
                path: u.pathname + u.search,
                method: options.method || "GET",
                headers: options.headers || {},
                timeout: options.timeout || 60000
            }, (res) => {
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => {
                    const buffer = Buffer.concat(chunks);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        if (options.rawBuffer) {
                            return resolve(buffer);
                        }
                        try {
                            const json = JSON.parse(buffer.toString("utf8"));
                            resolve(json);
                        } catch (_) {
                            resolve(buffer);
                        }
                    } else {
                        const err = new Error(`B2 HTTP ${res.statusCode}: ${buffer.toString("utf8")}`);
                        err.statusCode = res.statusCode;
                        reject(err);
                    }
                });
            });

            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy(new Error(`B2 Request timed out for ${url}`));
            });

            if (postData) {
                if (Buffer.isBuffer(postData) || typeof postData === "string") {
                    req.write(postData);
                } else {
                    req.write(JSON.stringify(postData));
                }
            }
            req.end();
        });
    }

    /**
     * Authorize account and cache tokens for up to 20 hours
     */
    async authorize(force = false) {
        const config = this.getConfig();
        if (!config.isConfigured) {
            throw new Error("Backblaze B2 credentials not configured.");
        }

        const now = Date.now();
        if (!force && this.authData && this.authExpiresAt > now) {
            return this.authData;
        }

        const authStr = Buffer.from(`${config.keyId}:${config.appKey}`).toString("base64");
        const res = await this.request("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
            method: "GET",
            headers: {
                "Authorization": `Basic ${authStr}`
            }
        });

        this.authData = {
            apiUrl: res.apiUrl,
            authorizationToken: res.authorizationToken,
            downloadUrl: res.downloadUrl,
            recommendedPartSize: res.recommendedPartSize
        };
        // Token valid for 24h, expire our cache at 20h
        this.authExpiresAt = now + (20 * 60 * 60 * 1000);
        return this.authData;
    }

    /**
     * Upload a raw buffer to B2
     */
    async uploadFile(fileName, fileBuffer, contentType = "application/octet-stream") {
        const config = this.getConfig();
        const auth = await this.authorize();

        let uploadAuth;
        try {
            uploadAuth = await this.request(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
                method: "POST",
                headers: {
                    "Authorization": auth.authorizationToken,
                    "Content-Type": "application/json"
                }
            }, { bucketId: config.bucketId });
        } catch (err) {
            if (err.statusCode === 401) {
                // Reauthorize and retry
                const freshAuth = await this.authorize(true);
                uploadAuth = await this.request(`${freshAuth.apiUrl}/b2api/v2/b2_get_upload_url`, {
                    method: "POST",
                    headers: {
                        "Authorization": freshAuth.authorizationToken,
                        "Content-Type": "application/json"
                    }
                }, { bucketId: config.bucketId });
            } else {
                throw err;
            }
        }

        const sha1 = crypto.createHash("sha1").update(fileBuffer).digest("hex");
        const cleanName = fileName.replace(/^\/+/, "");

        const uploadRes = await this.request(uploadAuth.uploadUrl, {
            method: "POST",
            headers: {
                "Authorization": uploadAuth.authorizationToken,
                "X-Bz-File-Name": encodeURI(cleanName),
                "Content-Type": contentType,
                "Content-Length": fileBuffer.length,
                "X-Bz-Content-Sha1": sha1
            }
        }, fileBuffer);

        return uploadRes;
    }

    /**
     * Download a file buffer from B2
     */
    async downloadFile(fileName, rawBuffer = false) {
        const config = this.getConfig();
        const auth = await this.authorize();
        const cleanName = fileName.replace(/^\/+/, "");
        const downloadUrl = `${auth.downloadUrl}/file/${config.bucketName}/${encodeURI(cleanName)}`;

        try {
            const res = await this.request(downloadUrl, {
                headers: {
                    "Authorization": auth.authorizationToken
                },
                rawBuffer
            });
            return res;
        } catch (err) {
            if (err.statusCode === 401) {
                const freshAuth = await this.authorize(true);
                const retryUrl = `${freshAuth.downloadUrl}/file/${config.bucketName}/${encodeURI(cleanName)}`;
                return await this.request(retryUrl, {
                    headers: {
                        "Authorization": freshAuth.authorizationToken
                    },
                    rawBuffer
                });
            }
            throw err;
        }
    }

    /**
     * List files in B2 bucket by prefix
     */
    async listFiles(prefix = "") {
        const config = this.getConfig();
        const auth = await this.authorize();

        const res = await this.request(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
            method: "POST",
            headers: {
                "Authorization": auth.authorizationToken,
                "Content-Type": "application/json"
            }
        }, {
            bucketId: config.bucketId,
            prefix: prefix,
            maxFileCount: 1000
        });

        return res.files || [];
    }

    /**
     * Load project registry from B2 (with local cache fallback)
     */
    async loadProjectsRegistry() {
        if (!this.isConfigured()) {
            return this.loadLocalProjectsRegistry();
        }

        try {
            const data = await this.downloadFile(B2_REGISTRY_FILE);
            const parsed = (typeof data === "object" && !Buffer.isBuffer(data)) ? data : JSON.parse(data.toString("utf8"));
            const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
            this.saveLocalProjectsRegistry(projects);
            return projects;
        } catch (err) {
            // If file not found in B2 (404), return local registry or empty array
            if (err.statusCode === 404 || (err.message && err.message.includes("404"))) {
                return this.loadLocalProjectsRegistry();
            }
            console.warn("[B2] Warning loading projects registry:", err.message);
            return this.loadLocalProjectsRegistry();
        }
    }

    loadLocalProjectsRegistry() {
        try {
            if (fs.existsSync(LOCAL_REGISTRY_CACHE)) {
                const raw = fs.readFileSync(LOCAL_REGISTRY_CACHE, "utf8");
                const data = JSON.parse(raw);
                return Array.isArray(data.projects) ? data.projects : [];
            }
        } catch (_) {}
        return [];
    }

    listKnownProjects() {
        return this.loadLocalProjectsRegistry();
    }

    saveLocalProjectsRegistry(projects) {
        try {
            fs.writeFileSync(LOCAL_REGISTRY_CACHE, JSON.stringify({ projects, updatedAt: new Date().toISOString() }, null, 2), "utf8");
        } catch (_) {}
    }

    /**
     * Save updated project registry to B2 and local cache
     */
    async saveProjectsRegistry(projects) {
        this.saveLocalProjectsRegistry(projects);
        if (!this.isConfigured()) return;

        try {
            const payload = Buffer.from(JSON.stringify({ projects, updatedAt: new Date().toISOString() }, null, 2), "utf8");
            await this.uploadFile(B2_REGISTRY_FILE, payload, "application/json");
        } catch (err) {
            console.warn("[B2] Warning saving projects registry:", err.message);
        }
    }

    /**
     * List all workspaces categorized into:
     * - default (/tmp/workspace)
     * - persistent (synced with Backblaze B2)
     * - temporary (local un-synced folders)
     */
    async listWorkspaces(chatId = "") {
        const persistent = await this.loadProjectsRegistry();
        const persistentNames = new Set(persistent.map(p => p.name));

        // Scan local directories under WORKSPACE_DIR
        let localDirs = [];
        try {
            if (fs.existsSync(WORKSPACE_DIR)) {
                const entries = await fs.promises.readdir(WORKSPACE_DIR, { withFileTypes: true });
                localDirs = entries
                    .filter(d => d.isDirectory() && !d.name.startsWith("."))
                    .map(d => d.name);
            }
        } catch (_) {}

        // Temporary workspaces are local directories not registered as persistent
        const temporary = localDirs
            .filter(name => !persistentNames.has(name) && name !== "scratch")
            .map(name => ({
                name,
                path: path.join(WORKSPACE_DIR, name),
                type: "temporary"
            }));

        // Format persistent workspaces with their local paths and statuses
        const persistentWorkspaces = persistent.map(p => {
            const localPath = path.join(WORKSPACE_DIR, p.name);
            const isHydrated = fs.existsSync(localPath);
            return {
                name: p.name,
                path: localPath,
                type: "persistent",
                lastSyncedAt: p.lastSyncedAt || p.createdAt || null,
                isHydrated,
                isDirty: this.dirtyProjects.has(p.name)
            };
        });

        return {
            default: WORKSPACE_DIR,
            persistent: persistentWorkspaces,
            temporary
        };
    }

    /**
     * Create a compressed tarball snapshot of a directory
     */
    createTarSnapshot(sourceDir, tarPath) {
        return new Promise((resolve, reject) => {
            const excludes = [
                "--exclude=node_modules",
                "--exclude=.cache",
                "--exclude=__pycache__",
                "--exclude=*.pyc",
                "--exclude=.venv",
                "--exclude=venv",
                "--exclude=env",
                "--exclude=dist",
                "--exclude=build",
                "--exclude=.next",
                "--exclude=.turbo",
                "--exclude=.nuxt"
            ];

            const args = ["-czf", tarPath, ...excludes, "-C", sourceDir, "."];
            execFile("tar", args, { timeout: 120000 }, (error, stdout, stderr) => {
                if (error) {
                    error.stderr = stderr;
                    return reject(error);
                }
                resolve(tarPath);
            });
        });
    }

    /**
     * Extract a compressed tarball snapshot into target directory
     */
    extractTarSnapshot(tarPath, targetDir) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            const args = ["-xzf", tarPath, "-C", targetDir];
            execFile("tar", args, { timeout: 120000 }, (error, stdout, stderr) => {
                if (error) {
                    error.stderr = stderr;
                    return reject(error);
                }
                resolve(targetDir);
            });
        });
    }

    /**
     * Synchronize a persistent project directory to Backblaze B2
     */
    async syncProject(projectName) {
        if (!projectName || !this.isConfigured()) return { success: false, reason: "B2 not configured" };

        const localPath = path.join(WORKSPACE_DIR, projectName);
        if (!fs.existsSync(localPath)) {
            return { success: false, reason: "Local directory does not exist" };
        }

        const tempTarPath = `/tmp/mai_snapshot_${projectName}_${Date.now()}.tar.gz`;
        try {
            await this.createTarSnapshot(localPath, tempTarPath);
            const tarBuffer = await fs.promises.readFile(tempTarPath);

            const b2FilePath = `projects/${projectName}/snapshot.tar.gz`;
            await this.uploadFile(b2FilePath, tarBuffer, "application/gzip");

            // Update registry
            const projects = await this.loadProjectsRegistry();
            const now = new Date().toISOString();
            const idx = projects.findIndex(p => p.name === projectName);
            if (idx !== -1) {
                projects[idx].lastSyncedAt = now;
                projects[idx].sizeBytes = tarBuffer.length;
            } else {
                projects.push({
                    name: projectName,
                    type: "persistent",
                    createdAt: now,
                    lastSyncedAt: now,
                    sizeBytes: tarBuffer.length
                });
            }
            await this.saveProjectsRegistry(projects);

            this.dirtyProjects.delete(projectName);
            console.log(`[B2] Synced project "${projectName}" to Backblaze B2 (${(tarBuffer.length / 1024).toFixed(1)} KB)`);

            return { success: true, projectName, syncedAt: now, sizeBytes: tarBuffer.length };
        } catch (err) {
            console.error(`[B2] Sync error for "${projectName}":`, err.message);
            return { success: false, error: err.message };
        } finally {
            try {
                if (fs.existsSync(tempTarPath)) await fs.promises.unlink(tempTarPath);
            } catch (_) {}
        }
    }

    /**
     * Download and hydrate a persistent project from B2 if not present locally
     */
    async hydrateProject(projectName) {
        if (!projectName) return false;
        const targetDir = path.join(WORKSPACE_DIR, projectName);

        // If directory exists and has files, already hydrated
        if (fs.existsSync(targetDir)) {
            try {
                const files = await fs.promises.readdir(targetDir);
                if (files.length > 0) return true;
            } catch (_) {}
        }

        if (!this.isConfigured()) return false;

        const tempTarPath = `/tmp/mai_download_${projectName}_${Date.now()}.tar.gz`;
        try {
            console.log(`[B2] Hydrating persistent project "${projectName}" from Backblaze B2...`);
            const b2FilePath = `projects/${projectName}/snapshot.tar.gz`;
            const fileBuf = await this.downloadFile(b2FilePath, true);
            await fs.promises.writeFile(tempTarPath, fileBuf);

            await this.extractTarSnapshot(tempTarPath, targetDir);
            console.log(`[B2] Successfully hydrated project "${projectName}" to ${targetDir}`);
            return true;
        } catch (err) {
            console.warn(`[B2] Hydration warning for "${projectName}":`, err.message);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            return false;
        } finally {
            try {
                if (fs.existsSync(tempTarPath)) await fs.promises.unlink(tempTarPath);
            } catch (_) {}
        }
    }

    /**
     * Create a new project (persistent or temporary, empty or cloned from git)
     */
    async createProject({ name, type = "persistent", source = "empty", gitUrl = "", gitBranch = "", cloneAll = false }) {
        if (!name || typeof name !== "string") {
            throw new Error("Project name is required.");
        }

        const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
        if (!sanitizedName) {
            throw new Error("Invalid project name format.");
        }

        const projectDir = path.join(WORKSPACE_DIR, sanitizedName);
        if (!fs.existsSync(WORKSPACE_DIR)) {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
        }

        // Clean directory if already exists
        if (fs.existsSync(projectDir)) {
            try {
                fs.rmSync(projectDir, { recursive: true, force: true });
            } catch (_) {}
        }
        fs.mkdirSync(projectDir, { recursive: true });

        // If source is git clone
        if (source === "git" && gitUrl) {
            const args = ["clone"];
            if (gitBranch && gitBranch !== "all" && !cloneAll) {
                args.push("--branch", gitBranch, "--single-branch");
            }
            args.push("--", gitUrl, projectDir);

            await new Promise((resolve, reject) => {
                execFile("git", args, { timeout: 120000 }, (error, stdout, stderr) => {
                    if (error) {
                        error.stderr = stderr;
                        return reject(new Error(`Git clone failed: ${error.message} (${stderr})`));
                    }
                    resolve(stdout);
                });
            });
        } else {
            // Empty project: create initial README.md
            const initialReadme = `# ${sanitizedName}\n\nProject initialized in MultiAI Cloud Workspace.\n`;
            await fs.promises.writeFile(path.join(projectDir, "README.md"), initialReadme, "utf8");
        }

        const now = new Date().toISOString();
        const isPersistent = type === "persistent";

        if (isPersistent) {
            const projects = await this.loadProjectsRegistry();
            const existingIdx = projects.findIndex(p => p.name === sanitizedName);
            if (existingIdx !== -1) {
                projects[existingIdx] = {
                    name: sanitizedName,
                    type: "persistent",
                    createdAt: projects[existingIdx].createdAt || now,
                    lastSyncedAt: now
                };
            } else {
                projects.push({
                    name: sanitizedName,
                    type: "persistent",
                    createdAt: now,
                    lastSyncedAt: now
                });
            }
            await this.saveProjectsRegistry(projects);

            // Trigger initial sync to B2
            await this.syncProject(sanitizedName);
        }

        this.setActiveProject(sanitizedName);
        return {
            success: true,
            name: sanitizedName,
            path: projectDir,
            type: isPersistent ? "persistent" : "temporary",
            source
        };
    }

    markProjectDirty(projectName) {
        if (!projectName || projectName === "workspace") return;
        this.dirtyProjects.add(projectName);
    }

    setActiveProject(projectName) {
        this.activeProject = projectName;
    }

    getActiveProject() {
        return this.activeProject;
    }

    /**
     * Start background auto-sync worker running every 60 seconds
     */
    startAutoSyncWorker() {
        if (this.autoSyncTimer) return;

        console.log("[B2] Starting persistent workspace auto-sync worker (interval: 60s)...");
        this.autoSyncTimer = setInterval(async () => {
            if (this.isSyncing) return;
            if (this.dirtyProjects.size === 0) return;

            this.isSyncing = true;
            try {
                const projectsToSync = Array.from(this.dirtyProjects);
                for (const proj of projectsToSync) {
                    await this.syncProject(proj);
                }
            } catch (err) {
                console.warn("[B2] Auto-sync periodic cycle warning:", err.message);
            } finally {
                this.isSyncing = false;
            }
        }, 60000);

        if (this.autoSyncTimer.unref) {
            this.autoSyncTimer.unref();
        }
    }

    stopAutoSyncWorker() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
    }
}

const b2Storage = new B2Storage();

module.exports = {
    B2Storage,
    b2Storage
};
