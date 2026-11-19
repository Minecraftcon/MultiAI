const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Mobile Side Panel Pinned Settings Footer ===");

const panelCss = fs.readFileSync(path.join(__dirname, "../UI/webui/styles/panel.css"), "utf-8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../UI/webui/index.html"), "utf-8");

// 1. The settings footer must live outside the scrollable .panel-body
const panelBodyMatch = indexHtml.match(/<div class="panel-body">([\s\S]*?)\n {4}<\/div>\n\n {4}<!-- Footer/);
assert(panelBodyMatch, "index.html must keep .panel-body closed before the panel footer");
assert(!panelBodyMatch[1].includes("panelSettingsBtn"), "Settings button must not sit inside the scrollable .panel-body");
assert(indexHtml.includes('class="panel-footer"'), "index.html must render a .panel-footer region");
assert(indexHtml.includes('id="panelSettingsBtn"'), "index.html must render the settings button");

// 2. Extract the mobile media block and the Android fallback block
function blocksFor(css, marker) {
    const out = [];
    let idx = 0;
    while ((idx = css.indexOf(marker, idx)) !== -1) {
        const open = css.indexOf("{", idx);
        let depth = 0;
        for (let i = open; i < css.length; i++) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") {
                depth--;
                if (depth === 0) {
                    out.push(css.slice(idx, i + 1));
                    idx = i + 1;
                    break;
                }
            }
        }
        if (depth !== 0) throw new Error(`Unbalanced braces after ${marker}`);
    }
    assert(out.length > 0, `Missing CSS block marker: ${marker}`);
    return out;
}

function blockFor(css, marker, needle) {
    const found = blocksFor(css, marker).find(b => b.includes(needle));
    assert(found, `Missing CSS block "${marker}" containing "${needle}"`);
    return found;
}

const mobileBlock = blockFor(panelCss, "@media (max-width: 768px)", ".panel-footer");

// Android rules are written as individual selectors, not one wrapper block.
const androidStart = panelCss.indexOf("html.is-android #sidePanel,");
const androidEnd = panelCss.indexOf("/* ====", androidStart);
assert(androidStart >= 0 && androidEnd > androidStart, "Missing html.is-android side panel section");
const androidSection = panelCss.slice(androidStart, androidEnd);
const androidBlock = androidSection;

function footerRule(block, label) {
    const matches = [...block.matchAll(/([^{}]*panel-footer[^{}]*)\{([^}]*)\}/g)];
    const rule = matches.find(m => m[1].includes("#sidePanel") || m[1].includes(".side-panel"));
    assert(rule, `${label}: missing .panel-footer rule`);
    return rule[2];
}

const mobileFooter = footerRule(mobileBlock, "mobile media query");
const androidFooter = footerRule(androidBlock, "android fallback");

for (const [label, rule] of [["mobile", mobileFooter], ["android", androidFooter]]) {
    assert(/position:\s*sticky/.test(rule), `${label}: .panel-footer must use position: sticky so it is pinned, not scrolled away`);
    assert(/bottom:\s*0/.test(rule), `${label}: .panel-footer must be pinned with bottom: 0`);
    assert(!/position:\s*static/.test(rule), `${label}: .panel-footer must not fall back to position: static`);
    // The gradient padding must not swallow taps on the settings button row.
    assert(/pointer-events:\s*none/.test(rule), `${label}: .panel-footer padding must not capture pointer events`);
}

// 3. The button itself must stay tappable and above the fading gradient
for (const [label, block] of [["mobile", mobileBlock], ["android", androidBlock]]) {
    const hasBtn = /panel-footer-btn[^{}]*\{[^}]*pointer-events:\s*auto/.test(block)
        || /panel-footer-btn[^{}]*\{[^}]*pointer-events:\s*auto/.test(panelCss);
    assert(hasBtn, `${label}: .panel-footer-btn must keep pointer-events: auto`);
}

const zIndex = (panelCss.match(/\.panel-footer\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
assert(zIndex && parseInt(zIndex, 10) >= 20, `.panel-footer z-index (${zIndex}) must sit above panel content`);

// 4. Panel body itself must remain the scrolling surface on mobile
assert(/panel-body[^{}]*\{[^}]*overflow-y:\s*visible/.test(mobileBlock),
    "mobile: .panel-body should not double-scroll; the panel is the single scroll container");
assert(/#sidePanel,\s*\n?\s*\.side-panel\s*\{[^}]*overflow-y:\s*auto/.test(mobileBlock),
    "mobile: the side panel must be the scrolling surface");

console.log("✓ Mobile settings footer stays pinned to the bottom and remains tappable");
