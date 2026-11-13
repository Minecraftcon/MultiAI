#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const YAML = require("yaml");

const doc = YAML.parse(fs.readFileSync("models.yaml", "utf8"));
const home = process.env.HOME || os.homedir();
let bashrcContent = "";
try {
    bashrcContent = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
} catch (_) {}

function getKey(keyName) {
    if (!keyName) return null;
    if (process.env[keyName]) return process.env[keyName];
    const aliases = [keyName];
    if (keyName === "TOKENHARBOR_API_KEY") aliases.push("TOKENHARBOUR_API_KEY");
    if (keyName === "TOKENHARBOUR_API_KEY") aliases.push("TOKENHARBOR_API_KEY");
    if (keyName === "LOGFLARE_API_KEY") aliases.push("LOGFARE_API_KEY");
    if (keyName === "LOGFARE_API_KEY") aliases.push("LOGFLARE_API_KEY");
    if (keyName === "EXPLABS_API_KEY") aliases.push("EXPERIENTIALLABS_API_KEY", "EXPRESSLABS_API_KEY");
    if (keyName === "EXPERIENTIALLABS_API_KEY") aliases.push("EXPLABS_API_KEY", "EXPRESSLABS_API_KEY");
    if (keyName === "EXPRESSLABS_API_KEY") aliases.push("EXPLABS_API_KEY", "EXPERIENTIALLABS_API_KEY");
    for (const k of aliases) {
        if (process.env[k]) return process.env[k];
        const m = bashrcContent.match(new RegExp(`export\\s+${k}=["\x27]?([^"\x27\\r\\n]+)["\x27]?`));
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

const PROVIDER_BASES = {
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    zai: "https://api.z.ai/api/paas/v4",
    llm7: "https://api.llm7.io/v1",
    logflare: "https://logfare.ai/v1",
    arliai: "https://api.arliai.com/v1",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    cohere: "https://api.cohere.com/v1",
    nvidia: "https://integrate.api.nvidia.com/v1",
    mistral: "https://api.mistral.ai/v1",
    tokenharbor: "https://tokenharbor.ai/v1",
    opencode: "https://opencode.ai/zen/v1",
    experientiallabs: "https://api.experientiallabs.ai/v1",
    uncensoreddeepseek: "https://api.uncensoreddeepseek.com/v1",
    kilo: "https://ai-gateway.kilo.ai/api/v1"
};

async function probe() {
    console.log("=== Probing Provider /models Endpoints ===");
    const results = {};

    for (const [providerId, p] of Object.entries(doc.providers)) {
        const apiKey = getKey(p.api_key_env);
        if (!apiKey) {
            console.log(`[${providerId}] Skipped: No API key for ${p.api_key_env}`);
            continue;
        }

        const base = (p.base_url || p.api_base || PROVIDER_BASES[providerId] || "").replace(/\/+$/, "");
        if (!base) {
            console.log(`[${providerId}] Skipped: No base URL`);
            continue;
        }

        let url = "";
        const headers = {
            "User-Agent": "MultiAI/2.0",
            "Accept": "application/json"
        };

        if (providerId === "gemini") {
            url = `${base}/models?key=${apiKey}`;
        } else {
            url = `${base}/models`;
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const res = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) {
                const text = await res.text();
                console.log(`[${providerId}] HTTP ${res.status}: ${res.statusText} - ${text.slice(0, 150)}`);
                continue;
            }

            const data = await res.json();
            let modelsList = [];
            if (Array.isArray(data.models)) {
                modelsList = data.models.map(m => m.id || m.name);
            } else if (Array.isArray(data.data)) {
                modelsList = data.data.map(m => m.id || m.name);
            } else if (Array.isArray(data)) {
                modelsList = data.map(m => (typeof m === "string" ? m : (m.id || m.name)));
            }

            results[providerId] = modelsList;
            console.log(`[${providerId}] SUCCESS: Found ${modelsList.length} models. Preview:`, modelsList.slice(0, 8));
        } catch (err) {
            console.log(`[${providerId}] Error: ${err.message}`);
        }
    }
}

probe();
