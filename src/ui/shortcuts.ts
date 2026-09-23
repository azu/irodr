import type { Reader } from "../app/reader.ts";
import { KeyBindings } from "../lib/keybindings.ts";
import { articleScroller, scrollByPage } from "./dom.ts";
import type { TranslateMode } from "./translate.ts";

export type ShortcutAction = (event?: KeyboardEvent) => void;

/** Default key map, as in irodr 1.x and LDR. */
export const KEY_MAP = {
    j: "move-next-content-item",
    "shift+j": "load-more-past-contents",
    k: "move-prev-content-item",
    t: "toggle-content-filter",
    "shift+h": "dump-read-content-history-to-console",
    a: "move-prev-subscription-feed",
    s: "move-next-subscription-feed",
    m: "make-subscription-read",
    v: "open-current-content-url",
    z: "toggle-subscription-feed-list",
    space: "scroll-down-content",
    "shift+space": "scroll-up-content",
    "shift+s": "skip-and-move-next-subscription-feed",
    "shift+t": "translate-current-content"
} as const;

export type ActionName = (typeof KEY_MAP)[keyof typeof KEY_MAP];

export interface Shortcuts {
    readonly bindings: KeyBindings;
    readonly actions: Record<ActionName, ShortcutAction>;
    /** Attach the keydown listener. Returns a function that detaches it. */
    attach(target: Document): () => void;
}

export function createShortcuts(reader: Reader, translate: TranslateMode): Shortcuts {
    const focusItem = (itemId: string) => {
        reader.scrollToItem(itemId);
        if (translate.enabled) void translate.translate(itemId);
    };

    const actions: Record<ActionName, ShortcutAction> = {
        "move-next-content-item": () => {
            const scroller = articleScroller();
            const items = reader.getState().view?.items ?? [];
            if (!scroller || items.length === 0) return;
            const focused = reader.focusedItem();
            if (scroller.scrollTop === 0 || !focused) {
                const first = items[0];
                if (first) focusItem(first.id);
                return;
            }
            const next = reader.adjacentItem(1);
            if (next) focusItem(next.id);
            else reader.setMessage("End of contents", { icon: "end" });
        },
        "move-prev-content-item": () => {
            const previous = reader.adjacentItem(-1);
            if (previous) focusItem(previous.id);
        },
        "load-more-past-contents": () => {
            const before = reader.getState().focusItemId;
            void reader.loadMore().then(() => {
                // Move on unless the reader moved meanwhile.
                if (before && before === reader.getState().focusItemId) actions["move-next-content-item"]();
            });
        },
        "toggle-content-filter": () => reader.toggleFilter(),
        "dump-read-content-history-to-console": () => console.info(reader.readHistory()),
        "move-prev-subscription-feed": () => {
            translate.off();
            void reader.prevFeed();
        },
        "move-next-subscription-feed": () => {
            translate.off();
            void reader.nextFeed();
        },
        "skip-and-move-next-subscription-feed": () => {
            translate.off();
            void reader.skipFeed();
        },
        "make-subscription-read": () => {
            reader.markCurrentFeedRead().catch(() => undefined);
        },
        "open-current-content-url": () => reader.openFocusedItem(),
        "toggle-subscription-feed-list": () => reader.toggleAllCategories(),
        "scroll-down-content": (event) => {
            event?.preventDefault();
            const scroller = articleScroller();
            if (scroller) scrollByPage(scroller, 1);
        },
        "scroll-up-content": (event) => {
            event?.preventDefault();
            const scroller = articleScroller();
            if (scroller) scrollByPage(scroller, -1);
        },
        "translate-current-content": () => {
            void translate.toggle(reader.getState().focusItemId);
        }
    };

    const bindings = new KeyBindings();
    for (const [combo, name] of Object.entries(KEY_MAP)) {
        bindings.bind(combo, (event) => actions[name](event));
    }

    const onKeyDown = (event: KeyboardEvent) => {
        // Dialogs own the keyboard while open.
        if (reader.getState().panel) return;
        bindings.handleEvent(event);
    };

    return {
        bindings,
        actions,
        attach(target) {
            target.addEventListener("keydown", onKeyDown);
            return () => target.removeEventListener("keydown", onKeyDown);
        }
    };
}
