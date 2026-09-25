/**
 * Safety Net Characterization Tests for Composer Attachments & Utilities
 */
import assert from "node:assert/strict";
import {
    isImageFile,
    formatFileSize,
    stagedAttachments,
    clearStagedAttachments
} from "../client/src/components/composer-attachments.js";

console.log("=== Running Safety Net Tests for Composer Attachments ===");

// 1. isImageFile tests
console.log("Test: isImageFile");
assert.equal(isImageFile(null), false);
assert.equal(isImageFile(undefined), false);
assert.equal(isImageFile({ type: "image/png", name: "diagram.png" }), true);
assert.equal(isImageFile({ type: "image/jpeg", name: "photo.jpg" }), true);
assert.equal(isImageFile({ type: "image/webp", name: "banner.webp" }), true);
assert.equal(isImageFile({ type: "image/gif", name: "anim.gif" }), true);
assert.equal(isImageFile({ type: "image/svg+xml", name: "icon.svg" }), true);
assert.equal(isImageFile({ type: "", name: "icon.SVG" }), true);
assert.equal(isImageFile({ type: "", name: "snapshot.heic" }), true);
assert.equal(isImageFile({ type: "", name: "test.avif" }), true);
assert.equal(isImageFile({ type: "text/plain", name: "notes.txt" }), false);
assert.equal(isImageFile({ type: "application/json", name: "data.json" }), false);
assert.equal(isImageFile({ type: "application/pdf", name: "doc.pdf" }), false);

// 2. formatFileSize tests
console.log("Test: formatFileSize");
assert.equal(formatFileSize(0), "0 B");
assert.equal(formatFileSize(-10), "0 B");
assert.equal(formatFileSize(100), "100 B");
assert.equal(formatFileSize(1024), "1 KB");
assert.equal(formatFileSize(1024 * 500), "500 KB");
assert.equal(formatFileSize(1024 * 1024), "1 MB");
assert.equal(formatFileSize(1024 * 1024 * 2.5), "2.5 MB");

// 3. stagedAttachments lifecycle
console.log("Test: stagedAttachments & clearStagedAttachments");
clearStagedAttachments();
assert.equal(stagedAttachments.length, 0);

stagedAttachments.push({ type: "image", name: "test.png", size: 1024 });
stagedAttachments.push({ type: "document", name: "readme.md", size: 2048 });
assert.equal(stagedAttachments.length, 2);

const cleared = clearStagedAttachments();
assert.equal(cleared.length, 2);
assert.equal(cleared[0].name, "test.png");
assert.equal(cleared[1].name, "readme.md");
assert.equal(stagedAttachments.length, 0);

console.log("✓ ALL COMPOSER ATTACHMENTS SAFETY NET TESTS PASSED CLEANLY!");
