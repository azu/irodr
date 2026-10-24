import { createStore } from "./store.ts";

const SETTLE_MS = 300;
const COVER = ", viewport-fit=cover";

export interface SafeAreaRefresher {
    readonly stop: () => void;
}

/**
 * iOS Safari can keep a stale `env(safe-area-inset-top)` after its toolbar shrinks or grows, until the page is
 * shown again. Once the viewport stops resizing, drop `viewport-fit=cover` for a frame and put it back, so Safari
 * computes the insets again.
 */
export function createSafeAreaRefresher(options: {
    readonly viewport: EventTarget;
    readonly meta: { content: string };
    readonly setTimeout: (task: () => void, ms: number) => number;
    readonly clearTimeout: (id: number) => void;
    readonly nextFrame: (task: () => void) => void;
}): SafeAreaRefresher {
    const timer = createStore<number | undefined>(undefined);
    const refresh = (): void => {
        const content = options.meta.content;
        if (!content.includes(COVER)) return;
        options.meta.content = content.replace(COVER, "");
        options.nextFrame(() => {
            options.meta.content = content;
        });
    };
    const onResize = (): void => {
        const pending = timer.get();
        if (pending !== undefined) options.clearTimeout(pending);
        timer.set(options.setTimeout(refresh, SETTLE_MS));
    };
    options.viewport.addEventListener("resize", onResize);
    return {
        stop: (): void => {
            options.viewport.removeEventListener("resize", onResize);
            const pending = timer.get();
            if (pending !== undefined) options.clearTimeout(pending);
        }
    };
}
