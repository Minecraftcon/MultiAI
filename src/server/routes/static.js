const fs = require("fs");
const path = require("path");
const { getMimeType } = require("../utils");

function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
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
    if (reqPath.includes("..")) {
        res.writeHead(400);
        return res.end("Bad request");
    }

    const defaultWebRoot = path.join(__dirname, "../../../UI/webui");
    const legacyWebRoot = path.join(__dirname, "../../../client");
    const webRoot = fs.existsSync(defaultWebRoot) ? defaultWebRoot : legacyWebRoot;

    // Disallow hidden files or dotfiles (e.g. .git, .env, .gitignore)
    if (reqPath.includes("/.") || reqPath.startsWith("/.")) {
        res.writeHead(404);
        return res.end("Not found");
    }

    let filePath = "";
    if (reqPath === "/" || reqPath === "/index.html" || reqPath === "/modular") {
        filePath = path.join(webRoot, "index.html");
    } else if (reqPath.startsWith("/styles/") || reqPath.startsWith("/src/") || reqPath.startsWith("/scripts/") || reqPath.startsWith("/vendor/")) {
        filePath = path.join(webRoot, reqPath);
    } else {
        const potentialPath = path.join(webRoot, reqPath);
        // Strictly serve files that exist inside webRoot only (never process.cwd() or repo root)
        if (fs.existsSync(potentialPath) && !fs.statSync(potentialPath).isDirectory()) {
            filePath = potentialPath;
        } else {
            filePath = path.join(webRoot, "index.html");
        }
    }

    // Verify resolved path strictly starts with webRoot
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(webRoot))) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(resolvedPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end("Not found");
        }
        const ext = path.extname(filePath).toLowerCase();
        const type = getMimeType(ext);
        res.writeHead(200, { 
            "Content-Type": type,
            "Content-Length": Buffer.byteLength(data),
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        });
        if (req.method === "HEAD") {
            return res.end();
        }
        res.end(data);
    });
}

module.exports = {
    handleStatic
};
