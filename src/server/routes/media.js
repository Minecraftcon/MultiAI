const fs = require("fs");
const path = require("path");
const os = require("os");
const url = require("url");
const { getMimeType, getEnvKey, sendJSON } = require("../utils");
const { getConfig } = require("../../core/config_manager");
const conversationsManager = require("../../core/conversations_manager");
const { resolveImageProvider } = require("../../providers");

// In-memory registry for background image generation tasks
const imageGenTasks = new Map();

// Periodically evict completed/failed tasks older than 30min, running tasks older than 2h
setInterval(() => {
    const now = Date.now();
    for (const [id, task] of imageGenTasks.entries()) {
        const age = now - (task.created_at || 0);
        if ((task.status === "completed" || task.status === "failed") && age > 30 * 60 * 1000) {
            imageGenTasks.delete(id);
        } else if (task.status === "running" && age > 2 * 60 * 60 * 1000) {
            imageGenTasks.delete(id);
        }
    }
}, 60 * 60 * 1000);

async function handleMedia(req, res) {
    try {
        const parsedUrl = new URL(req.url, "http://localhost");
        let rawPath = parsedUrl.searchParams.get("path") || "";
        if (!rawPath) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            return res.end("Path parameter is required");
        }

        if (rawPath.includes("%")) {
            try {
                rawPath = decodeURIComponent(rawPath);
            } catch (_) {}
        }

        rawPath = rawPath.trim().replace(/^["'`<]+|["'`>]+$/g, "").trim();

        if (rawPath.startsWith("file://")) {
            try {
                rawPath = url.fileURLToPath(rawPath);
            } catch {
                rawPath = rawPath.replace(/^file:\/\//, "");
            }
        }

        if (rawPath.startsWith("~/") || rawPath === "~") {
            rawPath = path.join(os.homedir(), rawPath.slice(1));
        }

        const candidates = [];
        if (path.isAbsolute(rawPath)) {
            candidates.push(path.normalize(rawPath));
            candidates.push(path.join(process.cwd(), rawPath.replace(/^\/+/, "")));
            candidates.push(path.join(__dirname, "../../../client", rawPath.replace(/^\/+/, "")));
            candidates.push(path.join(process.cwd(), "../client", rawPath.replace(/^\/+/, "")));
        } else {
            candidates.push(path.resolve(process.cwd(), rawPath));
            candidates.push(path.resolve(__dirname, "../../../client", rawPath));
            candidates.push(path.resolve(process.cwd(), "../client", rawPath));
            candidates.push(path.resolve(process.cwd(), "generated_images", rawPath));
            candidates.push(path.resolve(os.homedir(), rawPath));
            candidates.push(path.resolve(os.homedir(), "Videos", rawPath));
            candidates.push(path.resolve(os.homedir(), "Pictures", rawPath));
            candidates.push(path.resolve(os.homedir(), "Downloads", rawPath));
            candidates.push(path.resolve(os.homedir(), "Documents", rawPath));
        }

        let targetPath = null;
        for (const cand of candidates) {
            try {
                if (fs.existsSync(cand) && !fs.statSync(cand).isDirectory()) {
                    targetPath = cand;
                    break;
                }
                const dir = path.dirname(cand);
                const base = path.basename(cand).toLowerCase();
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                    const files = fs.readdirSync(dir);
                    const match = files.find(f => f.toLowerCase() === base);
                    if (match) {
                        const found = path.join(dir, match);
                        if (fs.existsSync(found) && !fs.statSync(found).isDirectory()) {
                            targetPath = found;
                            break;
                        }
                    }
                }
            } catch (_) {}
        }

        if (!targetPath) {
            console.warn(`[MEDIA 404] File not found: ${rawPath}`);
            res.writeHead(404, { 
                "Content-Type": "text/plain",
                "Access-Control-Allow-Origin": "*"
            });
            return res.end(`Media not found: ${path.basename(rawPath)}`);
        }

        const stat = fs.statSync(targetPath);
        const ext = path.extname(targetPath).toLowerCase();
        let mimeType = getMimeType(ext);

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

            if (start >= stat.size || end >= stat.size || start > end) {
                res.writeHead(416, {
                    "Content-Range": `bytes */${stat.size}`,
                    "Access-Control-Allow-Origin": "*"
                });
                return res.end();
            }

            const chunksize = (end - start) + 1;
            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${stat.size}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunksize,
                "Content-Type": mimeType,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Range, Content-Type",
                "Cache-Control": "public, max-age=3600"
            });

            if (req.method === "HEAD") {
                return res.end();
            }

            const stream = fs.createReadStream(targetPath, { start, end });
            stream.on("error", (err) => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
                }
                res.end("Error streaming media: " + err.message);
            });
            stream.pipe(res);
            return;
        }

        res.writeHead(200, {
            "Content-Type": mimeType,
            "Content-Length": stat.size,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Range, Content-Type",
            "Cache-Control": "public, max-age=3600"
        });

        if (req.method === "HEAD") {
            return res.end();
        }

        const stream = fs.createReadStream(targetPath);
        stream.on("error", (err) => {
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
            }
            res.end("Error streaming file: " + err.message);
        });
        stream.pipe(res);
    } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server error: " + err.message);
    }
}

async function handleImageGenerate(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const { prompt, model, provider, aspect_ratio, width, height, seed, negative_prompt, background } = data;

        if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
            return sendJSON(res, 400, { error: "Parameter 'prompt' is required for image generation." });
        }

        const logflareKey = getEnvKey("LOGFLARE_API_KEY") || getEnvKey("LOGFARE_API_KEY");
        const openaiKey = getEnvKey("OPENAI_API_KEY") || getEnvKey("OPENAI_KEY");

        const defaultImageProvider = getConfig().General?.DefaultImageProvider || "pollinations";
        let targetProviderKey = provider || model || defaultImageProvider;

        let apiKey = null;
        if (targetProviderKey.toLowerCase().includes("openai") || targetProviderKey.toLowerCase().includes("dall")) {
            apiKey = openaiKey;
            if (!apiKey) {
                console.warn("[IMAGE API] OpenAI API key not found. Falling back to Pollinations AI...");
                targetProviderKey = "pollinations";
            }
        } else if (targetProviderKey.toLowerCase().includes("logf") || targetProviderKey.toLowerCase().includes("sdxl")) {
            apiKey = logflareKey;
            if (!apiKey) {
                console.warn("[IMAGE API] Logflare API key not found. Falling back to Pollinations AI...");
                targetProviderKey = "pollinations";
            }
        }

        let imageHandler = resolveImageProvider(targetProviderKey);
        if (!imageHandler) {
            targetProviderKey = "pollinations";
            imageHandler = resolveImageProvider("pollinations");
        }

        const activeChatId = data.chatId || data.chat_id;
        const genTaskId = "gen_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
        const chosenModel = model || (targetProviderKey.includes("logf") ? "sdxl-lightning" : "turbo");

        const taskRecord = {
            task_id: genTaskId,
            prompt: prompt.trim(),
            provider: targetProviderKey,
            model: chosenModel,
            status: "running",
            created_at: Date.now(),
            chat_id: activeChatId,
            result: null,
            error: null
        };
        imageGenTasks.set(genTaskId, taskRecord);

        const genPromise = (async () => {
            try {
                let result;
                try {
                    result = await imageHandler.generateImage({
                        prompt: prompt.trim(),
                        model: chosenModel,
                        aspectRatio: aspect_ratio || "1:1",
                        width,
                        height,
                        apiKey,
                        options: { seed, negative_prompt }
                    });
                } catch (primaryErr) {
                    if (targetProviderKey !== "pollinations") {
                        console.warn(`[IMAGE API] ${targetProviderKey} generation failed (${primaryErr.message}). Falling back to Pollinations AI...`);
                        const fallbackHandler = resolveImageProvider("pollinations");
                        result = await fallbackHandler.generateImage({
                            prompt: prompt.trim(),
                            model: "turbo",
                            aspectRatio: aspect_ratio || "1:1",
                            width,
                            height,
                            options: { seed, negative_prompt }
                        });
                    } else {
                        throw primaryErr;
                    }
                }

                if (activeChatId && result.url && result.url.startsWith("/generated_images/")) {
                    try {
                        const localImgPath = path.join(process.cwd(), result.url.slice(1));
                        if (fs.existsSync(localImgPath)) {
                            const filename = path.basename(localImgPath);
                            const ws = conversationsManager.ensureChatWorkspace(activeChatId);
                            fs.copyFileSync(localImgPath, path.join(ws.imagesDir, filename));
                            result.chatImagePath = path.join(ws.imagesDir, filename);
                        }
                    } catch (e) {
                        console.warn(`[IMAGE API] Failed to copy image to chat ${activeChatId}:`, e.message);
                    }
                }

                taskRecord.status = "completed";
                taskRecord.result = result;
                taskRecord.completed_at = Date.now();
                return result;
            } catch (err) {
                console.error(`[IMAGE API] Task ${genTaskId} error:`, err.message);
                taskRecord.status = "failed";
                taskRecord.error = err.message;
                taskRecord.completed_at = Date.now();
                throw err;
            }
        })();

        if (background === true) {
            return sendJSON(res, 200, {
                status: "in_progress",
                background: true,
                task_id: genTaskId,
                prompt: `Image generation is running in the background (task_id: ${genTaskId}). The model can continue with other tasks now without waiting.`,
                message: `Image generation started in background with task_id: ${genTaskId}`
            });
        }

        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve({ __timedOut: true }), 15000);
        });

        try {
            const outcome = await Promise.race([genPromise, timeoutPromise]);
            if (outcome && outcome.__timedOut) {
                return sendJSON(res, 200, {
                    status: "in_progress",
                    background: true,
                    task_id: genTaskId,
                    prompt: `Image generation is taking longer than 15s and is running in the background (task_id: ${genTaskId}). The model may continue other tasks without waiting. When complete, the image will be saved to the conversation images.`,
                    message: `Image generation backgrounded with task_id: ${genTaskId}`
                });
            }

            return sendJSON(res, 200, {
                ...outcome,
                task_id: genTaskId
            });
        } catch (err) {
            return sendJSON(res, 500, {
                task_id: genTaskId,
                error: err.message
            });
        }
    } catch (error) {
        console.error("[IMAGE API ERROR]", error);
        return sendJSON(res, 500, { error: error.message });
    }
}

async function handleImageStatus(req, res) {
    const taskId = decodeURIComponent(req.url.replace("/api/image/status/", "")).trim();
    const task = imageGenTasks.get(taskId);
    if (!task) {
        return sendJSON(res, 404, { error: `Image task '${taskId}' not found` });
    }
    return sendJSON(res, 200, task);
}

module.exports = {
    imageGenTasks,
    handleMedia,
    handleImageGenerate,
    handleImageStatus
};
