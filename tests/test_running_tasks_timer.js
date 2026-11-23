const assert = require("assert");

function normalizeTimestampSec(ts) {
    if (!ts) return null;
    const num = Number(ts);
    if (isNaN(num) || num <= 0) return null;
    return num > 1e11 ? Math.round(num / 1000) : Math.round(num);
}

function calculateElapsed(startTime, nowMs) {
    const startSec = normalizeTimestampSec(startTime);
    if (!startSec) return null;
    const nowSec = Math.round(nowMs / 1000);
    return Math.max(1, nowSec - startSec);
}

console.log("=== Testing Running Tasks Timer & Epoch Normalization ===");

const nowMs = 1795453380000; // e.g. T=0

// 1. Task started 65 seconds ago with Node.js millisecond timestamp (Date.now())
const startMs = nowMs - 65000;
const elapsedFromMs = calculateElapsed(startMs, nowMs);
assert.strictEqual(elapsedFromMs, 65, "Elapsed from milliseconds timestamp should be 65s");

// 2. Task started 65 seconds ago with Go second timestamp (time.Now().Unix())
const startSec = Math.round(startMs / 1000);
const elapsedFromSec = calculateElapsed(startSec, nowMs);
assert.strictEqual(elapsedFromSec, 65, "Elapsed from seconds timestamp should be 65s");

// 3. Increment nowMs by 5 seconds -> elapsed should tick to 70s
const nowPlus5 = nowMs + 5000;
const elapsedTicked = calculateElapsed(startMs, nowPlus5);
assert.strictEqual(elapsedTicked, 70, "Timer tick should advance elapsed duration to 70s");

// 4. Verify old bug reproduced when unnormalized:
// Math.max(1, Math.round(nowMs / 1000 - startMs)) produces 1 because nowSec - startMs < 0
const buggyElapsed = Math.max(1, Math.round(nowMs / 1000 - startMs));
assert.strictEqual(buggyElapsed, 1, "Old bug locked elapsed at 1s");

function formatDuration(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return "0s";
    const s = Math.round(sec);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m < 60) {
        return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
    }
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

// 5. Test formatDuration formatting across seconds, minutes, hours
assert.strictEqual(formatDuration(0), "0s");
assert.strictEqual(formatDuration(1), "1s");
assert.strictEqual(formatDuration(45), "45s");
assert.strictEqual(formatDuration(60), "1m");
assert.strictEqual(formatDuration(65), "1m 5s");
assert.strictEqual(formatDuration(120), "2m");
assert.strictEqual(formatDuration(3600), "1h");
assert.strictEqual(formatDuration(3665), "1h 1m");

console.log("✓ All Running Tasks Timer & formatDuration tests passed successfully!");
