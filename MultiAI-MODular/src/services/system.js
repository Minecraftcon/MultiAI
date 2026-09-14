/* =========================================================
   HOST SYSTEM ENVIRONMENT & WORKSPACE PROMPT SERVICE
   ========================================================= */
import { BASE_SYSTEM_PROMPT } from "../config.js";
import { state, setActiveSystemPrompt } from "../state.js";

let cachedSystemInfo = null;

export function buildFullSystemPrompt(workspace = null) {
    let full = BASE_SYSTEM_PROMPT;

    if (cachedSystemInfo) {
        let envPrompt = `\n\n[HOST SYSTEM ENVIRONMENT]\n`;
        envPrompt += `- Operating System: ${cachedSystemInfo.osName} (${cachedSystemInfo.arch})\n`;
        envPrompt += `- Terminal Shell: ${cachedSystemInfo.shellName}\n`;
        envPrompt += `- Working Directory: ${cachedSystemInfo.cwd}\n`;
        if (cachedSystemInfo.username) envPrompt += `- Current User: ${cachedSystemInfo.username}\n`;

        if (Array.isArray(cachedSystemInfo.instructions) && cachedSystemInfo.instructions.length > 0) {
            envPrompt += `\n[TERMINAL & SHELL INSTRUCTIONS FOR THIS SYSTEM]:\n`;
            cachedSystemInfo.instructions.forEach(ins => {
                envPrompt += `- ${ins}\n`;
            });
        }
        full += envPrompt;
    }

    if (workspace && workspace.scratchDir) {
        const wsText = workspace.workspacePrompt || [
            `[SCRATCHPAD & CONVERSATION WORKSPACE]:`,
            `- Active Chat ID: ${workspace.chatId}`,
            `- Conversation Root: ${workspace.chatDir}`,
            `- Scratchsheet Directory: ${workspace.scratchDir}`,
            `- Images Directory: ${workspace.imagesDir}`,
            `- Scratchpad Instructions: You have a dedicated scratchsheet directory (${workspace.scratchDir}) for this conversation. Always use it when writing temporary scripts, data files, analysis notes, code snippets, or intermediate tool outputs.`
        ].join("\n");
        full += `\n\n${wsText}`;
    }

    return full;
}

export async function initSystemEnvironment() {
    try {
        const res = await fetch("/api/system-info");
        if (!res.ok) return;
        cachedSystemInfo = await res.json();
        state.hostSystemInfo = cachedSystemInfo;

        const currentSession = state.currentChatId ? state.chatSessions[state.currentChatId] : null;
        const fullPrompt = buildFullSystemPrompt(currentSession?.workspace);
        setActiveSystemPrompt(fullPrompt);
    } catch (e) {
        console.warn("Could not fetch system info:", e);
    }
}

export function syncActiveWorkspacePrompt(workspace) {
    const fullPrompt = buildFullSystemPrompt(workspace);
    setActiveSystemPrompt(fullPrompt);
}
