// Provider Registry & Dynamic Pluggable Resolver
const fs = require("fs");
const path = require("path");
const BaseProvider = require("./base");
const GenericProvider = require("./generic");

const registeredProviders = [];

/**
 * Register a provider class.
 */
function registerProvider(ProviderClass) {
    if (!ProviderClass || typeof ProviderClass !== "function") return;
    // Avoid duplicate registration
    const existingIndex = registeredProviders.findIndex(p => p.id === ProviderClass.id);
    if (existingIndex >= 0) {
        registeredProviders[existingIndex] = ProviderClass;
    } else {
        registeredProviders.push(ProviderClass);
    }
}

/**
 * Automatically load all provider modules in this directory.
 */
function loadAllProviders() {
    const dir = __dirname;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        if (!file.endsWith(".js") || file === "index.js" || file === "base.js" || file === "generic.js") {
            continue;
        }
        try {
            const ProviderModule = require(path.join(dir, file));
            if (ProviderModule && typeof ProviderModule === "function") {
                registerProvider(ProviderModule);
            }
        } catch (err) {
            console.error(`[PROVIDERS] Error loading provider '${file}':`, err.message);
        }
    }
}

// Initial auto-load
loadAllProviders();

/**
 * Resolves the appropriate provider instance based on an identifier
 * (provider type, provider name, or key).
 * 
 * Uses regex and normalized match-based matching:
 * e.g. "openai", "OPENAI", "OpenAI", "Open-AI", "open_ai" -> OpenAIProvider
 * 
 * If no specialized provider matches, returns a GenericProvider instance.
 */
function resolveProvider(identifier) {
    if (!identifier) return new GenericProvider();
    const str = String(identifier).trim();

    // 1. Try exact matches from registered providers
    for (const ProviderClass of registeredProviders) {
        try {
            if (ProviderClass.matches(str)) {
                return new ProviderClass();
            }
        } catch (e) {
            console.error(`[PROVIDERS] Match error for ${ProviderClass.id}:`, e);
        }
    }

    // 2. Normalized check (strip spaces, hyphens, underscores, lower-cased)
    const cleanStr = str.toLowerCase().replace(/[\s\-_]+/g, "");
    for (const ProviderClass of registeredProviders) {
        const idClean = (ProviderClass.id || "").toLowerCase().replace(/[\s\-_]+/g, "");
        if (idClean && cleanStr.includes(idClean)) {
            return new ProviderClass();
        }
    }

    // 3. Fallback to GenericProvider
    return new GenericProvider();
}

/**
 * Returns a list of all registered provider metadata.
 */
function listProviders() {
    return registeredProviders.map(P => ({
        id: P.id,
        displayName: P.displayName || P.id,
        matchPatterns: P.matchPatterns || []
    }));
}

module.exports = {
    BaseProvider,
    GenericProvider,
    registerProvider,
    resolveProvider,
    listProviders,
    reloadProviders: loadAllProviders
};
