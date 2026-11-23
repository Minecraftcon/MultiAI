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

console.log("✓ All Running Tasks Timer tests passed successfully!");
