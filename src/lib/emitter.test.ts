import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createEmitter } from "./emitter.ts";

describe("emitter", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dispatches to the handlers of an event in subscription order", () => {
        const events = createEmitter();
        const calls: unknown[][] = [];
        events.subscribe("item", (...args) => calls.push(["first", ...args]));
        events.subscribe("item", (...args) => calls.push(["second", ...args]));
        events.subscribe("other", () => calls.push(["other"]));
        events.dispatch("item", 1, "a");
        expect(calls).toEqual([
            ["first", 1, "a"],
            ["second", 1, "a"]
        ]);
    });

    it("stops dispatching to an unsubscribed handler", () => {
        const events = createEmitter();
        const calls: string[] = [];
        const unsubscribe = events.subscribe("item", () => calls.push("first"));
        events.subscribe("item", () => calls.push("second"));
        unsubscribe();
        events.dispatch("item");
        expect(calls).toEqual(["second"]);
    });

    it("logs a throwing handler and runs the others", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const events = createEmitter();
        const calls: string[] = [];
        const error = new Error("broken user script");
        events.subscribe("item", () => {
            throw error;
        });
        events.subscribe("item", () => calls.push("second"));
        events.dispatch("item");
        expect(calls).toEqual(["second"]);
        expect(logged).toHaveBeenCalledWith(error);
    });
});
