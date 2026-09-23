import { useSyncExternalStore } from "react";

// A shared minute clock, so relative times stay pure during render.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (timer === undefined) {
        // The clock stops while nothing shows a time; catch up when it restarts.
        // useSyncExternalStore re-reads the snapshot after subscribing.
        now = Date.now();
        timer = setInterval(() => {
            now = Date.now();
            for (const notify of listeners) notify();
        }, 60_000);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }
    };
}

export function useNow(): number {
    return useSyncExternalStore(subscribe, () => now);
}
