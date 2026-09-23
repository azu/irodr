import { useSyncExternalStore } from "react";

// A shared minute clock, so relative times stay pure during render.
const clock: { now: number; timer: ReturnType<typeof setInterval> | undefined } = { now: Date.now(), timer: undefined };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (clock.timer === undefined) {
        // The clock stops while nothing shows a time; catch up when it restarts.
        // useSyncExternalStore re-reads the snapshot after subscribing.
        clock.now = Date.now();
        clock.timer = setInterval(() => {
            clock.now = Date.now();
            for (const notify of listeners) notify();
        }, 60_000);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && clock.timer !== undefined) {
            clearInterval(clock.timer);
            clock.timer = undefined;
        }
    };
}

export function useNow(): number {
    return useSyncExternalStore(subscribe, () => clock.now);
}
