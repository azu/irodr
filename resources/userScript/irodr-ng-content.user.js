// ==UserScript==
// @name        irodir: ng contents
// @namespace   irodr.netlify.app.ng-contents
// @description NG content and replace dummy content when match NGList
// @include     http://irodr.netlify.app/
// @include     https://irodr.netlify.app/
// @include     http://localhost:13245/
// @version     1
// @grant       none
// @run-at      document-end
// ==/UserScript==
"use strict";
const NGList = [
    {
        title: /^AD:/
    },
    {
        title: /^PR:/
    },
    {
        title: /^\[AD]/
    }
    // {
    //     url: /^http:\/\/block.example.com\//
    // }
];
window.addEventListener("userscript-init", () => {
    userScript.event.subscribe("SubscriptionContent::componentDidMount", content => {
        const isMatchAnyNG = NGList.some(NGItem => {
            let isNG = false;
            if (NGItem.title) {
                isNG = NGItem.title.test(content.title);
            }
            if (NGItem.url) {
                isNG = NGItem.url.test(content.url);
            }
            return isNG;
        });
        if (!isMatchAnyNG) {
            return;
        }
        const element = document.querySelector(`[data-content-id="${content.contentId}"]`);
        if (element) {
            element.querySelector(".SubscriptionContentsContainer-contentTitle").classList.add("ng-content");
            element.querySelector(".SubscriptionContentsContainer-contentBody").setAttribute("hidden", "");
        }
    });
});
