import { describe, expect, it } from "vite-plus/test";
import { createActivityMonitor } from "./activity.ts";

function setup() {
    const state = { visible: true, focused: true, now: 0 };
    const target = new EventTarget();
    const activity = createActivityMonitor({
        target,
        isVisible: () => state.visible,
        hasFocus: () => state.focused,
        now: () => state.now
    });
    return { state, target, activity };
}

describe("activity monitor", () => {
    it("requires both visibility and focus even after recent input", () => {
        const { state, target, activity } = setup();
        expect(activity.isActive()).toBe(true);
        state.focused = false;
        target.dispatchEvent(new Event("pointermove"));
        expect(activity.isActive()).toBe(false);
        state.focused = true;
        state.visible = false;
        expect(activity.isActive()).toBe(false);
        state.visible = true;
        expect(activity.isActive()).toBe(true);
        activity.stop();
    });

    it.each(["keydown", "pointerdown", "pointermove", "wheel", "touchstart", "scroll", "focus"])(
        "resumes after %s and becomes idle again after five minutes",
        (event) => {
            const { state, target, activity } = setup();
            state.now = 300_000;
            expect(activity.isActive()).toBe(false);
            target.dispatchEvent(new Event(event));
            expect(activity.isActive()).toBe(true);
            state.now = 599_999;
            expect(activity.isActive()).toBe(true);
            state.now = 600_000;
            expect(activity.isActive()).toBe(false);
            activity.stop();
        }
    );

    it("removes its input listeners when stopped", () => {
        const { state, target, activity } = setup();
        activity.stop();
        state.now = 300_000;
        target.dispatchEvent(new Event("keydown"));
        expect(activity.isActive()).toBe(false);
    });
});
