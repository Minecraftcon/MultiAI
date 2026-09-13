// MultiAI Unified Provider Facade
// Combines LLM text/chat providers (providers/llm) and Image generation providers (providers/image)

const llm = require("./llm");
const image = require("./image");

module.exports = {
    // LLM Providers (Backwards-compatible API)
    BaseProvider: llm.BaseProvider,
    GenericProvider: llm.GenericProvider,
    resolveProvider: llm.resolveProvider,
    resolveLLMProvider: llm.resolveProvider,
    listProviders: llm.listProviders,
    registerProvider: llm.registerProvider,

    // Image Providers
    BaseImageProvider: image.BaseImageProvider,
    resolveImageProvider: image.resolveImageProvider,
    listImageProviders: image.listImageProviders,
    registerImageProvider: image.registerImageProvider,

    // Sub-namespaces
    llm,
    image
};
