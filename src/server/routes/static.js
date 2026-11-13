const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { getMimeType } = require("../utils");

// MIME types that benefit from gzip / brotli compression
const COMPRESSIBLE_TYPES = new Set([
    "text/html",
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/json",
    "text/plain",
    "text/markdown",
    "image/svg+xml",
    "application/xml",
    "text/xml"
]);

// Minimum byte size to justify compression overhead
const MIN_COMPRESS_SIZE = 1024;

function generateETag(stat) {
    const size = stat.size.toString(16);
    const mtime = Math.floor(stat.mtimeMs).toString(16);
    return `W/"${size}-${mtime}"`;
}

function resolveStaticPath(reqPath) {
    const defaultWebRoot = path.join(__dirname, "../../../UI/webui");
    const legacyWebRoot = path.join(__dirname, "../../../client");
    const webRoot = fs.existsSync(defaultWebRoot) ? defaultWebRoot : legacyWebRoot;

    if (reqPath === "/" || reqPath === "/index.html" || reqPath === "/modular") {
        return path.join(webRoot, "index.html");
    }
    if (reqPath.startsWith("/styles/") || reqPath.startsWith("/src/") || reqPath.startsWith("/scripts/") || reqPath.startsWith("/vendor/")) {
        return path.join(webRoot, reqPath);
    }
    const directCandidate = path.join(webRoot, reqPath);
    if (fs.existsSync(directCandidate) && !fs.statSync(directCandidate).isDirectory()) {
        return directCandidate;
    }
    const cwdCandidate = path.join(process.cwd(), reqPath);
    if (fs.existsSync(cwdCandidate) && !fs.statSync(cwdCandidate).isDirectory()) {
        return cwdCandidate;
    }
    const repoCandidate = path.join(__dirname, "../../..", reqPath);
    if (fs.existsSync(repoCandidate) && !fs.statSync(repoCandidate).isDirectory()) {
        return repoCandidate;
    }
    return path.join(webRoot, "index.html");
}

function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        return res.end("Method Not Allowed");
    }

    let reqPath = req.url.split("?")[0];
    if (reqPath.startsWith("/../UI/webui")) {
        reqPath = reqPath.slice("/../UI/webui".length);
        if (!reqPath.startsWith("/")) reqPath = "/" + reqPath;
    } else if (reqPath.startsWith("/../client")) {
        reqPath = reqPath.slice("/../client".length);
        if (!reqPath.startsWith("/")) reqPath = "/" + reqPath;
    }

    // Security check: reject path traversal
    if (reqPath.includes("..")) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("Bad request");
    }

    let filePath;
    try {
        filePath = resolveStaticPath(reqPath);
    } catch (_) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("Not found");
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeType = getMimeType(ext) || "application/octet-stream";
        const etag = generateETag(stat);
        const lastModified = stat.mtime.toUTCString();

        // HTTP 304 Conditional Caching Validation
        const ifNoneMatch = req.headers["if-none-match"];
        const ifModifiedSince = req.headers["if-modified-since"];

        if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === "*")) {
            res.writeHead(304, {
                "ETag": etag,
                "Last-Modified": lastModified,
                "Cache-Control": reqPath.startsWith("/vendor/") ? "public, max-age=86400, stale-while-revalidate=3600" : "no-cache",
                "Vary": "Accept-Encoding"
            });
            return res.end();
        }

        if (ifModifiedSince) {
            const ifModifiedDate = new Date(ifModifiedSince);
            if (!isNaN(ifModifiedDate.getTime())) {
                const statSec = Math.floor(stat.mtime.getTime() / 1000);
                const clientSec = Math.floor(ifModifiedDate.getTime() / 1000);
                if (statSec <= clientSec) {
                    res.writeHead(304, {
                        "ETag": etag,
                        "Last-Modified": lastModified,
                        "Cache-Control": reqPath.startsWith("/vendor/") ? "public, max-age=86400, stale-while-revalidate=3600" : "no-cache",
                        "Vary": "Accept-Encoding"
                    });
                    return res.end();
                }
            }
        }

        // Cache-Control Strategy
        // Vendor assets are immutable/versioned: allow caching with revalidation
        // App code & HTML: 'no-cache' allows instant 304 cache checks while immediately picking up edits
        const cacheControl = reqPath.startsWith("/vendor/")
            ? "public, max-age=86400, stale-while-revalidate=3600"
            : "no-cache";

        const headers = {
            "Content-Type": mimeType,
            "ETag": etag,
            "Last-Modified": lastModified,
            "Cache-Control": cacheControl,
            "Vary": "Accept-Encoding",
            "X-Content-Type-Options": "nosniff"
        };

        // Determine if compression should be applied
        const acceptEncoding = (req.headers["accept-encoding"] || "").toLowerCase();
        const shouldCompress = stat.size >= MIN_COMPRESS_SIZE && COMPRESSIBLE_TYPES.has(mimeType);

        let encoder = null;
        if (shouldCompress) {
            if (acceptEncoding.includes("br") && typeof zlib.createBrotliCompress === "function") {
                headers["Content-Encoding"] = "br";
                encoder = zlib.createBrotliCompress({
                    params: {
                        [zlib.constants.BROTLI_PARAM_QUALITY]: 4 // Fast quality for dynamic loopback
                    }
                });
            } else if (acceptEncoding.includes("gzip")) {
                headers["Content-Encoding"] = "gzip";
                encoder = zlib.createGzip({ level: 6 });
            } else if (acceptEncoding.includes("deflate")) {
                headers["Content-Encoding"] = "deflate";
                encoder = zlib.createDeflate({ level: 6 });
            }
        }

        if (!encoder) {
            headers["Content-Length"] = stat.size;
        }

        res.writeHead(200, headers);

        if (req.method === "HEAD") {
            return res.end();
        }

        // Stream file contents directly with minimal memory allocation
        const stream = fs.createReadStream(filePath);

        stream.on("error", (streamErr) => {
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
            } else {
                res.destroy();
            }
        });

        req.on("close", () => {
            stream.destroy();
        });

        if (encoder) {
            encoder.on("error", () => {
                res.destroy();
            });
            stream.pipe(encoder).pipe(res);
        } else {
            stream.pipe(res);
        }
    });
}

module.exports = {
    handleStatic,
    generateETag,
    resolveStaticPath
};
