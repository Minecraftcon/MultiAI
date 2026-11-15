const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Element Inspector (Jetski Preview Parity) ===");

// 1. Verify CSS definition
const cssPath = path.join(__dirname, "../UI/webui/styles/element-inspector.css");
assert(fs.existsSync(cssPath), "element-inspector.css must exist");
const cssContent = fs.readFileSync(cssPath, "utf-8");
assert(cssContent.includes(".element-inspector-overlay"), "Must have .element-inspector-overlay");
assert(cssContent.includes(".element-inspector-tooltip"), "Must have .element-inspector-tooltip");
assert(cssContent.includes(".element-inspector-bar"), "Must have .element-inspector-bar");
assert(cssContent.includes(".staged-element-preview"), "Must have .staged-element-preview");
assert(cssContent.includes(".msg-element-pill"), "Must have .msg-element-pill");
console.log("✓ element-inspector.css rules verified cleanly.");

// 2. Verify component JS exports
const jsPath = path.join(__dirname, "../UI/webui/src/components/element-inspector.js");
assert(fs.existsSync(jsPath), "element-inspector.js must exist");
const jsContent = fs.readFileSync(jsPath, "utf-8");
assert(jsContent.includes("export function startElementInspection"), "Must export startElementInspection");
assert(jsContent.includes("export function stopElementInspection"), "Must export stopElementInspection");
assert(jsContent.includes("export function toggleElementInspection"), "Must export toggleElementInspection");
assert(jsContent.includes("MULTIAI_ELEMENT_SELECTED"), "Must listen for iframe element selection events");
console.log("✓ element-inspector.js interface verified cleanly.");

// 3. Verify HTML bindings
const htmlPath = path.join(__dirname, "../UI/webui/index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
assert(htmlContent.includes("element-inspector.css"), "index.html must link element-inspector.css");
assert(htmlContent.includes('id="pickElementBtn"'), "index.html must have #pickElementBtn in attach sheet");
assert(htmlContent.includes('id="browserInspectBtn"'), "index.html must have #browserInspectBtn in browser omnibox");
console.log("✓ HTML attachment drawer & omnibox inspection buttons verified.");

// 4. Verify Composer prompt context injection
const composerPath = path.join(__dirname, "../UI/webui/src/components/composer.js");
const composerContent = fs.readFileSync(composerPath, "utf-8");
assert(composerContent.includes("<user_selected_ui_element>"), "Composer must format element into <user_selected_ui_element>");
assert(composerContent.includes('type === "element"'), "Composer must detect element attachments");
console.log("✓ Composer prompt context injection verified.");

console.log("\nALL ELEMENT INSPECTOR TESTS PASSED CLEANLY!");
