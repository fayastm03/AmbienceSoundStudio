// Automated DOM and CSS hierarchy check for overlay architecture
import { readFileSync } from "node:fs";

console.log("Checking overlay architecture and DOM structure...");

const html = readFileSync("public/index.html", "utf-8");
const baseCss = readFileSync("public/css/base.css", "utf-8");
const compCss = readFileSync("public/css/components.css", "utf-8");
const layoutCss = readFileSync("public/css/layout.css", "utf-8");
const overlayJs = readFileSync("public/js/ui/overlay.js", "utf-8");

const errors = [];

// 1. Check #app-root exists and contains topbar, main, and transport dock
if (!html.includes('<div id="app-root">')) {
  errors.push("Missing #app-root in public/index.html");
}
const appRootContent = html.split('<div id="app-root">')[1]?.split('<div id="overlay-root">')[0] || "";
if (!appRootContent.includes('id="studioTopbar"')) {
  errors.push("#studioTopbar is not inside #app-root");
}
if (!appRootContent.includes('id="studioMain"')) {
  errors.push("#studioMain is not inside #app-root");
}
if (!appRootContent.includes('id="transportDock"')) {
  errors.push("#transportDock is not inside #app-root");
}

// 2. Check #overlay-root exists and contains scrim, popover, panels, modals
if (!html.includes('<div id="overlay-root">')) {
  errors.push("Missing #overlay-root in public/index.html");
}
const overlayRootContent = html.split('<div id="overlay-root">')[1]?.split("</body>")[0] || "";
const requiredInOverlayRoot = [
  'id="overlayScrim"',
  'id="accountPopover"',
  'id="detailPanel"',
  'id="mixesPanel"',
  'id="authModal"',
  'id="shortcutDialog"',
  'id="toastRegion"',
  'id="assistantPanel"',
];
for (const id of requiredInOverlayRoot) {
  if (!overlayRootContent.includes(id)) {
    errors.push(`${id} is not inside #overlay-root`);
  }
}

// 3. Verify no obsolete intra-panel backdrops exist in index.html
if (html.includes("panel-backdrop")) {
  errors.push("Obsolete panel-backdrop found in public/index.html");
}
if (html.includes("auth-backdrop")) {
  errors.push("Obsolete auth-backdrop found in public/index.html");
}
if (html.includes("shortcut-backdrop")) {
  errors.push("Obsolete shortcut-backdrop found in public/index.html");
}

// 4. Verify CSS rule [hidden] { display: none !important; }
if (!baseCss.includes("[hidden]") || !baseCss.includes("display: none !important;")) {
  errors.push("Missing [hidden] { display: none !important; } in public/css/base.css");
}

// 5. Verify Z-index scale order
const zTokens = {
  topbar: 100,
  dock: 110,
  menu: 200,
  scrim: 300,
  panel: 310,
  modal: 400,
  toast: 500,
};
for (const [token, val] of Object.entries(zTokens)) {
  if (!baseCss.includes(`--z-${token}: ${val};`)) {
    errors.push(`Missing or incorrect token --z-${token}: ${val}; in base.css`);
  }
}

// 6. Verify pointer-events rules in components.css
if (!compCss.includes(".overlay-scrim") || !compCss.includes("z-index: var(--z-scrim);")) {
  errors.push("Missing .overlay-scrim styling in components.css");
}
if (!compCss.includes(".panel-content") || !compCss.includes("pointer-events: auto;")) {
  errors.push("Missing pointer-events: auto on .panel-content");
}
if (!compCss.includes(".auth-dialog") || !compCss.includes("pointer-events: auto;")) {
  errors.push("Missing pointer-events: auto on .auth-dialog");
}
if (!compCss.includes(".shortcut-dialog-content") || !compCss.includes("pointer-events: auto;")) {
  errors.push("Missing pointer-events: auto on .shortcut-dialog-content");
}

// 7. Verify overlay.js manages appRoot inert and scrim
if (!overlayJs.includes("getAppRoot") || !overlayJs.includes("getScrim")) {
  errors.push("overlay.js does not query #app-root or #overlayScrim");
}
if (!overlayJs.includes("pointerdown")) {
  errors.push("overlay.js does not use pointerdown for outside click handling");
}

if (errors.length > 0) {
  console.error("FAIL: Overlay check detected errors:");
  errors.forEach((err) => console.error(" - " + err));
  process.exit(1);
} else {
  console.log("PASS: Overlay architecture and DOM verification passed successfully!");
}

