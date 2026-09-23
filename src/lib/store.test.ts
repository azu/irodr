import { describe, expect, it } from "vite-plus/test";
import { createStore } from "./store.ts";

describe("store", () => {
    it("notifies subscribers when the value changes", () => {
        const store = createStore({ count: 0 });
        const seen: number[] = [];
        store.subscribe(() => seen.push(store.get().count));
        store.set({ count: 1 });
        expect(store.get()).toEqual({ count: 1 });
        expect(seen).toEqual([1]);
    });

    it("does nothing when set to the current value", () => {
        const initial = { count: 0 };
        const store = createStore(initial);
        const calls: string[] = [];
        store.subscribe(() => calls.push("changed"));
        store.set(initial);
        store.update((current) => current);
        expect(store.get()).toBe(initial);
        expect(calls).toEqual([]);
    });

    it("updates from the current value", () => {
        const store = createStore(1);
        store.update((current) => current + 1);
        store.update((current) => current * 10);
        expect(store.get()).toBe(20);
    });

    it("stops notifying after unsubscribe", () => {
        const store = createStore(0);
        const calls: string[] = [];
        const unsubscribe = store.subscribe(() => calls.push("first"));
        store.subscribe(() => calls.push("second"));
        store.set(1);
        unsubscribe();
        store.set(2);
        expect(calls).toEqual(["first", "second", "second"]);
    });

    it("notifies the subscribers present when the value changed", () => {
        const store = createStore(0);
        const calls: string[] = [];
        const unsubscribes: Array<() => void> = [];
        store.subscribe(() => {
            calls.push("first");
            for (const unsubscribe of unsubscribes) unsubscribe();
            store.subscribe(() => calls.push("added"));
        });
        unsubscribes.push(store.subscribe(() => calls.push("second")));
        store.set(1);
        expect(calls).toEqual(["first", "second"]);
        store.set(2);
        expect(calls).toEqual(["first", "second", "first", "added"]);
    });
});
