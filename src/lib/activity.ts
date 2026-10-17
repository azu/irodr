import { createStore } from "./store.ts";

const IDLE_AFTER_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll", "focus"] as const;

export interface ActivityMonitor {
    readonly isActive: () => boolean;
    readonly stop: () => void;
}

/** Track whether a visible, focused reader has been used in the last five minutes. */
export function createActivityMonitor(options: {
    readonly target: EventTarget;
    readonly isVisible: () => boolean;
    readonly hasFocus: () => boolean;
    readonly now: () => number;
}): ActivityMonitor {
    const lastActivity = createStore(options.now());
    const onActivity = (): void => lastActivity.set(options.now());
    // Capture scroll and focus events from descendants too. Never delay scrolling or touch input.
    for (const event of ACTIVITY_EVENTS) {
        options.target.addEventListener(event, onActivity, { capture: true, passive: true });
    }
    return {
        isActive: (): boolean =>
            options.isVisible() && options.hasFocus() && options.now() - lastActivity.get() < IDLE_AFTER_MS,
        stop: (): void => {
            for (const event of ACTIVITY_EVENTS)
                options.target.removeEventListener(event, onActivity, { capture: true });
        }
    };
}
