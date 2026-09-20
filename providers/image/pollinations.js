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

    async generateImage({ prompt, model = "turbo", aspectRatio = "1:1", width, height, options = {} }) {
        if (!prompt || typeof prompt !== "string") {
            throw new Error("Prompt is required for image generation.");
        }

        const dims = this.getDimensions(aspectRatio, width, height);
        // Free-tier Pollinations Sana/Turbo works best at <= 768px to avoid 402 pollen charges and queue limits
        const safeWidth = Math.min(dims.width, 768);
        const safeHeight = Math.min(dims.height, 768);

        let usedSeed = options.seed || Math.floor(Math.random() * 10000000);
        const rawModel = String(model || "").toLowerCase();
        // flux on Pollinations now requires paid pollen credits; map to turbo unless anime or specifically overridden
        const effectiveModel = rawModel.includes("anime") ? "anime" : "turbo";

        const cleanPrompt = prompt.trim();
        const urlPrompt = cleanPrompt.length > 800 ? cleanPrompt.slice(0, 800) : cleanPrompt;

        const imagesDir = path.join(process.cwd(), "generated_images");
        try {
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
        } catch (_) {}

        let localUrl = null;
        let lastError = null;
        const encodedPrompt = encodeURIComponent(urlPrompt);
        let finalPollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${safeWidth}&height=${safeHeight}&model=${effectiveModel}&seed=${usedSeed}&nologo=true`;

        // Fast 8s timeout with 2 attempts max (turbo then no-model fallback)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (attempt > 0) {
                    usedSeed = Math.floor(Math.random() * 10000000);
                    await new Promise(r => setTimeout(r, 600));
                }

                const modelParam = attempt === 0 ? `&model=${effectiveModel}` : "";
                finalPollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${safeWidth}&height=${safeHeight}${modelParam}&seed=${usedSeed}&nologo=true`;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);

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
                console.warn(`[POLLINATIONS] Fetch attempt ${attempt + 1} failed: ${err.message}`);
            }
        }

        const deliveryUrl = localUrl || finalPollinationsUrl;
        if (!deliveryUrl) {
            throw new Error(`Pollinations failed: ${lastError?.message || "Service unavailable"}`);
        }

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
            cachedLocally: Boolean(localUrl),
            directUrl: finalPollinationsUrl
        };
    }
}

module.exports = PollinationsImageProvider;
