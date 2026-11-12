/**
 * MultiAI Cloud Security Gate & Session Authentication
 * ====================================================
 * Protects Web UI and API routes with password authentication.
 * Default password: REDACTED_PASSWORD (or configured via CLOUD_PASSWORD env var)
 */

const crypto = require("crypto");
const { sendJSON } = require("./utils");

const PASSWORD = process.env.CLOUD_PASSWORD || "REDACTED_PASSWORD";

// In-memory valid sessions (token -> expiry timestamp)
const validSessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Constant-time string equality to prevent timing attacks
function safeCompare(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
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
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
        try {
            const data = JSON.parse(body || "{}");
            const submittedPass = String(data.password || "").trim();

            if (safeCompare(submittedPass, PASSWORD)) {
                const token = crypto.randomBytes(32).toString("hex");
                validSessions.set(token, Date.now() + SESSION_TTL_MS);

                const cookieHeader = `multiai_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
                res.writeHead(200, {
                    "Set-Cookie": cookieHeader,
                    "Content-Type": "application/json"
                });
                return res.end(JSON.stringify({ success: true, token }));
            } else {
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
            --bg-color: #090a0f;
            --surface: #12151f;
            --border: rgba(255, 255, 255, 0.1);
            --accent: #6366f1;
            --accent-hover: #4f46e5;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background-image: 
                radial-gradient(circle at 50% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 60%),
                radial-gradient(circle at 80% 80%, rgba(14, 165, 233, 0.1) 0%, transparent 50%);
        }
        .lock-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 36px 32px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 40px rgba(99, 102, 241, 0.1);
            text-align: center;
            backdrop-filter: blur(16px);
        }
        .lock-icon-wrap {
            width: 64px;
            height: 64px;
            background: rgba(99, 102, 241, 0.12);
            border: 1px solid rgba(99, 102, 241, 0.25);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            color: var(--accent);
        }
        h1 {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
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
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        input[type="password"] {
            width: 100%;
            padding: 13px 16px;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-primary);
            font-size: 15px;
            outline: none;
            transition: all 0.2s ease;
        }
        input[type="password"]:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
        }
        button {
            width: 100%;
            padding: 13px;
            background: var(--accent);
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        button:hover {
            background: var(--accent-hover);
            transform: translateY(-1px);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .error-msg {
            color: #f87171;
            font-size: 13px;
            margin-top: 14px;
            min-height: 20px;
        }
        .badge {
            display: inline-block;
            font-size: 11px;
            padding: 3px 8px;
            background: rgba(99, 102, 241, 0.15);
            color: #818cf8;
            border-radius: 20px;
            margin-bottom: 12px;
            font-weight: 600;
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

