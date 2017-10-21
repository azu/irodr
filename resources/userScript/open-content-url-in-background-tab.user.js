// ==UserScript==
// @name        irodir: open content in background tab
// @namespace   irodr.netlify.com.background-tab
// @description Open content url background-Tab by n key
// @include     http://irodr.netlify.com/
// @include     https://irodr.netlify.com/
// @include     http://localhost:13245/
// @version     1
// @grant       GM_openInTab
// @run-at      document-end
// ==/UserScript==

const w = unsafeWindow || window;
const N_KEY = "n";

function nKeyHandler() {
    const activeContent = w.userScript.getActiveContent();
    if (activeContent) {
        GM_openInTab(activeContent.url);
    }
    w.userScript.triggerKey("j");
}

document.body.addEventListener("keyup", event => {
    if (event.key === N_KEY) {
        nKeyHandler();
    }
});
