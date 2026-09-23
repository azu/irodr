import type { Reader } from "../app/reader.ts";
import type { Emitter } from "../lib/emitter.ts";
import type { Shortcuts } from "./shortcuts.ts";

export interface UserScriptActiveContent {
    id: string;
    author: string;
    publishedDate: Date;
    updatedDate: Date;
    title: string;
    body: { content: string };
    url: string;
}

export interface UserScriptActiveSubscription {
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
}

export interface UserScriptApi {
    getActiveContent(): UserScriptActiveContent | undefined;
    getActiveSubscription(): UserScriptActiveSubscription | undefined;
    triggerKey(keys: string, action?: string): void;
    registerKey(keys: string, handler: (event?: Event) => void): void;
    getDefaultActions(): Shortcuts["actions"];
    event: Emitter;
}

declare global {
    interface Window {
        userScript?: UserScriptApi;
    }
}

/**
 * `window.userScript`, the API for Greasemonkey-style user scripts.
 * See docs/userscript.md. Dispatches `userscript-init` when ready.
 */
export function installUserScriptApi(
    target: Window,
    reader: Reader,
    shortcuts: Shortcuts,
    events: Emitter
): () => void {
    const api: UserScriptApi = {
        getActiveContent() {
            const item = reader.focusedItem();
            if (!item) return undefined;
            return {
                id: item.id,
                author: item.author,
                publishedDate: new Date(item.publishedAt),
                updatedDate: new Date(item.updatedAt),
                title: item.title,
                body: { content: item.contentHtml },
                url: item.url
            };
        },
        getActiveSubscription() {
            const feed = reader.getState().view?.feed;
            if (!feed) return undefined;
            return {
                title: feed.title,
                url: feed.feedUrl ?? feed.htmlUrl,
                iconUrl: feed.iconUrl ?? "",
                htmlUrl: feed.htmlUrl
            };
        },
        triggerKey(keys) {
            shortcuts.bindings.trigger(keys);
        },
        registerKey(keys, handler) {
            // Replaces a default binding, as Combokeys' bind() did in irodr 1.x.
            shortcuts.bindings.bind(keys, (event) => handler(event), { replace: true });
        },
        getDefaultActions: () => shortcuts.actions,
        event: events
    };
    target.userScript = api;
    target.dispatchEvent(new CustomEvent("userscript-init", { detail: { userScript: api } }));
    return () => {
        delete target.userScript;
        target.dispatchEvent(new CustomEvent("userscript-uninit"));
    };
}
