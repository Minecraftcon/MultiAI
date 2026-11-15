const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Panel Z-Index & Small-Screen Stacking Hierarchy ===");

// 1. Read right-panel.css
const rightPanelCss = fs.readFileSync(path.join(__dirname, "../UI/webui/styles/right-panel.css"), "utf-8");
const composerCss = fs.readFileSync(path.join(__dirname, "../UI/webui/styles/composer.css"), "utf-8");
const panelCss = fs.readFileSync(path.join(__dirname, "../UI/webui/styles/panel.css"), "utf-8");
const layoutCss = fs.readFileSync(path.join(__dirname, "../UI/webui/styles/layout.css"), "utf-8");

// Parse z-index values
function extractZIndex(css, selector) {
    const regex = new RegExp(selector + "\\s*\\{[^}]*z-index:\\s*(\\d+)", "m");
    const m = css.match(regex);
    return m ? parseInt(m[1], 10) : null;
}

const rightPanelZ = extractZIndex(rightPanelCss, "#rightPanel");
const rightBackdropZ = extractZIndex(rightPanelCss, "\\.right-panel-backdrop");
const inputAreaZ = extractZIndex(composerCss, "#inputArea");
const sidePanelZ = extractZIndex(panelCss, "#sidePanel,\\s*\\.side-panel");
const leftBackdropZ = extractZIndex(layoutCss, "#backdrop");

console.log(`z-indexes:
  #rightPanel: ${rightPanelZ}
  .right-panel-backdrop: ${rightBackdropZ}
  #sidePanel: ${sidePanelZ}
  #backdrop: ${leftBackdropZ}
  #inputArea: ${inputAreaZ}`);

assert(rightPanelZ !== null && rightPanelZ > inputAreaZ, `#rightPanel (${rightPanelZ}) must be higher than #inputArea (${inputAreaZ})`);
assert(rightBackdropZ !== null && rightBackdropZ > inputAreaZ, `.right-panel-backdrop (${rightBackdropZ}) must be higher than #inputArea (${inputAreaZ})`);
assert(sidePanelZ !== null && sidePanelZ > inputAreaZ, `#sidePanel (${sidePanelZ}) must be higher than #inputArea (${inputAreaZ})`);
assert(leftBackdropZ !== null && leftBackdropZ > inputAreaZ, `#backdrop (${leftBackdropZ}) must be higher than #inputArea (${inputAreaZ})`);

// 2. Check small-screen rules in right-panel.css
assert(rightPanelCss.includes("body.right-panel-open #inputArea"), "Must hide #inputArea when body.right-panel-open on small screens");
assert(rightPanelCss.includes("body.right-panel-open .chat-scroll-btn"), "Must hide .chat-scroll-btn when body.right-panel-open on small screens");

console.log("✓ All z-index hierarchy and small-screen panel rules verified cleanly!");
