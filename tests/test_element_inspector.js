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
assert(!cssContent.includes(".inspector-pulse-dot"), "Blinking blue indicator must be removed");
assert(cssContent.includes('[data-ui-style="classics"] .element-inspector-bar'), "Must have classics style for element-inspector-bar");
assert(cssContent.includes('[data-ui-style="classics"] .inspector-cancel-btn'), "Must have classics style for cancel button");
console.log("✓ element-inspector.css rules verified cleanly.");

// 2. Verify component JS exports
const jsPath = path.join(__dirname, "../UI/webui/src/components/element-inspector.js");
assert(fs.existsSync(jsPath), "element-inspector.js must exist");
const jsContent = fs.readFileSync(jsPath, "utf-8");
assert(!jsContent.includes("inspector-pulse-dot"), "Blinking blue indicator dot must be removed from inspector bar DOM");
assert(jsContent.includes("export function startElementInspection"), "Must export startElementInspection");
assert(jsContent.includes("export function stopElementInspection"), "Must export stopElementInspection");
assert(jsContent.includes("export function toggleElementInspection"), "Must export toggleElementInspection");
assert(jsContent.includes("MULTIAI_ELEMENT_SELECTED"), "Must listen for iframe element selection events");
assert(jsContent.includes("MULTIAI_ELEMENT_HOVER"), "Must listen for iframe element hover events to show pop up bubble");
assert(jsContent.includes("MULTIAI_ELEMENT_UNHOVER"), "Must listen for iframe element unhover events");
console.log("✓ element-inspector.js interface and cross-frame event listeners verified cleanly.");

// 2.B Verify browser proxy injection sends MULTIAI_ELEMENT_HOVER
const proxyPath = path.join(__dirname, "../src/server/routes/browser_proxy.js");
const proxyContent = fs.readFileSync(proxyPath, "utf-8");
assert(proxyContent.includes("MULTIAI_ELEMENT_HOVER"), "browser_proxy.js must post MULTIAI_ELEMENT_HOVER on iframe hover");
assert(proxyContent.includes("MULTIAI_ELEMENT_UNHOVER"), "browser_proxy.js must post MULTIAI_ELEMENT_UNHOVER on mouseleave/deactivate");
assert(proxyContent.includes("MULTIAI_ELEMENT_SELECTED"), "browser_proxy.js must post MULTIAI_ELEMENT_SELECTED on click");
console.log("✓ browser_proxy.js iframe inspector cross-frame message dispatching verified cleanly.");

// 3. Verify HTML bindings
const htmlPath = path.join(__dirname, "../UI/webui/index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
assert(htmlContent.includes("element-inspector.css"), "index.html must link element-inspector.css");
assert(htmlContent.includes('id="pickElementBtn"'), "index.html must have #pickElementBtn in attach sheet");
assert(htmlContent.includes('id="browserInspectBtn"'), "index.html must have #browserInspectBtn in browser omnibox");
console.log("✓ HTML attachment drawer & omnibox inspection buttons verified.");

// 4. Verify Composer prompt context injection and Universal Inline Entity Module
const composerPath = path.join(__dirname, "../UI/webui/src/components/composer.js");
const composerContent = fs.readFileSync(composerPath, "utf-8");
assert(composerContent.includes("<user_selected_ui_element>"), "Composer must format element into <user_selected_ui_element>");
assert(composerContent.includes("formatMessageWithInlineEntities"), "Composer must format messages with inline entities");
assert(composerContent.includes("extractEntitiesFromText"), "Composer must extract inline entities from prompt text");
console.log("✓ Composer prompt context and inline entity integration verified.");

// 5. Verify Universal Inline Entity module
const inlineEntityPath = path.join(__dirname, "../UI/webui/src/components/inline-entity.js");
assert(fs.existsSync(inlineEntityPath), "inline-entity.js must exist");
const inlineContent = fs.readFileSync(inlineEntityPath, "utf-8");
assert(inlineContent.includes("export function insertInlineEntity"), "Must export insertInlineEntity");
assert(inlineContent.includes("export function formatMessageWithInlineEntities"), "Must export formatMessageWithInlineEntities");
assert(inlineContent.includes("export function extractEntitiesFromText"), "Must export extractEntitiesFromText");
assert(inlineContent.includes("export function registerEntity"), "Must export registerEntity");

// 6. Verify chat-ui imports inline entities for history render
const chatUiPath = path.join(__dirname, "../UI/webui/src/components/chat-ui.js");
const chatUiContent = fs.readFileSync(chatUiPath, "utf-8");
assert(chatUiContent.includes("formatMessageWithInlineEntities"), "chat-ui.js must import and use formatMessageWithInlineEntities for loaded turns");
console.log("✓ Universal inline entity module and history re-rendering verified.");

console.log("\nALL ELEMENT INSPECTOR TESTS PASSED CLEANLY!");
