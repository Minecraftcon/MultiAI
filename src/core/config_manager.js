// Zero-Dependency INI Configuration Manager
const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
    General: {
        DefaultStartupLLM: "gemini-2.5-flash",
        DefaultImageProvider: "pollinations",
        DefaultImageModel: "flux",
        DefaultImageAspectRatio: "1:1",
        RecordDate: true,
        RecordChatHistory: true,
        MaxChatHistory: 100,
        StorageDir: "~/.MultiAI",
        Port: 8080,
        Host: "0.0.0.0",
        LogLevel: "info",
        LogFile: "./logs.txt"
    },
    Agent: {
        MaxToolRounds: 0,
        MaxToolsPerRound: 10,
        AutoScroll: true,
        StreamReasoning: true,
        TurnTimeoutSeconds: 120
    },
    Tools: {
        EnableTerminal: true,
        EnableWebSearch: true,
        EnableImageGeneration: true,
        EnableFileOperations: true,
        DefaultTaskCooldown: 2,
        MaxFileSizeKB: 1024
    },
    Search: {
        MaxSearchResults: 5,
        SearchTimeoutSeconds: 15
    },
    UI: {
        Theme: "dark",
        AuroraTheme: "saturn",
        ShowLineNumbers: true,
        CompactMobileView: true
    },
    Mobile: {
        LimitVisibleTurns: true,
        VisibleTurns: 15
    }
};

let cachedConfig = null;
let lastMtime = 0;

function castValue(raw) {
    if (raw === undefined || raw === null) return "";
    const str = String(raw).trim();
    if (str.toLowerCase() === "true") return true;
    if (str.toLowerCase() === "false") return false;
    if (/^-?\d+$/.test(str)) {
        const num = parseInt(str, 10);
        if (!isNaN(num)) return num;
    }
    if (/^-?\d+\.\d+$/.test(str)) {
        const num = parseFloat(str);
        if (!isNaN(num)) return num;
    }
    // Remove surrounding quotes if present
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
        return str.slice(1, -1);
    }
    return str;
}

/**
 * Parses INI formatted string into structured JavaScript object.
 */
function parseINI(text) {
    const result = {};
    let currentSection = "General";

    const lines = text.split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("#") || line.startsWith(";")) {
            continue;
        }

        // Section header: [SectionName]
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            if (!result[currentSection]) {
                result[currentSection] = {};
            }
            continue;
        }

        // Key-value pair: key = value
        const eqIndex = line.indexOf("=");
        if (eqIndex !== -1) {
            const key = line.slice(0, eqIndex).trim();
            let rawVal = line.slice(eqIndex + 1);

            // Strip inline comments if not inside quotes
            const hashIdx = rawVal.indexOf("#");
            const semiIdx = rawVal.indexOf(";");
            let commentIdx = -1;
            if (hashIdx !== -1 && semiIdx !== -1) {
                commentIdx = Math.min(hashIdx, semiIdx);
            } else if (hashIdx !== -1) {
                commentIdx = hashIdx;
            } else if (semiIdx !== -1) {
                commentIdx = semiIdx;
            }

            if (commentIdx !== -1) {
                // Check if comment char is inside quotes
                const beforeComment = rawVal.slice(0, commentIdx);
                const quoteCount = (beforeComment.match(/"/g) || []).length + (beforeComment.match(/'/g) || []).length;
                if (quoteCount % 2 === 0) {
                    rawVal = beforeComment;
                }
            }

            if (!result[currentSection]) {
                result[currentSection] = {};
            }
            result[currentSection][key] = castValue(rawVal);
        }
    }

    return result;
}

/**
 * Serializes object into INI string.
 */
function serializeINI(config) {
    let out = "# MultiAI Configuration File (config.ini)\n\n";
    for (const [section, entries] of Object.entries(config)) {
        out += `[${section}]\n`;
        if (entries && typeof entries === "object") {
            for (const [key, val] of Object.entries(entries)) {
                out += `${key} = ${val}\n`;
            }
        }
        out += "\n";
    }
    return out.trim() + "\n";
}

/**
 * Deep merges parsed configuration with default fallbacks.
 */
function mergeWithDefaults(parsed) {
    const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    for (const [sec, keys] of Object.entries(parsed || {})) {
        if (!merged[sec]) merged[sec] = {};
        if (typeof keys === "object" && keys !== null) {
            for (const [k, v] of Object.entries(keys)) {
                merged[sec][k] = v;
            }
        }
    }
    return merged;
}

/**
 * Loads and returns the effective config object from config.ini.
 */
function loadConfig(filePath) {
    const targetPath = filePath || path.join(__dirname, "config.ini");
    try {
        if (fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (cachedConfig && stat.mtimeMs === lastMtime) {
                return cachedConfig;
            }
            const content = fs.readFileSync(targetPath, "utf8");
            const parsed = parseINI(content);
            cachedConfig = mergeWithDefaults(parsed);
            lastMtime = stat.mtimeMs;
            return cachedConfig;
        } else {
            // Write defaults to config.ini if file does not exist
            const serialized = serializeINI(DEFAULT_CONFIG);
            fs.writeFileSync(targetPath, serialized, "utf8");
            cachedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            return cachedConfig;
        }
    } catch (err) {
        console.error("[CONFIG MANAGER] Error reading config.ini:", err.message);
        return cachedConfig || DEFAULT_CONFIG;
    }
}

/**
 * Saves an updated config to config.ini.
 */
function saveConfig(updates, filePath) {
    const targetPath = filePath || path.join(__dirname, "config.ini");
    const current = loadConfig(targetPath);
    const updated = mergeWithDefaults({ ...current, ...updates });
    const serialized = serializeINI(updated);
    fs.writeFileSync(targetPath, serialized, "utf8");
    cachedConfig = updated;
    try {
        lastMtime = fs.statSync(targetPath).mtimeMs;
    } catch (_) {}
    return updated;
}

module.exports = {
    loadConfig,
    getConfig: () => loadConfig(),
    saveConfig,
    parseINI,
    serializeINI,
    DEFAULT_CONFIG
};
