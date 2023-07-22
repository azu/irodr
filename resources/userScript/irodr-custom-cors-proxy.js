// ==UserScript==
// @name        irodr: custom cors proxy
// @namespace   https://irodr.netlify.app/
// @match       https://irodr.netlify.app/
// @grant       none
// @version     1.0
// @author      azu
// @description Use own cors proxy
// @run-at document-start
// ==/UserScript==
// Define your cors proxy url
localStorage.setItem("REACT_APP_CORS_PROXY", "https://your-cors-proxy.com/");
