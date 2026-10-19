/**
 * MultiAI Snapshot Manager (Claude Code Model)
 *
 * Lightweight, in-process file tracing and checkpoint engine.
 * Replaces heavy external Git subprocesses with fast, pure-JS session snapshots.
 * - Zero Git binary / PATH dependency
 * - Zero subprocess spawns (instant execution in <1ms)
 * - Zero .git/index.lock conflicts or safe.directory permission issues
 * - 100% byte-fidelity file revert and in-memory unified diffs
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { getUserHome } = require("./config_manager");

/**
 * Automatically identifies the project root for an arbitrary target path
 * by walking upwards looking for typical project indicators (.git, package.json, pyproject.toml, etc.).
 */
function findWorkspaceRoot(targetPath) {
    let dir = path.dirname(path.resolve(targetPath));
    const root = path.parse(dir).root;

    let curr = dir;
    let foundRoot = null;
    while (curr && curr !== root) {
        if (
            fs.existsSync(path.join(curr, ".git")) ||
            fs.existsSync(path.join(curr, "package.json")) ||
            fs.existsSync(path.join(curr, "pyproject.toml")) ||
            fs.existsSync(path.join(curr, "Cargo.toml")) ||
            fs.existsSync(path.join(curr, "go.mod")) ||
            fs.existsSync(path.join(curr, "CMakeLists.txt")) ||
            fs.existsSync(path.join(curr, "build.gradle")) ||
            fs.existsSync(path.join(curr, "build.gradle.kts")) ||
            fs.existsSync(path.join(curr, "pom.xml")) ||
            fs.existsSync(path.join(curr, "Makefile"))
        ) {
            foundRoot = curr;
            break;
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
    }
    return foundRoot || dir;
}

function getChatWorkspacesFilePath() {
    return path.join(getUserHome(), ".MultiAI", "shadow_git", "chat_workspaces.json");
}

function recordChatWorkspace(chatId, workspaceRoot) {
    if (!chatId || !workspaceRoot) return;
    try {
        const filePath = getChatWorkspacesFilePath();
        let map = {};
        if (fs.existsSync(filePath)) {
            try { map = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { map = {}; }
        }
        if (!Array.isArray(map[chatId])) {
            map[chatId] = [];
        }
        const norm = path.resolve(workspaceRoot);
        if (!map[chatId].includes(norm)) {
            map[chatId].push(norm);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(map, null, 2), "utf8");
        }
    } catch (e) {
        console.warn("[SnapshotManager] Could not record chat workspace:", e.message);
    }
}

function getWorkspacesForChat(chatId) {
    const list = new Set();
    if (chatId) {
        try {
            const filePath = getChatWorkspacesFilePath();
            if (fs.existsSync(filePath)) {
                const map = JSON.parse(fs.readFileSync(filePath, "utf8"));
                if (Array.isArray(map[chatId])) {
                    map[chatId].forEach(w => {
                        if (fs.existsSync(w)) list.add(w);
                    });
                }
            }
        } catch (_) {}

        // If not yet recorded, inspect chat messages retroactively:
        if (list.size === 0) {
            try {
                const cm = require("./conversations_manager");
                const wsInfo = cm.ensureChatWorkspace ? cm.ensureChatWorkspace(chatId) : null;
                const messagesFile = wsInfo ? wsInfo.messagesFile : null;
                if (messagesFile && fs.existsSync(messagesFile)) {
                    const content = fs.readFileSync(messagesFile, "utf8");
                    const lines = content.split("\n").filter(Boolean);
                    for (const line of lines) {
                        try {
                            const msg = JSON.parse(line);
                            if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
                                for (const tc of msg.tool_calls) {
                                    const fnName = tc.function?.name;
                                    if (fnName === "write_file" || fnName === "replace_file_content" || fnName === "multi_replace_file_content") {
                                        const args = JSON.parse(tc.function.arguments || "{}");
                                        const p = args.path || args.TargetFile;
                                        if (p) {
                                            const resolved = path.resolve(p);
                                            const wsRoot = findWorkspaceRoot(resolved);
                                            if (fs.existsSync(wsRoot)) {
                                                list.add(wsRoot);
                                                recordChatWorkspace(chatId, wsRoot);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        }
    }

    if (list.size === 0) {
        list.add(process.cwd());
    }
    return Array.from(list);
}

/**
 * Returns the storage directory for a given workspace root.
 */
function getShadowGitDir(workspaceRoot) {
    const norm = path.resolve(workspaceRoot);
    const hash = crypto.createHash("md5").update(norm).digest("hex").slice(0, 10);
    const baseName = path.basename(norm).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "workspace";
    return path.join(getUserHome(), ".MultiAI", "shadow_git", `${baseName}-${hash}`);
}

/**
 * Initializes the snapshot storage repository if it doesn't already exist.
 */
function ensureShadowRepo(workspaceRoot) {
    const storageDir = getShadowGitDir(workspaceRoot);
    const baselineDir = path.join(storageDir, "baseline");
    const manifestFile = path.join(storageDir, "manifest.json");

    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true });
    }
    if (!fs.existsSync(manifestFile)) {
        const initial = {
            version: 1,
            workspaceRoot: path.resolve(workspaceRoot),
            files: {},
            history: []
        };
        fs.writeFileSync(manifestFile, JSON.stringify(initial, null, 2), "utf8");
    }

    return storageDir;
}

function loadManifest(workspaceRoot) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const manifestFile = path.join(storageDir, "manifest.json");
    try {
        if (fs.existsSync(manifestFile)) {
            return JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        }
    } catch (_) {}
    return {
        version: 1,
        workspaceRoot: path.resolve(workspaceRoot),
        files: {},
        history: []
    };
}

function saveManifest(workspaceRoot, manifest) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const manifestFile = path.join(storageDir, "manifest.json");
    try {
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
    } catch (e) {
        console.warn("[SnapshotManager] Failed to save manifest:", e.message);
    }
}

/**
 * Ensures a file's pre-edit state is tracked as a baseline before a modification.
 */
function recordPreEditBaseline(workspaceRoot, relativePath, options = {}) {
    ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.resolve(workspaceRoot, cleanRel);
    const storageDir = getShadowGitDir(workspaceRoot);
    const baselinePath = path.join(storageDir, "baseline", cleanRel);

    const manifest = loadManifest(workspaceRoot);
    if (!manifest.files) manifest.files = {};

    // Only record initial baseline if not already captured in current unaccepted cycle
    if (manifest.files[cleanRel]) {
        return;
    }

    if (options.isNew || !fs.existsSync(fullPath)) {
        // File does not exist yet (will be created as new file)
        manifest.files[cleanRel] = {
            isNew: true,
            baselineExists: false,
            recordedAt: Date.now()
        };
        saveManifest(workspaceRoot, manifest);
    } else {
        try {
            fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
            fs.copyFileSync(fullPath, baselinePath);
            manifest.files[cleanRel] = {
                isNew: false,
                baselineExists: true,
                recordedAt: Date.now()
            };
            saveManifest(workspaceRoot, manifest);
        } catch (e) {
            console.warn(`[SnapshotManager] Could not snapshot baseline for ${cleanRel}:`, e.message);
        }
    }
}

/**
 * Records a file modification entry in the history log.
 */
function recordPostEditCommit(workspaceRoot, relativePath, meta = {}) {
    ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");

    const chatId = meta.chatId || "global";
    const tool = meta.tool || "file_tool";
    const instruction = (meta.instruction || meta.description || "Modified by model").replace(/[\r\n]+/g, " ");

    const manifest = loadManifest(workspaceRoot);
    if (!manifest.files) manifest.files = {};
    if (!Array.isArray(manifest.history)) manifest.history = [];

    // Ensure baseline exists if pre-edit hook was missed
    if (!manifest.files[cleanRel]) {
        if (tool === "write_file" || meta.isNew) {
            manifest.files[cleanRel] = {
                isNew: true,
                baselineExists: false,
                recordedAt: Date.now()
            };
        } else {
            manifest.files[cleanRel] = {
                isNew: false,
                baselineExists: false,
                recordedAt: Date.now(),
                modified: true
            };
        }
    }

    const historyEntry = {
        id: crypto.randomBytes(4).toString("hex"),
        path: cleanRel,
        timestamp: Date.now(),
        chatId,
        tool,
        instruction
    };

    manifest.history.push(historyEntry);
    if (manifest.files[cleanRel]) {
        manifest.files[cleanRel].lastMeta = historyEntry;
    }

    saveManifest(workspaceRoot, manifest);

    if (meta.chatId) {
        recordChatWorkspace(meta.chatId, workspaceRoot);
    }

    return true;
}

/**
 * Computes Myers diff between two string arrays.
 */
function computeMyersDiff(linesA, linesB) {
    const N = linesA.length;
    const M = linesB.length;
    const max = N + M;

    if (N === 0 && M === 0) return [];
    if (N === 0) return linesB.map(l => ({ type: "add", text: l }));
    if (M === 0) return linesA.map(l => ({ type: "del", text: l }));

    const v = { 1: 0 };
    const trace = [];
    let foundD = 0;

    outer:
    for (let d = 0; d <= max; d++) {
        trace.push({ ...v });
        for (let k = -d; k <= d; k += 2) {
            let x;
            if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
                x = v[k + 1];
            } else {
                x = v[k - 1] + 1;
            }
            let y = x - k;

            while (x < N && y < M && linesA[x] === linesB[y]) {
                x++;
                y++;
            }
            v[k] = x;

            if (x >= N && y >= M) {
                foundD = d;
                break outer;
            }
        }
    }

    const edits = [];
    let x = N;
    let y = M;

    for (let d = foundD; d > 0; d--) {
        const prevV = trace[d];
        const k = x - y;
        let prevK;

        if (k === -d || (k !== d && (prevV[k - 1] ?? -1) < (prevV[k + 1] ?? -1))) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }

        const prevX = prevV[prevK];
        const prevY = prevX - prevK;

        while (x > prevX && y > prevY) {
            edits.unshift({ type: "common", text: linesA[x - 1] });
            x--;
            y--;
        }

        if (d > 0) {
            if (x === prevX) {
                edits.unshift({ type: "add", text: linesB[y - 1] });
                y--;
            } else {
                edits.unshift({ type: "del", text: linesA[x - 1] });
                x--;
            }
        }
    }

    while (x > 0 && y > 0) {
        edits.unshift({ type: "common", text: linesA[x - 1] });
        x--;
        y--;
    }

    return edits;
}

/**
 * Computes additions and deletions count between two text contents.
 */
function computeDiffStats(textA, textB) {
    if (textA === textB) return { additions: 0, deletions: 0 };
    const linesA = textA === "" ? [] : textA.split(/\r?\n/);
    const linesB = textB === "" ? [] : textB.split(/\r?\n/);
    const edits = computeMyersDiff(linesA, linesB);

    let additions = 0;
    let deletions = 0;
    for (const e of edits) {
        if (e.type === "add") additions++;
        if (e.type === "del") deletions++;
    }
    return { additions, deletions };
}

/**
 * Returns current unaccepted changes relative to the baseline.
 */
function getUnacceptedChanges(workspaceRoot) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const manifest = loadManifest(workspaceRoot);
    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    const fileMap = manifest.files || {};
    for (const cleanRel of Object.keys(fileMap)) {
        const fileInfo = fileMap[cleanRel];
        const fullPath = path.resolve(workspaceRoot, cleanRel);
        const baselinePath = path.join(storageDir, "baseline", cleanRel);

        const currentExists = fs.existsSync(fullPath);
        const baselineExists = fileInfo.baselineExists && fs.existsSync(baselinePath);

        let currentContent = "";
        let baselineContent = "";

        if (currentExists) {
            try { currentContent = fs.readFileSync(fullPath, "utf8"); } catch (_) {}
        }
        if (baselineExists) {
            try { baselineContent = fs.readFileSync(baselinePath, "utf8"); } catch (_) {}
        }

        // Newly created file
        if (fileInfo.isNew || (!baselineExists && !fileInfo.modified && currentExists)) {
            const lines = currentContent === "" ? [] : currentContent.split(/\r?\n/);
            const additions = lines.length;
            files.push({
                path: cleanRel,
                additions,
                deletions: 0,
                isNew: true,
                status: "new"
            });
            totalAdditions += additions;
            continue;
        }

        // Deleted file
        if (baselineExists && !currentExists) {
            const lines = baselineContent === "" ? [] : baselineContent.split(/\r?\n/);
            const deletions = lines.length;
            files.push({
                path: cleanRel,
                additions: 0,
                deletions,
                isNew: false,
                status: "deleted"
            });
            totalDeletions += deletions;
            continue;
        }

        // Modified file with baseline
        if (baselineExists && currentExists) {
            if (currentContent === baselineContent) {
                continue;
            }
            const stats = computeDiffStats(baselineContent, currentContent);
            if (stats.additions > 0 || stats.deletions > 0) {
                files.push({
                    path: cleanRel,
                    additions: stats.additions,
                    deletions: stats.deletions,
                    isNew: false,
                    status: "modified"
                });
                totalAdditions += stats.additions;
                totalDeletions += stats.deletions;
            }
            continue;
        }

        // Modified file without baseline (e.g. post-edit commit called directly)
        if (currentExists) {
            const lines = currentContent === "" ? [] : currentContent.split(/\r?\n/);
            const additions = lines.length || 1;
            files.push({
                path: cleanRel,
                additions,
                deletions: 0,
                isNew: false,
                status: "modified"
            });
            totalAdditions += additions;
        }
    }

    return {
        totalFiles: files.length,
        totalAdditions,
        totalDeletions,
        files
    };
}

/**
 * Accepts all unaccepted changes by resetting the baseline to the current disk state.
 */
function acceptChanges(workspaceRoot) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const manifest = loadManifest(workspaceRoot);

    // Clear tracked unaccepted file baselines
    manifest.files = {};
    saveManifest(workspaceRoot, manifest);

    // Wipe baseline directory cleanly
    const baselineDir = path.join(storageDir, "baseline");
    try {
        if (fs.existsSync(baselineDir)) {
            fs.rmSync(baselineDir, { recursive: true, force: true });
            fs.mkdirSync(baselineDir, { recursive: true });
        }
    } catch (e) {
        console.warn("[SnapshotManager] Failed to reset baseline directory:", e.message);
    }

    return true;
}

/**
 * Reverts a single file to its baseline state.
 */
function revertFile(workspaceRoot, relativePath) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.resolve(workspaceRoot, cleanRel);
    const baselinePath = path.join(storageDir, "baseline", cleanRel);
    const manifest = loadManifest(workspaceRoot);

    const fileInfo = manifest.files ? manifest.files[cleanRel] : null;

    try {
        if (fileInfo && fileInfo.isNew) {
            // New file that was created in this cycle: remove it from workspace
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        } else if (fs.existsSync(baselinePath)) {
            // Restore file content from baseline
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.copyFileSync(baselinePath, fullPath);
            fs.unlinkSync(baselinePath);
        }

        if (manifest.files && manifest.files[cleanRel]) {
            delete manifest.files[cleanRel];
            saveManifest(workspaceRoot, manifest);
        }

        return { status: "success", file: cleanRel };
    } catch (err) {
        console.error(`[SnapshotManager] Failed to revert ${cleanRel}:`, err.message);
        throw err;
    }
}

/**
 * Reverts all unaccepted files back to their baseline states.
 */
function revertAll(workspaceRoot) {
    const manifest = loadManifest(workspaceRoot);
    const fileMap = manifest.files || {};
    let count = 0;

    for (const cleanRel of Object.keys(fileMap)) {
        try {
            revertFile(workspaceRoot, cleanRel);
            count++;
        } catch (e) {
            console.warn(`[SnapshotManager] revertAll failed for ${cleanRel}:`, e.message);
        }
    }

    acceptChanges(workspaceRoot);
    return { status: "success", revertedCount: count };
}

/**
 * Generates unified diff string between baseline and disk state.
 */
function getUnifiedDiff(workspaceRoot, relativePath = null) {
    const storageDir = ensureShadowRepo(workspaceRoot);
    const manifest = loadManifest(workspaceRoot);
    const fileMap = manifest.files || {};

    const targets = relativePath
        ? [relativePath.replace(/\\/g, "/").replace(/^\.\//, "")]
        : Object.keys(fileMap);

    const diffChunks = [];

    for (const cleanRel of targets) {
        const fullPath = path.resolve(workspaceRoot, cleanRel);
        const baselinePath = path.join(storageDir, "baseline", cleanRel);
        const fileInfo = fileMap[cleanRel] || {};

        const currentExists = fs.existsSync(fullPath);
        const baselineExists = fileInfo.baselineExists && fs.existsSync(baselinePath);

        let currentContent = "";
        let baselineContent = "";

        if (currentExists) {
            try { currentContent = fs.readFileSync(fullPath, "utf8"); } catch (_) {}
        }
        if (baselineExists) {
            try { baselineContent = fs.readFileSync(baselinePath, "utf8"); } catch (_) {}
        }

        if (currentExists && baselineExists && currentContent === baselineContent) {
            continue;
        }

        if (fileInfo.isNew || (!baselineExists && currentExists)) {
            const lines = currentContent === "" ? [] : currentContent.split(/\r?\n/);
            diffChunks.push(
                [
                    `--- /dev/null`,
                    `+++ b/${cleanRel}`,
                    `@@ -0,0 +1,${lines.length} @@`,
                    ...lines.map(l => "+" + l)
                ].join("\n") + "\n"
            );
            continue;
        }

        if (baselineExists && !currentExists) {
            const lines = baselineContent === "" ? [] : baselineContent.split(/\r?\n/);
            diffChunks.push(
                [
                    `--- a/${cleanRel}`,
                    `+++ /dev/null`,
                    `@@ -1,${lines.length} +0,0 @@`,
                    ...lines.map(l => "-" + l)
                ].join("\n") + "\n"
            );
            continue;
        }

        const linesA = baselineContent === "" ? [] : baselineContent.split(/\r?\n/);
        const linesB = currentContent === "" ? [] : currentContent.split(/\r?\n/);
        const edits = computeMyersDiff(linesA, linesB);

        let hasChange = false;
        const body = [];
        for (const e of edits) {
            if (e.type === "add") { body.push("+" + e.text); hasChange = true; }
            else if (e.type === "del") { body.push("-" + e.text); hasChange = true; }
            else { body.push(" " + e.text); }
        }

        if (hasChange) {
            diffChunks.push(
                [
                    `--- a/${cleanRel}`,
                    `+++ b/${cleanRel}`,
                    `@@ -1,${linesA.length} +1,${linesB.length} @@`,
                    ...body
                ].join("\n") + "\n"
            );
        }
    }

    return diffChunks.join("\n");
}

function formatHumanDate(date) {
    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();

    if (isToday) return `Today, ${month} ${day}`;
    if (isYesterday) return `Yesterday, ${month} ${day}`;
    return `${month} ${day}, ${date.getFullYear()}`;
}

function formatHumanTime(date) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

/**
 * Returns structured file modification history timeline.
 */
function getFileHistoryTimeline(workspaceRoot, options = {}) {
    const manifest = loadManifest(workspaceRoot);
    const history = manifest.history || [];

    const fileMap = {};

    for (const entry of history) {
        const filePath = entry.path;
        if (!fileMap[filePath]) {
            fileMap[filePath] = {
                path: filePath,
                totalAdditions: 0,
                totalDeletions: 0,
                commits: []
            };
        }

        const dateObj = new Date(entry.timestamp);
        fileMap[filePath].commits.push({
            hash: entry.id,
            time: formatHumanTime(dateObj),
            timestamp: entry.timestamp,
            dateObj,
            subject: entry.instruction,
            files: [
                {
                    path: filePath,
                    additions: 1,
                    deletions: 0
                }
            ]
        });
        fileMap[filePath].totalAdditions += 1;
    }

    const result = [];
    for (const filePath of Object.keys(fileMap)) {
        const item = fileMap[filePath];
        const dateMap = {};

        for (const c of item.commits) {
            const dateKey = formatHumanDate(c.dateObj);
            if (!dateMap[dateKey]) {
                dateMap[dateKey] = {
                    date: dateKey,
                    commits: []
                };
            }
            dateMap[dateKey].commits.push({
                hash: c.hash,
                time: c.time,
                timestamp: c.timestamp,
                subject: c.subject,
                files: c.files
            });
        }

        result.push({
            path: filePath,
            totalAdditions: item.totalAdditions,
            totalDeletions: item.totalDeletions,
            dates: Object.values(dateMap)
        });
    }

    return result;
}

module.exports = {
    getShadowGitDir,
    ensureShadowRepo,
    findWorkspaceRoot,
    recordChatWorkspace,
    getWorkspacesForChat,
    recordPreEditBaseline,
    recordPostEditCommit,
    getUnacceptedChanges,
    acceptChanges,
    revertFile,
    revertAll,
    getUnifiedDiff,
    getFileHistoryTimeline
};
