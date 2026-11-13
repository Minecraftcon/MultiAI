// preview_server.js - Lightweight static preview server for local UI design iteration
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const svgCaptcha = require("svg-captcha");

const FONT_PATH = path.join(__dirname, "../src/server/assets/fonts/JetBrainsMono-Bold.ttf");
if (fs.existsSync(FONT_PATH)) {
  svgCaptcha.loadFont(FONT_PATH);
}

const PORT = 3000;
const WEBUI_DIR = path.join(__dirname, "../UI/webui");
const PREVIEW_FILE = path.join(WEBUI_DIR, "preview-login.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// In-memory single-use CAPTCHA store (TTL: 3 minutes)
const captchaChallenges = new Map();
const CAPTCHA_TTL_MS = 3 * 60 * 1000;

function generateCaptcha() {
  const now = Date.now();
  for (const [id, c] of captchaChallenges.entries()) {
    if (now > c.expiresAt) captchaChallenges.delete(id);
  }

  const captcha = svgCaptcha.create({
    size: 5,
    ignoreChars: "0oO1iIlL",
    noise: 3,
    inverse: true,
    width: 200,
    height: 56,
    fontSize: 48,
  });

  const id = crypto.randomBytes(16).toString("hex");
  captchaChallenges.set(id, { answer: captcha.text.toLowerCase(), expiresAt: now + CAPTCHA_TTL_MS });
  return { id, svg: captcha.data };
}

function verifyCaptcha(id, userInput) {
  if (!id || typeof userInput === "undefined") return false;
  const record = captchaChallenges.get(id);
  if (!record) return false;
  captchaChallenges.delete(id); // Single use
  if (Date.now() > record.expiresAt) return false;
  return String(userInput).trim().toLowerCase() === record.answer;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  // API: Dynamic SVG CAPTCHA endpoint
  if (urlPath === "/api/auth/captcha" && req.method === "GET") {
    const c = generateCaptcha();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    return res.end(JSON.stringify({ id: c.id, svg: c.svg }));
  }

  // API: Mock Login endpoint for local preview testing
  if (urlPath === "/api/auth/login" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const password = String(data.password || "").trim();
        const captchaId = String(data.captchaId || "").trim();
        const captchaAnswer = String(data.captchaAnswer || "").trim();

        if (!password) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Password required" }));
        }

        if (!verifyCaptcha(captchaId, captchaAnswer)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid verification code", needNewCaptcha: true }));
        }

        // Preview accepts any non-empty password for design inspection, or reports success
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, message: "Unlocked" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Bad Request" }));
      }
    });
    return;
  }

  let filePath;
  if (urlPath === "/" || urlPath === "/preview" || urlPath === "/preview-login.html") {
    filePath = PREVIEW_FILE;
  } else {
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, "");
    filePath = path.join(WEBUI_DIR, safePath);
  }

  if (!filePath.startsWith(WEBUI_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      fs.readFile(PREVIEW_FILE, (pErr, pData) => {
        if (pErr) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("Not Found");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(pData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Preview Server] Running at http://localhost:${PORT}/ and http://127.0.0.1:${PORT}/`);
});
