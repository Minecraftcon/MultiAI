/* =========================================================
   USER FILE COMMENTS & CODE ANNOTATIONS SERVICE
   Allows users to select code in any file, right-click,
   and attach instructions/comments that are automatically
   injected into the AI model's context on the next turn.
   ========================================================= */
import { state } from "../state/index.js";

const COMMENTS_STORAGE_KEY = "multiai_file_comments_v1";

/**
 * Loads all stored file comments from persistent storage.
 * @returns {Array<Object>}
 */
function loadStoredComments() {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(COMMENTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/**
 * Saves comments to persistent storage.
 * @param {Array<Object>} comments
 */
function saveStoredComments(comments) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(comments));
    } catch (_) {}
}

/**
 * In-memory active comments cache.
 */
let commentsCache = loadStoredComments();

/**
 * Dispatches a DOM event whenever comments change so UI components can re-render.
 */
function notifyCommentsUpdated() {
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("fileCommentsUpdated", {
            detail: { comments: commentsCache }
        }));
    }
}

/**
 * Adds a new comment on a file's lines.
 *
 * @param {Object} param0
 * @param {string} param0.filePath
 * @param {number} param0.startLine
 * @param {number} param0.endLine
 * @param {string} [param0.selectedText=""]
 * @param {string} param0.comment
 * @param {string} [param0.chatId=null]
 * @returns {Object}
 */
export function addFileComment({ filePath, startLine, endLine, selectedText = "", comment, chatId = null }) {
    if (!filePath || !comment || !comment.trim()) {
        throw new Error("filePath and comment text are required.");
    }

    const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    const targetChatId = chatId || state.currentChatId || "global";

    const newComment = {
        id: "comment_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
        filePath: cleanPath,
        startLine: Math.min(startLine || 1, endLine || 1),
        endLine: Math.max(startLine || 1, endLine || 1),
        selectedText: (selectedText || "").slice(0, 1500).trim(),
        comment: comment.trim(),
        chatId: targetChatId,
        createdAt: Date.now()
    };

    commentsCache.push(newComment);
    saveStoredComments(commentsCache);
    notifyCommentsUpdated();
    return newComment;
}

/**
 * Retrieves comments optionally filtered by filePath and chatId.
 *
 * @param {string} [filePath=null]
 * @param {string} [chatId=null]
 * @returns {Array<Object>}
 */
export function getFileComments(filePath = null, chatId = null) {
    let list = commentsCache;
    const targetChatId = chatId || state.currentChatId;

    if (targetChatId) {
        list = list.filter(c => !c.chatId || c.chatId === targetChatId || c.chatId === "global");
    }

    if (filePath) {
        const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
        list = list.filter(c => {
            const p = (c.filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
            return p === cleanPath || p.endsWith("/" + cleanPath) || cleanPath.endsWith("/" + p);
        });
    }

    return list;
}

/**
 * Removes a file comment by ID.
 * @param {string} commentId
 * @returns {boolean}
 */
export function removeFileComment(commentId) {
    if (!commentId) return false;
    const initialLen = commentsCache.length;
    commentsCache = commentsCache.filter(c => c.id !== commentId);
    if (commentsCache.length !== initialLen) {
        saveStoredComments(commentsCache);
        notifyCommentsUpdated();
        return true;
    }
    return false;
}

/**
 * Clears comments for a specific chat or file.
 */
export function clearFileComments(filePath = null, chatId = null) {
    const targetChatId = chatId || state.currentChatId;
    if (filePath) {
        const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
        commentsCache = commentsCache.filter(c => {
            const p = (c.filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
            const matchesFile = p === cleanPath || p.endsWith("/" + cleanPath) || cleanPath.endsWith("/" + p);
            const matchesChat = !targetChatId || c.chatId === targetChatId;
            return !(matchesFile && matchesChat);
        });
    } else if (targetChatId) {
        commentsCache = commentsCache.filter(c => c.chatId !== targetChatId && c.chatId !== "global");
    } else {
        commentsCache = [];
    }
    saveStoredComments(commentsCache);
    notifyCommentsUpdated();
}

/**
 * Formats all active comments into a structured markdown directive
 * for the AI model's system context.
 *
 * @param {string} [chatId=null]
 * @returns {string|null}
 */
export function formatCommentsForSystemPrompt(chatId = null) {
    const comments = getFileComments(null, chatId);
    if (!comments || comments.length === 0) return null;

    let out = `[USER CODE ANNOTATIONS & INLINE COMMENTS]:\n`;
    out += `The user has highlighted specific lines of code in the workspace and left instructions/comments for you:\n\n`;

    comments.forEach((c, idx) => {
        const lineStr = c.startLine === c.endLine ? `line ${c.startLine}` : `lines ${c.startLine}–${c.endLine}`;
        out += `${idx + 1}. File: "${c.filePath}" (${lineStr})\n`;
        if (c.selectedText) {
            out += `   Selected Code:\n   \`\`\`\n   ${c.selectedText.replace(/\n/g, "\n   ")}\n   \`\`\`\n`;
        }
        out += `   User Comment / Instruction: "${c.comment}"\n\n`;
    });

    out += `Please examine, consider, and address these user comments during your execution and reasoning.`;
    return out.trim();
}

