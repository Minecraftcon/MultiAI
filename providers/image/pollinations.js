// Pollinations Image Generation Provider (Free, High Speed, FLUX / Turbo)
const fs = require("fs");
const path = require("path");
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
        let usedSeed = options.seed || Math.floor(Math.random() * 10000000);
        const safeModel = String(model || "flux").toLowerCase();
        const effectiveModel = (safeModel.includes("turbo")) ? "turbo" : (safeModel.includes("anime") ? "anime" : "flux");

        const cleanPrompt = prompt.trim();
        const urlPrompt = cleanPrompt.length > 800 ? cleanPrompt.slice(0, 800) : cleanPrompt;

        const imagesDir = path.join(process.cwd(), "generated_images");
        try {
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
        } catch (_) {}

        let localUrl = null;
        let finalPollinationsUrl = null;
        let lastError = null;

        // Pollinations queue & edge-cache resiliency:
        // Fetch server-side to guarantee valid image bytes and avoid Cloudflare 0-byte caching / IP concurrency locks
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) {
                    usedSeed = Math.floor(Math.random() * 10000000);
                    await new Promise(r => setTimeout(r, 1200));
                }

                const encodedPrompt = encodeURIComponent(urlPrompt);
                finalPollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${dims.width}&height=${dims.height}&model=${effectiveModel}&seed=${usedSeed}&nologo=true`;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 45000);

                const res = await fetch(finalPollinationsUrl, {
                    method: "GET",
                    headers: {
                        "Accept": "image/jpeg,image/png,image/*"
                    },
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (!res.ok) {
                    const errText = await res.text().catch(() => "");
                    throw new Error(`Pollinations HTTP ${res.status}: ${errText.slice(0, 150)}`);
                }

                const contentType = res.headers.get("content-type") || "";
                if (!contentType.includes("image")) {
                    const errText = await res.text().catch(() => "");
                    throw new Error(`Pollinations returned non-image content (${contentType}): ${errText.slice(0, 150)}`);
                }

                const buf = await res.arrayBuffer();
                if (!buf || buf.byteLength < 500) {
                    throw new Error(`Pollinations returned empty image payload (${buf ? buf.byteLength : 0} bytes)`);
                }

                const ext = contentType.includes("png") ? "png" : "jpg";
                const filename = `pollinations_${Date.now()}_${usedSeed}.${ext}`;
                const localFilePath = path.join(imagesDir, filename);
                fs.writeFileSync(localFilePath, Buffer.from(buf));
                localUrl = `/generated_images/${filename}`;
                break;
            } catch (err) {
                lastError = err;
                console.warn(`[POLLINATIONS] Server-side fetch attempt ${attempt + 1} failed: ${err.message}`);
            }
        }

        const deliveryUrl = localUrl || finalPollinationsUrl;

        return {
            success: true,
            url: deliveryUrl,
            markdown: this.formatMarkdown(cleanPrompt, deliveryUrl),
            prompt: cleanPrompt,
            model: effectiveModel,
            provider: this.constructor.id,
            dimensions: {
                width: dims.width,
                height: dims.height,
                aspectRatio: dims.aspectRatio
            },
            seed: usedSeed,
            cachedLocally: Boolean(localUrl)
        };
    }
}

module.exports = PollinationsImageProvider;
