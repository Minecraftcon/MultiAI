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
            --mono-bg: #111215;
            --mono-surface: #18191f;
            --mono-surface-hover: #1e2027;
            --mono-field: #22242c;
            --mono-field-focus: #282a34;
            --mono-border: rgba(255, 255, 255, 0.08);
            --mono-border-focus: rgba(255, 255, 255, 0.22);
            --mono-text: #f3f4f6;
            --mono-muted: #8b909f;
            --mono-dim: #5a5f70;
            --mono-btn-bg: #ededed;
            --mono-btn-text: #111215;
            --mono-btn-hover: #ffffff;
            --mono-error: #f87171;
            --font-ui: "Plus Jakarta Sans", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background-color: var(--mono-bg);
            color: var(--mono-text);
            font-family: var(--font-ui);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            -webkit-font-smoothing: antialiased;
            overflow-x: hidden;
            position: relative;
        }

        /* Ambient Background Layers */
        .bg-layer {
            position: fixed;
            inset: 0;
            pointer-events: none;
            overflow: hidden;
            z-index: 0;
        }

        /* Subtle Static Dot Matrix */
        .bg-dots {
            position: absolute;
            inset: 0;
            background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
            background-size: 24px 24px;
        }

        /* Interactive Cursor Spotlight */
        .bg-light-source {
            position: absolute;
            inset: 0;
            background: radial-gradient(
                600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
                rgba(255, 255, 255, 0.04),
                rgba(255, 255, 255, 0.01) 35%,
                transparent 70%
            );
            transition: opacity 0.3s ease;
        }

        /* Main Container */
        .login-wrap {
            position: relative;
            z-index: 10;
            width: 100%;
            max-width: 370px;
        }

        /* Minimalist Elevated Bento Card */
        .login-card {
            background: var(--mono-surface);
            border: 1px solid var(--mono-border);
            border-radius: 14px;
            padding: 34px 28px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
            transition: border-color 0.2s ease;
        }

        /* Header block */
        .brand-header {
            text-align: center;
            margin-bottom: 28px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .brand-icon {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            background: var(--mono-field);
            border: 1px solid var(--mono-border);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 14px;
            color: var(--mono-text);
        }

        .brand-badge {
            display: inline-block;
            font-size: 11px;
            font-family: var(--font-mono);
            letter-spacing: 0.04em;
            padding: 2px 7px;
            background: rgba(255, 255, 255, 0.05);
            color: var(--mono-muted);
            border: 1px solid var(--mono-border);
            border-radius: 4px;
            margin-bottom: 8px;
            text-transform: uppercase;
        }

        h1 {
            font-size: 19px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--mono-text);
            margin-bottom: 4px;
        }

        .subtitle {
            font-size: 12px;
            color: var(--mono-muted);
            line-height: 1.5;
        }

        /* Form Controls */
        form {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        /* Borderless Filled Field with floating label logic */
        .field-box {
            position: relative;
            background: var(--mono-field);
            border: 1px solid var(--mono-border);
            border-radius: 8px;
            transition: background-color 0.15s ease, border-color 0.15s ease;
            height: 52px;
            display: flex;
            align-items: center;
            padding: 0 14px;
        }

        .field-box:hover {
            background: var(--mono-field-focus);
            border-color: var(--mono-border-focus);
        }

        .field-box:focus-within {
            background: var(--mono-field-focus);
            border-color: rgba(255, 255, 255, 0.4);
        }

        .field-icon {
            width: 17px;
            height: 17px;
            color: var(--mono-dim);
            flex-shrink: 0;
            margin-right: 12px;
            pointer-events: none;
            transition: color 0.15s ease;
        }

        .field-box:focus-within .field-icon {
            color: var(--mono-text);
        }

        .field-input-wrap {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
        }

        .field-input {
            width: 100%;
            height: 100%;
            background: transparent;
            border: none;
            outline: none;
            color: var(--mono-text);
            font-size: 13.5px;
            font-family: var(--font-mono);
            letter-spacing: 0.05em;
            padding-top: 14px;
            padding-bottom: 2px;
        }

        .floating-label {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 12px;
            color: var(--mono-muted);
            pointer-events: none;
            transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), font-size 0.18s ease, color 0.18s ease;
            letter-spacing: -0.01em;
        }

        .field-input:focus ~ .floating-label,
        .field-input:not(:placeholder-shown) ~ .floating-label {
            transform: translateY(-16px);
            font-size: 10px;
            color: var(--mono-muted);
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .toggle-vis-btn {
            background: transparent;
            border: none;
            color: var(--mono-muted);
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease;
        }

        .toggle-vis-btn:hover {
            color: var(--mono-text);
        }

        /* Material Ripple */
        .ripple {
            position: absolute;
            border-radius: 50%;
            transform: scale(0);
            animation: ripple-effect 0.5s linear;
            background-color: rgba(0, 0, 0, 0.2);
            pointer-events: none;
        }

        @keyframes ripple-effect {
            to {
                transform: scale(3.5);
                opacity: 0;
            }
        }

        /* Primary Minimalist Button */
        .submit-btn {
            position: relative;
            overflow: hidden;
            width: 100%;
            padding: 12px 16px;
            background: var(--mono-btn-bg);
            color: var(--mono-btn-text);
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            font-family: var(--font-ui);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 8px;
            transition: background-color 0.15s ease, transform 0.08s ease;
        }

        .submit-btn:hover {
            background: var(--mono-btn-hover);
        }

        .submit-btn:active {
            transform: scale(0.985);
        }

        .submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .spinner {
            display: none;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(0, 0, 0, 0.2);
            border-top-color: #111215;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Toast notification banner */
        .toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(16px);
            background: #1e2027;
            border: 1px solid var(--mono-border);
            color: var(--mono-text);
            font-size: 12px;
            padding: 9px 16px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            pointer-events: none;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 50;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        .toast-error {
            border-color: rgba(248, 113, 113, 0.3);
            color: #fca5a5;
        }
    </style>
</head>
<body>

    <!-- Ambient Layer -->
    <div class="bg-layer">
        <div class="bg-dots"></div>
        <div class="bg-light-source" id="lightSource"></div>
    </div>

    <!-- Login Container -->
    <div class="login-wrap">
        <div class="login-card">
            
            <div class="brand-header">
                <div class="brand-badge">MultiAI Cloud</div>
                <div class="brand-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <h1>Security Checkpoint</h1>
                <p class="subtitle">Enter master security password to access console</p>
            </div>

            <form id="loginForm" autocomplete="off">
                <!-- Master Security Password Field -->
                <div class="field-box">
                    <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>

                    <div class="field-input-wrap">
                        <input 
                            type="password" 
                            id="passInput" 
                            class="field-input" 
                            placeholder=" " 
                            required 
                            autofocus
                        />
                        <label for="passInput" class="floating-label">Security Key</label>
                    </div>

                    <button type="button" class="toggle-vis-btn" id="toggleVisBtn" aria-label="Toggle password visibility">
                        <svg id="eyeSvg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                </div>

                <!-- Submit Button with Ink Ripple -->
                <button type="submit" class="submit-btn" id="submitBtn">
                    <span id="btnText">Unlock MultiAI</span>
                    <svg id="btnIcon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                    <div class="spinner" id="btnSpinner"></div>
                </button>
            </form>

        </div>
    </div>

    <!-- Minimal Toast -->
    <div id="toast" class="toast">
        <span id="toastMsg"></span>
    </div>

    <script>
        // Track pointer for ambient light source
        window.addEventListener("pointermove", (e) => {
            document.documentElement.style.setProperty("--mouse-x", e.clientX + "px");
            document.documentElement.style.setProperty("--mouse-y", e.clientY + "px");
        });

        // Setup Ripple on buttons
        const submitBtn = document.getElementById("submitBtn");
        submitBtn.addEventListener("click", function(e) {
            const rect = this.getBoundingClientRect();
            const circle = document.createElement("span");
            const diameter = Math.max(rect.width, rect.height);
            const radius = diameter / 2;
            circle.style.width = circle.style.height = diameter + "px";
            circle.style.left = (e.clientX - rect.left - radius) + "px";
            circle.style.top = (e.clientY - rect.top - radius) + "px";
            circle.classList.add("ripple");
            const existing = this.querySelector(".ripple");
            if (existing) existing.remove();
            this.appendChild(circle);
        });

        // Toggle password visibility
        let isPassVisible = false;
        const passInput = document.getElementById("passInput");
        const toggleVisBtn = document.getElementById("toggleVisBtn");
        const eyeSvg = document.getElementById("eyeSvg");

        toggleVisBtn.addEventListener("click", () => {
            isPassVisible = !isPassVisible;
            passInput.type = isPassVisible ? "text" : "password";
            eyeSvg.innerHTML = isPassVisible
                ? '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'
                : '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
        });

        // Toast utility
        let toastTimer;
        function showToast(message, isError = false) {
            const toast = document.getElementById("toast");
            const msg = document.getElementById("toastMsg");
            msg.textContent = message;
            toast.className = "toast show" + (isError ? " toast-error" : "");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.className = "toast";
            }, 3500);
        }

        // Form submission
        const form = document.getElementById("loginForm");
        const btnText = document.getElementById("btnText");
        const btnIcon = document.getElementById("btnIcon");
        const btnSpinner = document.getElementById("btnSpinner");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const pass = passInput.value.trim();
            if (!pass) return;

            submitBtn.disabled = true;
            btnText.style.display = "none";
            btnIcon.style.display = "none";
            btnSpinner.style.display = "block";

            try {
                const res = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password: pass })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    showToast("Access granted. Loading console...");
                    setTimeout(() => window.location.reload(), 400);
                } else {
                    showToast(data.error || "Invalid security key. Access denied.", true);
                    passInput.value = "";
                    passInput.focus();
                }
            } catch (err) {
                showToast("Network error: " + err.message, true);
            } finally {
                submitBtn.disabled = false;
                btnText.style.display = "inline";
                btnIcon.style.display = "inline";
                btnSpinner.style.display = "none";
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

