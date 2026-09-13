// Pollinations Image Generation Provider (Free, High Speed, FLUX / Turbo)
const BaseImageProvider = require("./base");

class PollinationsImageProvider extends BaseImageProvider {
    static id = "pollinations";
    static displayName = "Pollinations AI (FLUX / Turbo)";
    static matchPatterns = [
        /^pollinations$/i,
        /^pollinations[-_]?ai$/i,
        /^flux$/i,
        /^flux[-_]?(schnell|dev|realism)?$/i,
        /^turbo$/i
    ];

    async generateImage({ prompt, model = "flux", aspectRatio = "1:1", width, height, options = {} }) {
        if (!prompt || typeof prompt !== "string") {
            throw new Error("Prompt is required for image generation.");
        }

        const dims = this.getDimensions(aspectRatio, width, height);
        const seed = options.seed || Math.floor(Math.random() * 10000000);
        const safeModel = String(model || "flux").toLowerCase();
        const effectiveModel = (safeModel.includes("turbo")) ? "turbo" : (safeModel.includes("anime") ? "anime" : "flux");

        const cleanPrompt = prompt.trim();
        const encodedPrompt = encodeURIComponent(cleanPrompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${dims.width}&height=${dims.height}&model=${effectiveModel}&seed=${seed}&nologo=true`;

        // Verify that the endpoint is reachable (HEAD or fast GET request)
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const checkRes = await fetch(imageUrl, { method: "HEAD", signal: controller.signal });
            clearTimeout(timeout);

            if (!checkRes.ok && checkRes.status !== 200 && checkRes.status !== 302 && checkRes.status !== 307) {
                // If HEAD fails, we can still provide the image URL as Pollinations renders on demand
                console.warn(`[POLLINATIONS] HEAD check returned status ${checkRes.status}; proceeding with URL.`);
            }
        } catch (e) {
            // Pollinations generates asynchronously upon first GET; timeout on check should not block URL delivery
            console.warn(`[POLLINATIONS] Pre-flight check warning (${e.message}); using generated URL.`);
        }

        return {
            success: true,
            url: imageUrl,
            markdown: this.formatMarkdown(cleanPrompt, imageUrl),
            prompt: cleanPrompt,
            model: effectiveModel,
            provider: this.constructor.id,
            dimensions: {
                width: dims.width,
                height: dims.height,
                aspectRatio: dims.aspectRatio
            },
            seed
        };
    }
}

module.exports = PollinationsImageProvider;
