const fs = require("fs");
const path = require("path");
const { getMimeType } = require("../utils");

function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end("Method Not Allowed");
    }

    let reqPath = req.url.split("?")[0];
    if (reqPath.startsWith("/../client")) {
        reqPath = reqPath.slice("/../client".length);
        if (!reqPath.startsWith("/")) reqPath = "/" + reqPath;
    }
    if (reqPath.includes("..")) {
        res.writeHead(400);
        return res.end("Bad request");
    }

    const webRoot = path.join(__dirname, "../../../client");
    let filePath = "";
    if (reqPath === "/" || reqPath === "/index.html" || reqPath === "/modular") {
        filePath = path.join(webRoot, "index.html");
    } else if (reqPath.startsWith("/styles/") || reqPath.startsWith("/src/") || reqPath.startsWith("/scripts/")) {
        filePath = path.join(webRoot, reqPath);
    } else if (fs.existsSync(path.join(webRoot, reqPath)) && !fs.statSync(path.join(webRoot, reqPath)).isDirectory()) {
        filePath = path.join(webRoot, reqPath);
    } else if (fs.existsSync(path.join(process.cwd(), reqPath)) && !fs.statSync(path.join(process.cwd(), reqPath)).isDirectory()) {
        filePath = path.join(process.cwd(), reqPath);
    } else if (fs.existsSync(path.join(__dirname, "../../..", reqPath)) && !fs.statSync(path.join(__dirname, "../../..", reqPath)).isDirectory()) {
        filePath = path.join(__dirname, "../../..", reqPath);
    } else {
        filePath = path.join(webRoot, "index.html");
    }

    fs.readFile(filePath, (err, data) => {
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
