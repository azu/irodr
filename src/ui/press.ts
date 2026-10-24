import { type MouseEvent, type PointerEvent, useRef, useState } from "react";

/** How far a touch may move and still be a tap, in CSS pixels. */
const TAP_SLOP = 10;

export interface PressHandlers {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: () => void;
    readonly onPointerLeave: () => void;
    readonly onClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Buttons that act on pointerup instead of click. iOS does not fire `click` for a tap that stops a momentum scroll,
 * so the first tap after a manual scroll did nothing: the button only looked hovered. A tap ends on the same button
 * near where it started; a swipe that starts on a button moves or is cancelled, and does nothing. Preventing the
 * default of pointerdown also keeps keyboard focus where it was, so shortcuts keep working.
 *
 * `pressed` is the key of the button under the finger, for feedback: `:active` is unreliable on iOS when pointerdown
 * is prevented.
 */
export function usePress(): {
    readonly pressed: string | undefined;
    readonly handlers: (key: string, action: () => void) => PressHandlers;
} {
    const press = useRef<{ key: string; pointerId: number; x: number; y: number } | null>(null);
    const [pressed, setPressed] = useState<string | undefined>(undefined);
    const handlers = (key: string, action: () => void): PressHandlers => ({
        onPointerDown: (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            setPressed(key);
            press.current = { key, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        },
        onPointerUp: (event) => {
            const start = press.current;
            press.current = null;
            setPressed(undefined);
            if (!start || start.key !== key || start.pointerId !== event.pointerId) return;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
            action();
        },
        onPointerCancel: () => {
            press.current = null;
            setPressed(undefined);
        },
        onPointerLeave: () => setPressed(undefined),
        // Enter or Space on a focused button (`detail` is 0); pointer clicks were handled on pointerup.
        onClick: (event) => {
            if (event.detail === 0) action();
        }
    });
    return { pressed, handlers };
}
