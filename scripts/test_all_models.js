#!/usr/bin/env node
/**
 * MultiAI Live Provider & Model Health Inspector
 * ===============================================
 * Queries every configured model via its provider class.
 * Tests if each model returns HTTP 200 with non-empty content.
 * Updates models.yaml with working models.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const YAML = require("yaml");

const { resolveProvider } = require("../src/providers/llm");

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

async function fetchProviderModelsList(providerId, p, apiKey) {
    const base = (p.base_url || p.api_base || PROVIDER_BASES[providerId] || "").replace(/\/+$/, "");
    if (!base) return [];

    let url = "";
    const headers = { "User-Agent": "MultiAI/2.0", "Accept": "application/json" };
    if (providerId === "gemini") {
        url = `${base}/models?key=${apiKey}`;
    } else {
        url = `${base}/models`;
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return [];
        const data = await res.json();
        if (Array.isArray(data.models)) return data.models.map(m => m.id || m.name);
        if (Array.isArray(data.data)) return data.data.map(m => m.id || m.name);
        if (Array.isArray(data)) return data.map(m => (typeof m === "string" ? m : (m.id || m.name)));
    } catch (_) {}
    return [];
}

async function testSingleModel(providerInstance, providerId, modelId, apiKey, providerConfig) {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);

        const res = await providerInstance.handleChat({
            model: modelId,
            apiKey,
            providerConfig,
            messages: [{ role: "user", content: "Hi" }],
            options: { max_tokens: 8, signal: controller.signal, timeoutMs: 8000 }
        });
        clearTimeout(timer);
        const latency = Date.now() - start;

        const isHttp200 = res && (res.status === 200 || (!res.status && !res.error));
        const text = res?.message?.content || "";

        if (isHttp200 && text && text.trim().length > 0) {
            return {
                working: true,
                status: res.status || 200,
                latency,
                reply: String(text).trim().slice(0, 60)
            };
        } else {
            const errStr = res?.error?.message || res?.message?.content || `HTTP ${res?.status || 500}`;
            return {
                working: false,
                status: res?.status || 500,
                latency,
                error: errStr
            };
        }
    } catch (err) {
        return {
            working: false,
            latency: Date.now() - start,
            error: err.message || String(err)
        };
    }
}

// Concurrency helper
async function mapConcurrent(items, limit, fn) {
    const results = [];
    let idx = 0;
    const workers = Array(Math.min(items.length, limit)).fill(0).map(async () => {
        while (idx < items.length) {
            const cur = idx++;
            results[cur] = await fn(items[cur], cur);
        }
    });
    await Promise.all(workers);
    return results;
}

async function main() {
    const yamlPath = path.join(__dirname, "..", "models.yaml");
    const rawYaml = fs.readFileSync(yamlPath, "utf8");
    const config = YAML.parse(rawYaml);

    console.log("==========================================================");
    console.log(" MultiAI Live Model Health & Verification Inspector");
    console.log("==========================================================\n");

    const report = {};
    const updatedProviders = {};

    for (const [providerId, provider] of Object.entries(config.providers || {})) {
        console.log(`\n──────────────────────────────────────────────────────────`);
        console.log(`Provider: ${provider.name || providerId} [${providerId}]`);
        console.log(`──────────────────────────────────────────────────────────`);

        const apiKey = getKey(provider.api_key_env);
        if (!apiKey) {
            console.log(`  ⚠ Skipped: API key '${provider.api_key_env}' not set in environment.`);
            updatedProviders[providerId] = provider;
            continue;
        }

        const providerInstance = resolveProvider(providerId);

        // 1. Fetch live models list from provider
        const liveList = await fetchProviderModelsList(providerId, provider, apiKey);
        console.log(`  Live /models returned ${liveList.length} total models.`);

        const modelsToTest = [...(provider.models || [])];
        console.log(`  Testing ${modelsToTest.length} configured models (concurrency: 3)...`);

        const testResults = await mapConcurrent(modelsToTest, 3, async (m) => {
            const res = await testSingleModel(providerInstance, providerId, m.id, apiKey, provider);
            if (res.working) {
                console.log(`  ✓ [PASS] ${m.id} (${res.latency}ms) -> "${res.reply.replace(/\n/g, ' ')}"`);
            } else {
                console.log(`  ✗ [FAIL] ${m.id} (${res.latency}ms) -> ${res.error.replace(/\n/g, ' ').slice(0, 80)}`);
            }
            return { model: m, res };
        });

        const workingModels = testResults.filter(t => t.res.working).map(t => t.model);
        const failedModels = testResults.filter(t => !t.res.working).map(t => ({
            id: t.model.id,
            name: t.model.name,
            error: t.res.error
        }));

        report[providerId] = {
            totalTested: modelsToTest.length,
            workingCount: workingModels.length,
            failedCount: failedModels.length,
            failedModels
        };

        if (workingModels.length > 0) {
            // Ensure at least one default
            if (!workingModels.some(m => m.default)) {
                workingModels[0].default = true;
            }
            updatedProviders[providerId] = {
                ...provider,
                models: workingModels
            };
        } else {
            console.log(`  ⚠ All configured models for ${providerId} returned errors. Retaining list.`);
            updatedProviders[providerId] = provider;
        }
    }

    // Write updated models.yaml
    const updatedConfig = { ...config, providers: updatedProviders };
    const newYaml = YAML.stringify(updatedConfig);
    fs.writeFileSync(yamlPath, newYaml, "utf8");
    console.log(`\n✓ Updated repository models.yaml`);

    // Also update ~/.MultiAI/models.yaml if user storage directory exists
    const userStorageYaml = path.join(home, ".MultiAI", "models.yaml");
    if (fs.existsSync(path.dirname(userStorageYaml))) {
        fs.writeFileSync(userStorageYaml, newYaml, "utf8");
        console.log(`✓ Updated ~/.MultiAI/models.yaml`);
    }

    // Print Final Summary Table
    console.log("\n==========================================================");
    console.log(" Final Live Model Verification Summary");
    console.log("==========================================================");
    for (const [pId, r] of Object.entries(report)) {
        console.log(`- ${pId.padEnd(20)}: ${r.workingCount}/${r.totalTested} WORKING`);
        if (r.failedModels.length > 0) {
            r.failedModels.forEach(f => {
                console.log(`    ↳ ✗ ${f.id}: ${f.error.slice(0, 65)}`);
            });
        }
    }
}

main().catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
});
