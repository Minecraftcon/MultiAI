#!/usr/bin/env node
/**
 * MultiAI Deep Model Discovery & Live Health Verification
 * ========================================================
 * 1. Probes live /models endpoints for NVIDIA NIM, OpenRouter (:free), and other key providers.
 * 2. Runs actual prompt queries against candidates to verify which ones respond with HTTP 200.
 * 3. Updates models.yaml with verified, working models.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const YAML = require("yaml");

const home = process.env.HOME || os.homedir();
let bashrc = "";
try {
    bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
} catch (_) {}

function getKey(varName) {
    if (process.env[varName]) return process.env[varName];
    // Check aliases
    const aliases = [varName];
    if (varName === "OPENROUTER_API_KEY") aliases.push("OPEN_ROUTER", "OPENROUTER");
    if (varName === "NVIDIA_API_KEY") aliases.push("NVIDIA_NIM_API_KEY");
    if (varName === "LOGFLARE_API_KEY") aliases.push("LOGFARE_API_KEY");
    if (varName === "TOKENHARBOR_API_KEY") aliases.push("TOKENHARBOUR_API_KEY");
    if (varName === "EXPLABS_API_KEY") aliases.push("EXPERIENTIALLABS_API_KEY", "EXPRESSLABS_API_KEY");

    for (const k of aliases) {
        if (process.env[k]) return process.env[k];
        const m = bashrc.match(new RegExp(`export\\s+${k}=["\x27]?([^"\x27\\r\\n]+)["\x27]?`));
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

async function testChatCompletion(url, apiKey, model, extraHeaders = {}) {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "User-Agent": "MultiAI/2.0",
                ...extraHeaders
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "Reply with the word 'READY' and nothing else." }],
                max_tokens: 15,
                temperature: 0.1
            }),
            signal: controller.signal
        });
        clearTimeout(timer);

        const latency = Date.now() - start;
        if (!res.ok) {
            const errText = (await res.text()).slice(0, 200);
            return { working: false, status: res.status, error: errText, latency };
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || 
                        data.choices?.[0]?.delta?.content || 
                        data.message?.content?.[0]?.text ||
                        "";

        if (content && content.trim().length > 0) {
            return { working: true, status: 200, output: content.trim().slice(0, 60), latency };
        }
        return { working: false, status: 200, error: "Empty completion body", latency };
    } catch (e) {
        return { working: false, status: 0, error: e.message, latency: Date.now() - start };
    }
}

async function testGeminiModel(apiKey, modelId) {
    const start = Date.now();
    const cleanId = modelId.replace(/^models\//, "");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanId}:generateContent?key=${apiKey}`;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "Reply with 'READY'." }] }],
                generationConfig: { maxOutputTokens: 10, temperature: 0.1 }
            }),
            signal: controller.signal
        });
        clearTimeout(timer);

        const latency = Date.now() - start;
        if (!res.ok) {
            const errText = (await res.text()).slice(0, 150);
            return { working: false, status: res.status, error: errText, latency };
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text.trim().length > 0) {
            return { working: true, status: 200, output: text.trim().slice(0, 60), latency };
        }
        return { working: false, status: 200, error: "Empty response", latency };
    } catch (e) {
        return { working: false, status: 0, error: e.message, latency: Date.now() - start };
    }
}

async function runPool(items, concurrency, fn) {
    const results = [];
    let idx = 0;
    const workers = Array(Math.min(items.length, concurrency)).fill(0).map(async () => {
        while (idx < items.length) {
            const currentIdx = idx++;
            results[currentIdx] = await fn(items[currentIdx], currentIdx);
        }
    });
    await Promise.all(workers);
    return results;
}

function cleanModelName(id) {
    const parts = id.split("/");
    const leaf = parts[parts.length - 1];
    return leaf
        .replace(/[:_]/g, " ")
        .replace(/-/g, " ")
        .replace(/\b[a-z]/g, c => c.toUpperCase())
        .trim();
}

async function main() {
    console.log("==========================================================");
    console.log(" MultiAI Live Deep Discovery & Model Health Inspector");
    console.log("==========================================================\n");

    const yamlPath = path.join(__dirname, "..", "models.yaml");
    const rawYaml = fs.readFileSync(yamlPath, "utf8");
    const modelsDoc = YAML.parse(rawYaml);

    const verifiedResults = {};

    // ── 1. OPENROUTER (:free & zero-price) ──
    const openrouterKey = getKey("OPENROUTER_API_KEY");
    if (openrouterKey) {
        console.log("\n[1/3] Probing OpenRouter for :free and zero-price models...");
        try {
            const res = await fetch("https://openrouter.ai/api/v1/models", {
                headers: { "Authorization": `Bearer ${openrouterKey}` }
            });
            const d = await res.json();
            const freeCandidates = (d.data || []).filter(m => 
                m.id.endsWith(":free") || 
                (m.pricing && m.pricing.prompt === "0" && m.pricing.completion === "0")
            );
            console.log(`Found ${freeCandidates.length} free candidate models on OpenRouter. Testing...`);

            const tested = await runPool(freeCandidates, 4, async (m) => {
                const r = await testChatCompletion("https://openrouter.ai/api/v1/chat/completions", openrouterKey, m.id);
                const tag = r.working ? "✔ PASS" : "✖ FAIL";
                console.log(`  ${tag} [OpenRouter] ${m.id} (${r.latency}ms) ${r.working ? "-> " + r.output : "-> " + r.error}`);
                return { candidate: m, result: r };
            });

            verifiedResults.openrouter = tested
                .filter(t => t.result.working)
                .map(t => ({
                    id: t.candidate.id,
                    name: t.candidate.name || cleanModelName(t.candidate.id),
                    description: t.candidate.description ? t.candidate.description.slice(0, 100) : "OpenRouter Free tier model",
                    context_length: t.candidate.context_length || 32768,
                    cost: { prompt: 0, completion: 0 },
                    capabilities: {
                        streaming: true,
                        vision: Boolean(t.candidate.architecture?.modality?.includes("image") || t.candidate.id.includes("vl")),
                        function_calling: false
                    }
                }));
        } catch (err) {
            console.error("OpenRouter probe error:", err.message);
        }
    } else {
        console.log("Skipping OpenRouter: No key found");
    }

    // ── 2. NVIDIA NIM ──
    const nvidiaKey = getKey("NVIDIA_API_KEY");
    if (nvidiaKey) {
        console.log("\n[2/3] Probing NVIDIA NIM /models...");
        try {
            const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
                headers: { "Authorization": `Bearer ${nvidiaKey}` }
            });
            const d = await res.json();
            const allModels = d.data || [];
            // Filter out embeddings, rerankers, guardrails, audio, vision-only
            const candidates = allModels.filter(m => 
                !m.id.includes("embed") && 
                !m.id.includes("rerank") && 
                !m.id.includes("guard") && 
                !m.id.includes("clip") && 
                !m.id.includes("whisper") &&
                !m.id.includes("synthetic-video") &&
                !m.id.includes("ising")
            );
            console.log(`Found ${candidates.length} candidate chat models on NVIDIA NIM. Testing (concurrency: 4)...`);

            const tested = await runPool(candidates, 4, async (m) => {
                const r = await testChatCompletion("https://integrate.api.nvidia.com/v1/chat/completions", nvidiaKey, m.id);
                const tag = r.working ? "✔ PASS" : "✖ FAIL";
                console.log(`  ${tag} [NVIDIA NIM] ${m.id} (${r.latency}ms) ${r.working ? "-> " + r.output : "-> " + r.error}`);
                return { candidate: m, result: r };
            });

            verifiedResults.nvidia = tested
                .filter(t => t.result.working)
                .map(t => ({
                    id: t.candidate.id,
                    name: cleanModelName(t.candidate.id),
                    description: `NVIDIA NIM accelerated inference for ${t.candidate.id}`,
                    context_length: 32768,
                    cost: { prompt: 0, completion: 0 },
                    capabilities: {
                        streaming: true,
                        vision: Boolean(t.candidate.id.includes("vision") || t.candidate.id.includes("vl")),
                        function_calling: false
                    }
                }));
        } catch (err) {
            console.error("NVIDIA NIM probe error:", err.message);
        }
    }

    // ── 3. GEMINI ALL LIVE MODELS ──
    const geminiKey = getKey("GEMINI_API_KEY");
    if (geminiKey) {
        console.log("\n[3/3] Probing Google Gemini live models...");
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
            const d = await res.json();
            const candidates = (d.models || []).filter(m => 
                Array.isArray(m.supportedGenerationMethods) && 
                m.supportedGenerationMethods.includes("generateContent")
            );
            console.log(`Found ${candidates.length} generateContent models on Gemini. Testing (concurrency: 3)...`);

            const tested = await runPool(candidates, 3, async (m) => {
                const r = await testGeminiModel(geminiKey, m.name);
                const tag = r.working ? "✔ PASS" : "✖ FAIL";
                const cleanId = m.name.replace(/^models\//, "");
                console.log(`  ${tag} [Gemini] ${cleanId} (${r.latency}ms) ${r.working ? "-> " + r.output : "-> " + r.error}`);
                return { candidate: m, cleanId, result: r };
            });

            verifiedResults.gemini = tested
                .filter(t => t.result.working)
                .map(t => ({
                    id: t.cleanId,
                    name: t.candidate.displayName || cleanModelName(t.cleanId),
                    description: t.candidate.description ? t.candidate.description.slice(0, 100) : "Official Google Gemini model",
                    context_length: t.candidate.inputTokenLimit || 1048576,
                    cost: { prompt: 0, completion: 0 },
                    capabilities: {
                        streaming: true,
                        vision: true,
                        function_calling: true
                    }
                }));
        } catch (err) {
            console.error("Gemini probe error:", err.message);
        }
    }

    // ── SUMMARY & MERGE INTO MODELS.YAML ──
    console.log("\n==========================================================");
    console.log(" Discovery Summary");
    console.log("==========================================================");
    for (const [pId, list] of Object.entries(verifiedResults)) {
        console.log(`• ${pId}: ${list.length} working models verified.`);
    }

    // Merge into modelsDoc
    for (const [pId, modelsList] of Object.entries(verifiedResults)) {
        if (!modelsDoc.providers[pId]) continue;
        if (modelsList.length > 0) {
            modelsDoc.providers[pId].models = modelsList;
        }
    }

    const updatedYaml = YAML.stringify(modelsDoc, { indent: 2 });
    fs.writeFileSync(yamlPath, updatedYaml, "utf8");
    console.log(`\nUpdated repo: ${yamlPath}`);

    const userYamlPath = path.join(home, ".MultiAI", "models.yaml");
    if (fs.existsSync(path.dirname(userYamlPath))) {
        fs.writeFileSync(userYamlPath, updatedYaml, "utf8");
        console.log(`Updated user home: ${userYamlPath}`);
    }

    console.log("\nDone! All working models have been updated in models.yaml.");
}

main().catch(console.error);

