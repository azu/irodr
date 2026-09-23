import { describe, expect, it } from "vite-plus/test";
import { chunkBySize } from "./batch.ts";

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
