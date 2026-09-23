import { describe, expect, it } from "vite-plus/test";
import { chunkBySize, forEachConcurrently } from "./batch.ts";

describe("chunkBySize", () => {
    it("groups items in order within the limit", () => {
        const words = ["aa", "bbb", "c", "dddd", "ee"];
        expect(chunkBySize(words, (word) => word.length, 5)).toEqual([["aa", "bbb"], ["c", "dddd"], ["ee"]]);
    });

    it("keeps an oversized item in a group of its own", () => {
        expect(chunkBySize(["a", "bbbbbb", "c"], (word) => word.length, 3)).toEqual([["a"], ["bbbbbb"], ["c"]]);
    });

    it("returns no groups for no items", () => {
        expect(chunkBySize([], () => 1, 3)).toEqual([]);
    });
});

describe("forEachConcurrently", () => {
    it("runs each item once with bounded concurrency", async () => {
        const running = { now: 0, max: 0 };
        const done: number[] = [];
        await forEachConcurrently([1, 2, 3, 4, 5], 2, async (item) => {
            running.now += 1;
            running.max = Math.max(running.max, running.now);
            await new Promise((resolve) => setTimeout(resolve, 5));
            done.push(item);
            running.now -= 1;
        });
        expect(done.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
        expect(running.max).toBe(2);
    });
});
