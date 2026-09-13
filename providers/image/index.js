// Image Provider Registry & Resolver
const fs = require("fs");
const path = require("path");
const BaseImageProvider = require("./base");

const registeredImageProviders = [];

function registerImageProvider(ProviderClass) {
    if (!ProviderClass || typeof ProviderClass !== "function") return;
    const existingIndex = registeredImageProviders.findIndex(p => p.id === ProviderClass.id);
    if (existingIndex >= 0) {
        registeredImageProviders[existingIndex] = ProviderClass;
    } else {
        registeredImageProviders.push(ProviderClass);
    }
}

function loadAllImageProviders() {
    const dir = __dirname;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        if (!file.endsWith(".js") || file === "index.js" || file === "base.js") {
            continue;
        }
        try {
            const ProviderModule = require(path.join(dir, file));
            if (ProviderModule && typeof ProviderModule === "function") {
                registerImageProvider(ProviderModule);
            }
        } catch (err) {
            console.error(`[IMAGE PROVIDERS] Error loading provider '${file}':`, err.message);
        }
    }
}

// Auto-load providers in this directory
loadAllImageProviders();

/**
 * Resolves the appropriate image provider based on model, name, or key.
 * Defaults to PollinationsImageProvider for zero-configuration, high-speed generation.
 */
function resolveImageProvider(identifier) {
    const PollinationsClass = registeredImageProviders.find(p => p.id === "pollinations") || BaseImageProvider;
    if (!identifier) return new PollinationsClass();

    const str = String(identifier).trim();

    // 1. Exact match / pattern match
    for (const ProviderClass of registeredImageProviders) {
        try {
            if (ProviderClass.matches(str)) {
                return new ProviderClass();
            }
        } catch (_) {}
    }

    // 2. Normalized substring match
    const cleanStr = str.toLowerCase().replace(/[\s\-_]+/g, "");
    for (const ProviderClass of registeredImageProviders) {
        const idClean = (ProviderClass.id || "").toLowerCase().replace(/[\s\-_]+/g, "");
        if (idClean && cleanStr.includes(idClean)) {
            return new ProviderClass();
        }
    }

    // 3. Check for specific keywords
    if (cleanStr.includes("dalle") || cleanStr.includes("openai")) {
        const OpenAIClass = registeredImageProviders.find(p => p.id === "openai_image");
        if (OpenAIClass) return new OpenAIClass();
    }

    // Default to Pollinations
    return new PollinationsClass();
}

function listImageProviders() {
    return registeredImageProviders.map(P => ({
        id: P.id,
        displayName: P.displayName || P.id,
        matchPatterns: P.matchPatterns || []
    }));
}

module.exports = {
    BaseImageProvider,
    registerImageProvider,
    resolveImageProvider,
    listImageProviders
};
