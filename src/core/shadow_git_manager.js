/**
 * MultiAI Shadow Git Manager
 * Provides bulletproof, isolated versioning for all model file modifications.
 * Uses an isolated Git repository under ~/.MultiAI/shadow_git/<hash>/ with --work-tree=<workspaceRoot>.
 * Never touches or interferes with the user's project .git directory.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

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
            fs.existsSync(path.join(curr, "CMakeLists.txt"))
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
    return path.join(os.homedir(), ".MultiAI", "shadow_git", "chat_workspaces.json");
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
        console.warn("[ShadowGit] Could not record chat workspace:", e.message);
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
                                                    try {
                                                        const cleanRel = path.relative(wsRoot, resolved);
                                                        if (fs.existsSync(resolved)) {
                                                            recordPostEditCommit(wsRoot, cleanRel, {
                                                                chatId,
                                                                tool: fnName,
                                                                instruction: "Tracked modification"
                                                            });
                                                        }
                                                    } catch (_) {}
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
 * Returns the shadow git directory path for a given workspace root.
 */
function getShadowGitDir(workspaceRoot) {
    const norm = path.resolve(workspaceRoot);
    const hash = crypto.createHash("md5").update(norm).digest("hex").slice(0, 10);
    const baseName = path.basename(norm).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "workspace";
    const dir = path.join(os.homedir(), ".MultiAI", "shadow_git", `${baseName}-${hash}`);
    return dir;
}

/**
 * Executes a Git command against the shadow git repository.
 */
function runGit(shadowGitDir, workspaceRoot, args, options = {}) {
    try {
        const fullArgs = [
            "--git-dir=" + shadowGitDir,
            "--work-tree=" + workspaceRoot,
            "-c", "user.name=MultiAI Shadow Engine",
            "-c", "user.email=shadow@multiai.local",
            "-c", "commit.gpgsign=false",
            "-c", "core.quotepath=false",
            "-c", "init.defaultBranch=main",
            ...args
        ];
        return execFileSync("git", fullArgs, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 20 * 1024 * 1024,
            ...options
        });
    } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : err.message;
        const error = new Error(`Shadow Git Error [git ${args.join(" ")}]: ${stderr}`);
        error.code = err.status;
        error.stderr = stderr;
        throw error;
    }
}

/**
 * Initializes the shadow git repository if it doesn't already exist.
 */
function ensureShadowRepo(workspaceRoot) {
    const shadowGitDir = getShadowGitDir(workspaceRoot);
    const headFile = path.join(shadowGitDir, "HEAD");

    if (!fs.existsSync(headFile)) {
        fs.mkdirSync(shadowGitDir, { recursive: true });
        runGit(shadowGitDir, workspaceRoot, ["init"]);
        runGit(shadowGitDir, workspaceRoot, ["commit", "--allow-empty", "-m", "Initial shadow baseline"]);
        runGit(shadowGitDir, workspaceRoot, ["tag", "-f", "accepted-checkpoint", "HEAD"]);
    } else {
        // Ensure accepted-checkpoint tag exists
        try {
            runGit(shadowGitDir, workspaceRoot, ["rev-parse", "--verify", "accepted-checkpoint"]);
        } catch (_) {
            runGit(shadowGitDir, workspaceRoot, ["tag", "-f", "accepted-checkpoint", "HEAD"]);
        }
    }

    return shadowGitDir;
}

/**
 * Ensures a file's pre-edit state is tracked as a baseline before a modification.
 */
function recordPreEditBaseline(workspaceRoot, relativePath) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.resolve(workspaceRoot, cleanRel);

    // If file exists on disk and is not yet in HEAD, commit it as baseline
    if (fs.existsSync(fullPath)) {
        let isKnownInHead = false;
        try {
            runGit(shadowGitDir, workspaceRoot, ["cat-file", "-e", `HEAD:${cleanRel}`]);
            isKnownInHead = true;
        } catch (_) {
            isKnownInHead = false;
        }

        if (!isKnownInHead) {
            try {
                runGit(shadowGitDir, workspaceRoot, ["add", cleanRel]);
                runGit(shadowGitDir, workspaceRoot, ["commit", "-m", `Baseline: ${cleanRel}`]);
                // Keep accepted-checkpoint synced with baseline
                runGit(shadowGitDir, workspaceRoot, ["tag", "-f", "accepted-checkpoint", "HEAD"]);
            } catch (_) {}
        }
    }
}

/**
 * Records a model file modification commit into shadow git.
 */
function recordPostEditCommit(workspaceRoot, relativePath, meta = {}) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");

    const chatId = meta.chatId || "global";
    const tool = meta.tool || "file_tool";
    const instruction = (meta.instruction || meta.description || "Modified by model").replace(/[\r\n]+/g, " ");

    try {
        runGit(shadowGitDir, workspaceRoot, ["add", cleanRel]);
        const commitMsg = `chat:${chatId} | tool:${tool} | ${instruction}`;
        runGit(shadowGitDir, workspaceRoot, ["commit", "-m", commitMsg]);
        if (meta.chatId) {
            recordChatWorkspace(meta.chatId, workspaceRoot);
        }
        return true;
    } catch (err) {
        // If nothing changed, git commit exits with 1
        if (err.stderr && err.stderr.includes("nothing to commit")) {
            return false;
        }
        console.warn("[ShadowGit] Commit failed:", err.message);
        return false;
    }
}

/**
 * Returns current unaccepted changes relative to `accepted-checkpoint`.
 */
function getUnacceptedChanges(workspaceRoot) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);

    let numstatOut = "";
    try {
        numstatOut = runGit(shadowGitDir, workspaceRoot, ["diff", "--numstat", "accepted-checkpoint", "HEAD"]);
    } catch (err) {
        console.warn("[ShadowGit] diff --numstat failed:", err.message);
        return { totalFiles: 0, totalAdditions: 0, totalDeletions: 0, files: [] };
    }

    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    const lines = numstatOut.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
            const added = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
            const deleted = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
            const filePath = parts.slice(2).join(" ");

            let existedInCheckpoint = false;
            try {
                runGit(shadowGitDir, workspaceRoot, ["cat-file", "-e", `accepted-checkpoint:${filePath}`]);
                existedInCheckpoint = true;
            } catch (_) {}

            totalAdditions += added;
            totalDeletions += deleted;
            files.push({
                path: filePath,
                additions: added,
                deletions: deleted,
                isNew: !existedInCheckpoint
            });
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
 * Advances `accepted-checkpoint` to HEAD, clearing unaccepted changes status.
 */
function acceptChanges(workspaceRoot) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);
    runGit(shadowGitDir, workspaceRoot, ["tag", "-f", "accepted-checkpoint", "HEAD"]);
    return {
        status: "success",
        acceptedAt: Date.now()
    };
}

/**
 * Reverts a single file to `accepted-checkpoint`.
 */
function revertFile(workspaceRoot, relativePath) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const fullPath = path.resolve(workspaceRoot, cleanRel);

    let existedInCheckpoint = false;
    try {
        runGit(shadowGitDir, workspaceRoot, ["cat-file", "-e", `accepted-checkpoint:${cleanRel}`]);
        existedInCheckpoint = true;
    } catch (_) {}

    if (existedInCheckpoint) {
        runGit(shadowGitDir, workspaceRoot, ["checkout", "accepted-checkpoint", "--", cleanRel]);
        try {
            runGit(shadowGitDir, workspaceRoot, ["add", cleanRel]);
            runGit(shadowGitDir, workspaceRoot, ["commit", "-m", `Reverted ${cleanRel} to accepted-checkpoint`]);
        } catch (_) {}
    } else {
        // File did not exist at accepted-checkpoint, so remove it
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { force: true });
        }
        try {
            runGit(shadowGitDir, workspaceRoot, ["rm", "--cached", cleanRel]);
            runGit(shadowGitDir, workspaceRoot, ["commit", "-m", `Removed unaccepted new file ${cleanRel}`]);
        } catch (_) {}
    }

    return {
        status: "success",
        file: cleanRel
    };
}

/**
 * Reverts all unaccepted files back to `accepted-checkpoint`.
 */
function revertAll(workspaceRoot) {
    const changes = getUnacceptedChanges(workspaceRoot);
    for (const f of changes.files) {
        revertFile(workspaceRoot, f.path);
    }
    return {
        status: "success",
        revertedCount: changes.files.length
    };
}

/**
 * Returns unified diff string for unaccepted changes.
 */
function getUnifiedDiff(workspaceRoot, relativePath = null) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);
    const args = ["diff", "accepted-checkpoint", "HEAD"];
    if (relativePath) {
        const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
        args.push("--", cleanRel);
    }
    try {
        return runGit(shadowGitDir, workspaceRoot, args);
    } catch (_) {
        return "";
    }
}

/**
 * Formats a Date object into human-readable e.g. "Monday 20/03/2026"
 */
function formatHumanDate(dateObj) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[dateObj.getDay()];
    const d = String(dateObj.getDate()).padStart(2, "0");
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const y = dateObj.getFullYear();
    return `${dayName} ${d}/${m}/${y}`;
}

/**
 * Formats a Date object into 12-hour e.g. "12:40 PM"
 */
function formatHumanTime(dateObj) {
    let hours = dateObj.getHours();
    const minutes = String(dateObj.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
}

/**
 * Returns full historical modification timeline grouped by File -> Date -> Time.
 */
function getFileHistoryTimeline(workspaceRoot, targetPath = null) {
    const shadowGitDir = ensureShadowRepo(workspaceRoot);

    const logArgs = [
        "log",
        "--date=iso-strict",
        "--numstat",
        "--format=COMMIT:%H|%an|%ad|%s"
    ];
    if (targetPath) {
        const cleanRel = targetPath.replace(/\\/g, "/").replace(/^\.\//, "");
        logArgs.push("--", cleanRel);
    }

    let rawLog = "";
    try {
        rawLog = runGit(shadowGitDir, workspaceRoot, logArgs);
    } catch (_) {
        return [];
    }

    // Parse commits and their file diff stats
    const fileMap = new Map(); // path -> { path, totalAdditions, totalDeletions, dateGroups: Map<dateStr, []> }

    const lines = rawLog.split("\n");
    let currentCommit = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith("COMMIT:")) {
            const parts = line.slice(7).split("|");
            const hash = parts[0] || "";
            const author = parts[1] || "";
            const isoDate = parts[2] || "";
            const subject = parts.slice(3).join("|") || "";
            const dateObj = new Date(isoDate);

            currentCommit = {
                hash,
                author,
                dateObj: isNaN(dateObj.getTime()) ? new Date() : dateObj,
                subject
            };
            continue;
        }

        if (currentCommit) {
            const numParts = line.split(/\s+/);
            if (numParts.length >= 3) {
                const added = numParts[0] === "-" ? 0 : parseInt(numParts[0], 10) || 0;
                const deleted = numParts[1] === "-" ? 0 : parseInt(numParts[1], 10) || 0;
                const filePath = numParts.slice(2).join(" ");

                if (!fileMap.has(filePath)) {
                    fileMap.set(filePath, {
                        path: filePath,
                        totalAdditions: 0,
                        totalDeletions: 0,
                        dates: new Map()
                    });
                }

                const fileEntry = fileMap.get(filePath);
                fileEntry.totalAdditions += added;
                fileEntry.totalDeletions += deleted;

                const dateKey = formatHumanDate(currentCommit.dateObj);
                if (!fileEntry.dates.has(dateKey)) {
                    fileEntry.dates.set(dateKey, []);
                }

                fileEntry.dates.get(dateKey).push({
                    hash: currentCommit.hash,
                    time: formatHumanTime(currentCommit.dateObj),
                    timestamp: currentCommit.dateObj.getTime(),
                    additions: added,
                    deletions: deleted,
                    subject: currentCommit.subject
                });
            }
        }
    }

    // Transform into clean JSON serializable output
    const result = [];
    for (const [filePath, entry] of fileMap.entries()) {
        const datesArray = [];
        for (const [dateStr, revisions] of entry.dates.entries()) {
            datesArray.push({
                date: dateStr,
                revisions
            });
        }
        result.push({
            path: filePath,
            totalAdditions: entry.totalAdditions,
            totalDeletions: entry.totalDeletions,
            dates: datesArray
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
