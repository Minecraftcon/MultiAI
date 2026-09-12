/* =========================================================
   HOST SYSTEM ENVIRONMENT SERVICE
   ========================================================= */
import { BASE_SYSTEM_PROMPT } from "../config.js";
import { setActiveSystemPrompt } from "../state.js";

export async function initSystemEnvironment() {
    try {
        const res = await fetch("/api/system-info");
        if (!res.ok) return;
        const info = await res.json();

        let envPrompt = `\n\n[HOST SYSTEM ENVIRONMENT]\n`;
        envPrompt += `- Operating System: ${info.osName} (${info.arch})\n`;
        envPrompt += `- Terminal Shell: ${info.shellName}\n`;
        envPrompt += `- Working Directory: ${info.cwd}\n`;
        if (info.username) envPrompt += `- Current User: ${info.username}\n`;

        if (Array.isArray(info.instructions) && info.instructions.length > 0) {
            envPrompt += `\n[TERMINAL & SHELL INSTRUCTIONS FOR THIS SYSTEM]:\n`;
            info.instructions.forEach(ins => {
                envPrompt += `- ${ins}\n`;
            });
        }

        const fullPrompt = BASE_SYSTEM_PROMPT + "\n" + envPrompt;
        setActiveSystemPrompt(fullPrompt);
    } catch (e) {
        console.warn("Could not fetch system info:", e);
    }
}
