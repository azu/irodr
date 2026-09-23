import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadPreferences, savePreferences } from "./app/preferences.ts";
import { Reader } from "./app/reader.ts";
import { loadConfig } from "./config.ts";
import "./global.css";
import { Emitter } from "./lib/emitter.ts";
import { browserWriteLock, createIndexedDBStore } from "./lib/kv-store.ts";
import { safeUrl } from "./lib/sanitize.ts";
import { GitHubSource } from "./sources/github/github-source.ts";
import { InoreaderSource } from "./sources/inoreader/inoreader-source.ts";
import { App } from "./ui/App.tsx";
import { ReaderContext, UserScriptEventsContext } from "./ui/context.tsx";
import { createShortcuts } from "./ui/shortcuts.ts";
import { TranslateMode } from "./ui/translate.ts";
import { installUserScriptApi } from "./ui/userscript.ts";

const config = loadConfig(import.meta.env, localStorage, location.origin);
const fetcher: typeof fetch = (input, init) => fetch(input, init);
const now = () => Date.now();

// Register sources here. The reader and UI work with any `Source`.
const sources = [
    new InoreaderSource({
        baseUrl: config.inoreader.baseUrl,
        corsProxy: config.inoreader.corsProxy,
        redirectUri: config.redirectUri,
        defaultClient: { clientId: config.inoreader.clientId, clientSecret: config.inoreader.clientSecret },
        fetch: fetcher,
        storage: localStorage,
        session: sessionStorage,
        now,
        navigate: (url) => location.assign(url)
    }),
    new GitHubSource({
        apiBaseUrl: config.github.apiBaseUrl,
        webBaseUrl: config.github.webBaseUrl,
        fetch: fetcher,
        now,
        cache: createIndexedDBStore("irodr-sources"),
        credentials: createIndexedDBStore("irodr-source-credentials"),
        lock: browserWriteLock
    })
];

const reader = new Reader({
    sources,
    preferences: loadPreferences(localStorage),
    savePreferences: (preferences) => savePreferences(localStorage, preferences),
    openUrl: (url) => {
        if (safeUrl(url)) window.open(url, "_blank", "noopener");
    },
    scheduleIdle: (task) =>
        "requestIdleCallback" in window ? requestIdleCallback(task, { timeout: 1000 }) : setTimeout(task, 0),
    setInterval: (task, ms) => {
        const id = setInterval(task, ms);
        return () => clearInterval(id);
    }
});

const translate = new TranslateMode((message) => reader.setMessage(message));
const shortcuts = createShortcuts(reader, translate);
const events = new Emitter();
shortcuts.attach(document);

// Leaving a feed turns translate mode off, however the feed was left.
let currentFeedId = reader.getState().list.currentFeedId;
reader.subscribe(() => {
    const next = reader.getState().list.currentFeedId;
    if (next !== currentFeedId) translate.off();
    currentFeedId = next;
});

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");
createRoot(root).render(
    <StrictMode>
        <ReaderContext value={reader}>
            <UserScriptEventsContext value={events}>
                <App />
            </UserScriptEventsContext>
        </ReaderContext>
    </StrictMode>
);

const started = await reader.start(new URL(location.href));
if (started.consumedUrl) history.replaceState(null, "", location.pathname);
// User scripts running at document-end listen after DOMContentLoaded.
if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
}
setTimeout(() => installUserScriptApi(window, reader, shortcuts, events), 0);

Object.assign(window, { irodr: { reader, config } });
