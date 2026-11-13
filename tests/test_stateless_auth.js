const assert = require("assert");
const crypto = require("crypto");

process.env.CLOUD_PASSWORD = "test-verification-secret-pass";

// Require auth module
const auth = require("../src/server/auth");

console.log("=== Testing Stateless HMAC Session Verification ===");

// 1. Verify that generating a token works
// Test internal HMAC token generation logic
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const expiresAt = Date.now() + SESSION_TTL_MS;
const entropy = crypto.randomBytes(16).toString("hex");
const payload = `${expiresAt}:${entropy}`;
const sig = crypto.createHmac("sha256", process.env.CLOUD_PASSWORD).update(payload).digest("hex");
const validToken = `${payload}.${sig}`;

console.log("1. Validating freshly generated HMAC token via isAuthenticated mock...");
const reqWithValidToken = {
    headers: {
        cookie: `multiai_token=${validToken}`
    }
};
assert.strictEqual(auth.isAuthenticated(reqWithValidToken), true, "Valid HMAC token should authenticate");
console.log("   ✓ Fresh HMAC token authenticated successfully.");

console.log("2. Validating tampered token signature rejection...");
const tamperedToken = `${payload}.tampered_fake_signature_hex`;
const reqWithTamperedToken = {
    headers: {
        cookie: `multiai_token=${tamperedToken}`
    }
};
assert.strictEqual(auth.isAuthenticated(reqWithTamperedToken), false, "Tampered token must be rejected");
console.log("   ✓ Tampered signature rejected.");

console.log("3. Validating expired token rejection...");
const expiredPayload = `${Date.now() - 1000}:${entropy}`;
const expiredSig = crypto.createHmac("sha256", process.env.CLOUD_PASSWORD).update(expiredPayload).digest("hex");
const expiredToken = `${expiredPayload}.${expiredSig}`;
const reqWithExpiredToken = {
    headers: {
        cookie: `multiai_token=${expiredToken}`
    }
};
assert.strictEqual(auth.isAuthenticated(reqWithExpiredToken), false, "Expired token must be rejected");
console.log("   ✓ Expired HMAC token rejected.");

console.log("4. Validating Bearer token master password authentication...");
const reqWithBearer = {
    headers: {
        authorization: `Bearer ${process.env.CLOUD_PASSWORD}`
    }
};
assert.strictEqual(auth.isAuthenticated(reqWithBearer), true, "Bearer master password should authenticate");
console.log("   ✓ Bearer master password authenticated.");

console.log("\n✓ ALL STATELESS AUTH TESTS PASSED CLEANLY!");
