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

// In-memory challenge store for lightweight math CAPTCHA (id -> { answer, expiresAt })
const captchaChallenges = new Map();
const CAPTCHA_TTL_MS = 3 * 60 * 1000; // 3 minutes

function generateCaptcha() {
    // Clean up expired captchas
    const now = Date.now();
    for (const [id, c] of captchaChallenges.entries()) {
        if (now > c.expiresAt) captchaChallenges.delete(id);
    }

    const a = Math.floor(Math.random() * 12) + 2;
    const b = Math.floor(Math.random() * 9) + 1;
    const isAdd = Math.random() > 0.4;
    const question = isAdd ? `${a} + ${b}` : `${Math.max(a, b)} - ${Math.min(a, b)}`;
    const answer = String(isAdd ? a + b : Math.max(a, b) - Math.min(a, b));
    const id = crypto.randomBytes(16).toString("hex");

    captchaChallenges.set(id, { answer, expiresAt: now + CAPTCHA_TTL_MS });
    return { id, question };
}

function verifyCaptcha(id, userInput) {
    if (!id || typeof userInput === "undefined") return false;
    const record = captchaChallenges.get(id);
    if (!record) return false;
    captchaChallenges.delete(id); // Single use
    if (Date.now() > record.expiresAt) return false;
    return String(userInput).trim() === record.answer;
}

function handleCaptchaEndpoint(req, res) {
    const captcha = generateCaptcha();
    return sendJSON(res, 200, {
        id: captcha.id,
        question: captcha.question
    });
}

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
                return res.end(JSON.stringify({ success: true, token }));
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

function renderLockPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login</title>
    <style>
        :root {
            --mono-bg: #0c0d10;
            --mono-surface: #14151a;
            --mono-surface-hover: #1a1c23;
            --mono-field: #1b1d24;
            --mono-field-focus: #21242e;
            --mono-border: rgba(255, 255, 255, 0.08);
            --mono-border-focus: rgba(255, 255, 255, 0.28);
            --mono-text: #f3f4f6;
            --mono-muted: #8b909f;
            --mono-dim: #5a5f70;
            --mono-btn-bg: #ededed;
            --mono-btn-text: #0c0d10;
            --mono-btn-hover: #ffffff;
            --mono-error: #f87171;
            --font-ui: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
            max-width: 360px;
        }

        /* Minimalist Elevated Bento Card */
        .login-card {
            background: var(--mono-surface);
            border: 1px solid var(--mono-border);
            border-radius: 12px;
            padding: 34px 26px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
        }

        /* Header block */
        .header-block {
            text-align: left;
            margin-bottom: 26px;
        }

        h1 {
            font-size: 19px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--mono-text);
            margin-bottom: 6px;
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
            gap: 14px;
        }

        .field-box {
            position: relative;
            background: var(--mono-field);
            border: 1px solid var(--mono-border);
            border-radius: 8px;
            transition: background-color 0.15s ease, border-color 0.15s ease;
            height: 50px;
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
            width: 16px;
            height: 16px;
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
            font-size: 13px;
            font-family: var(--font-ui);
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
        }

        .field-input:focus ~ .floating-label,
        .field-input:not(:placeholder-shown) ~ .floating-label {
            transform: translateY(-15px);
            font-size: 10px;
            color: var(--mono-muted);
            letter-spacing: 0.04em;
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

        /* Captcha Box */
        .captcha-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .captcha-challenge {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 12px;
            height: 50px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--mono-border);
            border-radius: 8px;
            flex: 1;
            font-size: 12px;
            color: var(--mono-text);
            user-select: none;
        }

        .captcha-question {
            font-weight: 600;
            letter-spacing: 0.05em;
            color: var(--mono-text);
        }

        .refresh-captcha-btn {
            background: transparent;
            border: none;
            color: var(--mono-dim);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, transform 0.2s ease;
        }

        .refresh-captcha-btn:hover {
            color: var(--mono-text);
            transform: rotate(45deg);
        }

        .captcha-input-box {
            width: 100px;
            flex-shrink: 0;
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
            margin-top: 6px;
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
            border-top-color: #0c0d10;
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
            background: #1b1d24;
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
            
            <div class="header-block">
                <h1>Login</h1>
                <p class="subtitle">Please enter your password</p>
            </div>

            <form id="loginForm" autocomplete="off">
                <!-- Security Password Field -->
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
                        <label for="passInput" class="floating-label">Password</label>
                    </div>

                    <button type="button" class="toggle-vis-btn" id="toggleVisBtn" aria-label="Toggle password visibility">
                        <svg id="eyeSvg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                </div>

                <!-- CAPTCHA Verification Row -->
                <div class="captcha-row">
                    <div class="captcha-challenge">
                        <span id="captchaText" class="captcha-question">Loading challenge…</span>
                        <button type="button" class="refresh-captcha-btn" id="refreshCaptchaBtn" title="Refresh challenge">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                                <path d="M3 3v5h5"/>
                            </svg>
                        </button>
                    </div>

                    <div class="field-box captcha-input-box">
                        <div class="field-input-wrap">
                            <input 
                                type="text" 
                                id="captchaInput" 
                                class="field-input" 
                                placeholder=" " 
                                required
                            />
                            <label for="captchaInput" class="floating-label">Answer</label>
                        </div>
                    </div>
                </div>

                <!-- Submit Button with Ink Ripple -->
                <button type="submit" class="submit-btn" id="submitBtn">
                    <span id="btnText">Unlock</span>
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

        // CAPTCHA Management
        let currentCaptchaId = "";
        const captchaText = document.getElementById("captchaText");
        const captchaInput = document.getElementById("captchaInput");
        const refreshCaptchaBtn = document.getElementById("refreshCaptchaBtn");

        async function fetchCaptcha() {
            try {
                captchaText.textContent = "…";
                const res = await fetch("/api/auth/captcha");
                const data = await res.json();
                if (data.id && data.question) {
                    currentCaptchaId = data.id;
                    captchaText.textContent = data.question + " = ?";
                    captchaInput.value = "";
                }
            } catch (e) {
                captchaText.textContent = "Error loading";
            }
        }

        refreshCaptchaBtn.addEventListener("click", fetchCaptcha);
        fetchCaptcha();

        // Form submission
        const form = document.getElementById("loginForm");
        const btnText = document.getElementById("btnText");
        const btnSpinner = document.getElementById("btnSpinner");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const pass = passInput.value.trim();
            const answer = captchaInput.value.trim();

            if (!pass) return;
            if (!answer) {
                showToast("Please solve the verification challenge.", true);
                captchaInput.focus();
                return;
            }

            submitBtn.disabled = true;
            btnText.style.display = "none";
            btnSpinner.style.display = "block";

            try {
                const res = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        password: pass,
                        captchaId: currentCaptchaId,
                        captchaAnswer: answer
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    showToast("Access granted. Loading console...");
                    setTimeout(() => window.location.reload(), 300);
                } else {
                    showToast(data.error || "Access denied.", true);
                    if (data.needNewCaptcha) {
                        fetchCaptcha();
                    }
                    passInput.value = "";
                    passInput.focus();
                }
            } catch (err) {
                showToast("Network error: " + err.message, true);
                fetchCaptcha();
            } finally {
                submitBtn.disabled = false;
                btnText.style.display = "inline";
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
    handleCaptchaEndpoint,
    renderLockPage
};

