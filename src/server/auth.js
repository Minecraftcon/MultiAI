/**
 * MultiAI Cloud Security Gate & Session Authentication
 * ====================================================
 * Protects Web UI and API routes with password authentication.
 * Configured strictly via CLOUD_PASSWORD environment variable.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const svgCaptcha = require("svg-captcha");
const { sendJSON } = require("./utils");

// Load MultiAI's core JetBrains Mono font for SVG CAPTCHA rendering
const CAPTCHA_FONT_PATH = path.join(__dirname, "assets/fonts/JetBrainsMono-Bold.ttf");
if (fs.existsSync(CAPTCHA_FONT_PATH)) {
    try {
        svgCaptcha.loadFont(CAPTCHA_FONT_PATH);
    } catch (err) {
        console.warn("[AUTH] Failed to load custom JetBrains Mono font for captcha:", err.message);
    }
}

// Do not fallback to any default password. Must be set via environment variable.
const PASSWORD = (process.env.CLOUD_PASSWORD || "").trim();
if (!PASSWORD) {
    console.error("[SECURITY ALERT] CLOUD_PASSWORD environment variable is NOT set! Cloud access will be blocked until configured.");
}

// In-memory valid sessions (token -> expiry timestamp)
const validSessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Rate limiting for login attempts (IP -> { count, resetTime, lockedUntil })
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;       // 1 minute window
const LOCKOUT_MS = 5 * 60 * 1000;  // 5 minutes lockout if exceeded
const MAX_TRACKED_IPS = 1000;      // Bound memory to prevent map exhaustion DoS

// Periodic cleanup of stale rate limit entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttempts.entries()) {
        if (now > record.resetTime && (!record.lockedUntil || now > record.lockedUntil)) {
            loginAttempts.delete(ip);
        }
    }
}, 60 * 1000).unref();

// In-memory challenge store for SVG CAPTCHA (id -> { answer, expiresAt })
const captchaChallenges = new Map();
const CAPTCHA_TTL_MS = 3 * 60 * 1000; // 3 minutes

function generateCaptcha() {
    // Clean up expired captchas
    const now = Date.now();
    for (const [id, c] of captchaChallenges.entries()) {
        if (now > c.expiresAt) captchaChallenges.delete(id);
    }

    const captcha = svgCaptcha.create({
        size: 5,
        ignoreChars: "0oO1iIlL",
        noise: 3,
        inverse: true,
        width: 190,
        height: 56,
        fontSize: 48,
        background: "transparent"
    });

    const id = crypto.randomBytes(16).toString("hex");
    captchaChallenges.set(id, { answer: captcha.text.toLowerCase(), expiresAt: now + CAPTCHA_TTL_MS });
    return { id, svg: captcha.data };
}

function verifyCaptcha(id, userInput) {
    if (!id || typeof userInput === "undefined") return false;
    const record = captchaChallenges.get(id);
    if (!record) return false;
    captchaChallenges.delete(id); // Single use to prevent replay attacks
    if (Date.now() > record.expiresAt) return false;
    return String(userInput).trim().toLowerCase() === record.answer;
}

function handleCaptchaEndpoint(req, res) {
    const captcha = generateCaptcha();
    return sendJSON(res, 200, {
        id: captcha.id,
        svg: captcha.svg
    });
}

function getClientIp(req) {
    // Cloudflare sets CF-Connecting-IP, which cannot be spoofed by client headers
    if (req.headers["cf-connecting-ip"]) {
        return String(req.headers["cf-connecting-ip"]).trim();
    }
    // If behind reverse proxy without CF, take the last hop in X-Forwarded-For (proxy appended)
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
        const parts = xff.split(",");
        const lastHop = parts[parts.length - 1]?.trim();
        if (lastHop) return lastHop;
    }
    return req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
    const now = Date.now();
    let record = loginAttempts.get(ip);
    if (!record || now > record.resetTime) {
        if (loginAttempts.size >= MAX_TRACKED_IPS) {
            // Evict oldest entry if capacity reached
            const firstKey = loginAttempts.keys().next().value;
            if (firstKey) loginAttempts.delete(firstKey);
        }
        record = { count: 0, resetTime: now + WINDOW_MS, lockedUntil: 0 };
        loginAttempts.set(ip, record);
    }
    if (record.lockedUntil && now < record.lockedUntil) {
        const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
        return { allowed: false, remainingSec };
    }
    return { allowed: true, record };
}

function recordFailedAttempt(ip) {
    const now = Date.now();
    let record = loginAttempts.get(ip);
    if (!record) {
        record = { count: 1, resetTime: now + WINDOW_MS, lockedUntil: 0 };
    } else {
        record.count++;
    }
    if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_MS;
    }
    loginAttempts.set(ip, record);
}

function clearRateLimit(ip) {
    loginAttempts.delete(ip);
}

// Constant-time string equality to prevent timing attacks
function safeCompare(a, b) {
    if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        if (parts.length >= 2) {
            list[parts.shift().trim()] = decodeURIComponent(parts.join("=").trim());
        }
    });
    return list;
}

function isAuthenticated(req) {
    // 1. Direct CLI Admin authentication via Bearer token or X-Admin-Key (master password)
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
        const tokenOrPass = authHeader.slice(7).trim();
        if (PASSWORD && safeCompare(tokenOrPass, PASSWORD)) {
            return true;
        }
    }
    const adminKey = req.headers["x-admin-key"] || req.headers["x-multiai-key"] || "";
    if (adminKey && PASSWORD && safeCompare(adminKey, PASSWORD)) {
        return true;
    }

    // 2. Cookie session
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.multiai_token || req.headers["x-multiai-token"] || "";

    if (!token) return false;

    if (validSessions.has(token)) {
        const expiry = validSessions.get(token);
        if (Date.now() < expiry) {
            return true;
        }
        validSessions.delete(token);
    }
    return false;
}

function handleLogin(req, res) {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip);

    if (!rateCheck.allowed) {
        return sendJSON(res, 429, {
            error: `Too many failed login attempts. Locked for ${rateCheck.remainingSec} seconds.`
        });
    }

    let body = "";
    let bodyLength = 0;
    const MAX_LOGIN_BODY_BYTES = 4096; // 4KB bound

    req.on("data", chunk => {
        bodyLength += chunk.length;
        if (bodyLength > MAX_LOGIN_BODY_BYTES) {
            req.destroy();
            return sendJSON(res, 413, { error: "Payload too large" });
        }
        body += chunk;
    });

    req.on("end", () => {
        try {
            const data = JSON.parse(body || "{}");
            const submittedPass = String(data.password || "").trim();
            const captchaId = String(data.captchaId || "").trim();
            const captchaAnswer = String(data.captchaAnswer || "").trim();

            if (!PASSWORD) {
                return sendJSON(res, 503, {
                    error: "Server configuration error: CLOUD_PASSWORD is not configured on this instance."
                });
            }

            // Verify CAPTCHA challenge
            if (!verifyCaptcha(captchaId, captchaAnswer)) {
                recordFailedAttempt(ip);
                return sendJSON(res, 400, {
                    error: "Invalid or expired verification challenge. Please try again.",
                    needNewCaptcha: true
                });
            }

            if (safeCompare(submittedPass, PASSWORD)) {
                clearRateLimit(ip);
                const token = crypto.randomBytes(32).toString("hex");
                validSessions.set(token, Date.now() + SESSION_TTL_MS);

                const isHttps = req.headers["x-forwarded-proto"] === "https" || req.connection?.encrypted;
                const secureFlag = isHttps ? "; Secure" : "";
                const cookieHeader = `multiai_token=${token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=${SESSION_TTL_MS / 1000}`;

                res.writeHead(200, {
                    "Set-Cookie": cookieHeader,
                    "Content-Type": "application/json"
                });
                return res.end(JSON.stringify({ success: true }));
            } else {
                recordFailedAttempt(ip);
                return sendJSON(res, 401, {
                    error: "Invalid security key. Access denied.",
                    needNewCaptcha: true
                });
            }
        } catch (e) {
            return sendJSON(res, 400, { error: "Malformed request", needNewCaptcha: true });
        }
    });
}

function handleAuthCheck(req, res) {
    if (isAuthenticated(req)) {
        return sendJSON(res, 200, { authenticated: true });
    }
    return sendJSON(res, 401, { authenticated: false });
}

const LOCK_PAGE_PATH = path.join(__dirname, "assets/lock.html");
let cachedLockPage = "";

function renderLockPage() {
    if (!cachedLockPage) {
        if (fs.existsSync(LOCK_PAGE_PATH)) {
            cachedLockPage = fs.readFileSync(LOCK_PAGE_PATH, "utf8");
        } else {
            cachedLockPage = "<!DOCTYPE html><html><body style='background:#090909;color:#fff;'><h1>MultiAI</h1><p>Lock page missing.</p></body></html>";
        }
    }
    return cachedLockPage;
}

module.exports = {
    isAuthenticated,
    handleLogin,
    handleAuthCheck,
    handleCaptchaEndpoint,
    renderLockPage
};

