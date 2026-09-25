// JSONL Session Storage Engine
// Handles atomic append-only and safe writes for messages.jsonl, meta.json, and context.json

const fs = require("fs");

/**
 * Reads and parses JSON file safely with fallback.
 */
function readJsonFile(filePath, fallback = {}) {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

/**
 * Writes data formatted as JSON safely.
 */
function writeJsonFile(filePath, data, spaces = 2) {
    if (!filePath) return;
    fs.writeFileSync(filePath, JSON.stringify(data, null, spaces), "utf8");
}

/**
 * Reads and parses lines from messages.jsonl.
 */
function readMessages(messagesFile) {
    if (!messagesFile || !fs.existsSync(messagesFile)) return [];
    try {
        const raw = fs.readFileSync(messagesFile, "utf8");
        return raw
            .split("\n")
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => {
                try { return JSON.parse(l); } catch (_) { return null; }
            })
            .filter(Boolean);
    } catch (err) {
        console.error(`[STORAGE] Error reading messages from ${messagesFile}:`, err.message);
        return [];
    }
}

/**
 * Appends a single message to messages.jsonl.
 */
function appendMessage(messagesFile, message) {
    if (!messagesFile || !message) return false;
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(messagesFile, line, "utf8");
    return true;
}

/**
 * Safely writes messages to messages.jsonl, protecting existing disk history
 * from being truncated if incoming payload is a smaller client-side cache slice.
 */
function safelyWriteMessages(messagesFile, incomingMessages, hasMeaningfulMessages) {
    if (!Array.isArray(incomingMessages)) return 0;

    if (!hasMeaningfulMessages) {
        if (!fs.existsSync(messagesFile)) {
            const lines = incomingMessages.map(m => JSON.stringify(m)).join("\n");
            fs.writeFileSync(messagesFile, lines ? lines + "\n" : "", "utf8");
        }
        return incomingMessages.length;
    }

    if (fs.existsSync(messagesFile)) {
        try {
            const existingRaw = fs.readFileSync(messagesFile, "utf8");
            const existingLines = existingRaw.split("\n").map(l => l.trim()).filter(Boolean);
            if (existingLines.length > incomingMessages.length) {
                const existingParsed = existingLines.map(l => {
                    try { return JSON.parse(l); } catch (_) { return null; }
                }).filter(Boolean);

                const sameMsg = (a, b) => {
                    if (!a || !b) return false;
                    if (a.role !== b.role) return false;
                    const ca = typeof a.content === "string" ? a.content : JSON.stringify(a.content || "");
                    const cb = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
                    return ca === cb;
                };

                const lastIncoming = incomingMessages[incomingMessages.length - 1];
                const lastExisting = existingParsed[existingParsed.length - 1];

                if (sameMsg(lastIncoming, lastExisting)) {
                    // Disk already has more complete history and ends with the same message. Do not truncate!
                    return existingLines.length;
                }

                // Check if new turns were appended to a truncated slice
                let matchIdx = -1;
                for (let i = incomingMessages.length - 1; i >= 0; i--) {
                    for (let j = existingParsed.length - 1; j >= 0; j--) {
                        if (sameMsg(incomingMessages[i], existingParsed[j])) {
                            matchIdx = i;
                            break;
                        }
                    }
                    if (matchIdx !== -1) break;
                }

                if (matchIdx !== -1 && matchIdx < incomingMessages.length - 1) {
                    const newTurns = incomingMessages.slice(matchIdx + 1);
                    const merged = [...existingLines, ...newTurns.map(m => JSON.stringify(m))];
                    fs.writeFileSync(messagesFile, merged.join("\n") + "\n", "utf8");
                    return merged.length;
                }

                // Preserve existing disk history if incoming is just a subset
                return existingLines.length;
            }
        } catch (_) {}
    }

    const lines = incomingMessages.map(m => JSON.stringify(m)).join("\n");
    fs.writeFileSync(messagesFile, lines + "\n", "utf8");
    return incomingMessages.length;
}

module.exports = {
    readJsonFile,
    writeJsonFile,
    readMessages,
    appendMessage,
    safelyWriteMessages
};
