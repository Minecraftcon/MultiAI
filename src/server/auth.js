/**
 * MultiAI Cloud Security Gate & Session Authentication
 * ====================================================
 * Protects Web UI and API routes with password authentication.
 * Configured strictly via CLOUD_PASSWORD environment variable.
 */

const crypto = require("crypto");
const { sendJSON } = require("./utils");

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

function getClientIp(req) {
    return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
           req.socket?.remoteAddress ||
           "unknown";
}

function checkRateLimit(ip) {
    const now = Date.now();
    let record = loginAttempts.get(ip);
    if (!record || now > record.resetTime) {
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
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
        try {
            const data = JSON.parse(body || "{}");
            const submittedPass = String(data.password || "").trim();

            if (!PASSWORD) {
                return sendJSON(res, 503, {
                    error: "Server configuration error: CLOUD_PASSWORD is not configured on this instance."
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
                return res.end(JSON.stringify({ success: true, token }));
            } else {
                recordFailedAttempt(ip);
                return sendJSON(res, 401, { error: "Invalid security key. Access denied." });
            }
        } catch (e) {
            return sendJSON(res, 400, { error: "Malformed request" });
        }
    });
}

function handleAuthCheck(req, res) {
    if (isAuthenticated(req)) {
        return sendJSON(res, 200, { authenticated: true });
    }
    return sendJSON(res, 401, { authenticated: false });
}

function renderLockPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MultiAI Cloud Security Gate</title>
    <style>
        :root {
            --bg-color: #0c0d10;
            --surface: #14151a;
            --surface-elevated: #1a1c23;
            --border: #232630;
            --text-primary: #f4f4f6;
            --text-secondary: #9094a6;
            --text-tertiary: #5e6375;
            --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            -webkit-font-smoothing: antialiased;
        }
        .lock-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 36px 32px;
            width: 100%;
            max-width: 380px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
            text-align: left;
        }
        .lock-icon-wrap {
            width: 40px;
            height: 40px;
            background: var(--surface-elevated);
            border: 1px solid var(--border);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            color: var(--text-primary);
        }
        h1 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 6px;
            letter-spacing: -0.02em;
            color: var(--text-primary);
        }
        p {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 24px;
            line-height: 1.5;
        }
        .input-group {
            margin-bottom: 18px;
            text-align: left;
        }
        label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        input[type="password"] {
            width: 100%;
            padding: 10px 14px;
            background: var(--bg-color);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-primary);
            font-size: 14px;
            font-family: var(--font-mono);
            outline: none;
            transition: border-color 0.15s ease;
        }
        input[type="password"]:focus {
            border-color: #4f5365;
        }
        button {
            width: 100%;
            padding: 11px 14px;
            background: #ededed;
            color: #0c0d10;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s ease, transform 0.05s ease;
        }
        button:hover {
            background: #ffffff;
        }
        button:active {
            transform: scale(0.99);
        }
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }
        .error-msg {
            color: #e06c75;
            font-size: 12px;
            margin-top: 12px;
            min-height: 18px;
        }
        .badge {
            display: inline-block;
            font-size: 11px;
            padding: 2px 8px;
            background: var(--surface-elevated);
            color: var(--text-secondary);
            border: 1px solid var(--border);
            border-radius: 4px;
            margin-bottom: 16px;
            font-weight: 500;
            font-family: var(--font-mono);
        }
    </style>
</head>
<body>
    <div class="lock-card">
        <div class="badge">MultiAI Cloud</div>
        <div class="lock-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
        </div>
        <h1>Security Checkpoint</h1>
        <p>This MultiAI Cloud node is password protected. Enter the master security key to access the console.</p>
        <form id="loginForm">
            <div class="input-group">
                <label for="passInput">Security Password</label>
                <input type="password" id="passInput" placeholder="••••••••••••••••" autofocus required>
            </div>
            <button type="submit" id="submitBtn">Unlock MultiAI</button>
            <div id="errorMsg" class="error-msg"></div>
        </form>
    </div>

    <script>
        const form = document.getElementById("loginForm");
        const passInput = document.getElementById("passInput");
        const submitBtn = document.getElementById("submitBtn");
        const errorMsg = document.getElementById("errorMsg");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = "Verifying...";
            errorMsg.textContent = "";

            try {
                const res = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password: passInput.value })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    window.location.reload();
                } else {
                    errorMsg.textContent = data.error || "Access Denied";
                    passInput.value = "";
                    passInput.focus();
                }
            } catch (err) {
                errorMsg.textContent = "Network error: " + err.message;
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "Unlock MultiAI";
            }
        });
    </script>
</body>
</html>`;
}

module.exports = {
    isAuthenticated,
    handleLogin,
    handleAuthCheck,
    renderLockPage
};

