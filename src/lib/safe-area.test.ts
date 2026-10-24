import { describe, expect, it } from "vite-plus/test";
import { createSafeAreaRefresher } from "./safe-area.ts";

const CONTENT = "width=device-width, initial-scale=1, viewport-fit=cover";

function setup(content = CONTENT) {
    const viewport = new EventTarget();
    const meta = { content };
    const timers = new Map<number, () => void>();
    const frames: Array<() => void> = [];
    const history: string[] = [];
    const watched = {
        get content() {
            return meta.content;
        },
        set content(value: string) {
            history.push(value);
            meta.content = value;
        }
    };
    const refresher = createSafeAreaRefresher({
        viewport,
        meta: watched,
        setTimeout: (task) => {
            const id = timers.size + 1;
            timers.set(id, task);
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        nextFrame: (task) => frames.push(task)
    });
    const runTimers = (): void => {
        for (const [id, task] of timers) {
            timers.delete(id);
            task();
        }
    };
    const runFrames = (): void => {
        for (const task of frames.splice(0)) task();
    };
    return { viewport, meta, timers, history, refresher, runTimers, runFrames };
}

describe("safe area refresher", () => {
    it("toggles viewport-fit=cover once the viewport stops resizing", () => {
        const { viewport, meta, timers, history, runTimers, runFrames } = setup();
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("resize"));
        expect(timers.size).toBe(1);
        runTimers();
        expect(meta.content).toBe("width=device-width, initial-scale=1");
        runFrames();
        expect(meta.content).toBe(CONTENT);
        expect(history).toEqual(["width=device-width, initial-scale=1", CONTENT]);
    });

    it("leaves a viewport without viewport-fit=cover alone", () => {
        const { viewport, history, runTimers, runFrames } = setup("width=device-width");
        viewport.dispatchEvent(new Event("resize"));
        runTimers();
        runFrames();
        expect(history).toEqual([]);
    });

    it("stops listening", () => {
        const { viewport, timers, refresher } = setup();
        viewport.dispatchEvent(new Event("resize"));
        refresher.stop();
        expect(timers.size).toBe(0);
        viewport.dispatchEvent(new Event("resize"));
        expect(timers.size).toBe(0);
    });
});
