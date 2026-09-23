import { describe, expect, it } from "vite-plus/test";
import { mergeRuns, parseSegments, segmentText } from "./translation-segment.ts";

describe("parseSegments", () => {
    it("accepts runs with optional tags and skip flags", () => {
        const segments = [{ runs: [{ text: "Read " }, { text: "the docs", tag: 1 }, { text: "npm", skip: true }] }];
        expect(parseSegments(segments)).toEqual(segments);
    });

    it("rejects malformed segments", () => {
        expect(parseSegments({ runs: [] })).toBeUndefined();
        expect(parseSegments([{ runs: [{ text: 1 }] }])).toBeUndefined();
        expect(parseSegments([{ runs: [{ text: "a", tag: "1" }] }])).toBeUndefined();
    });
});

describe("mergeRuns", () => {
    it("joins neighboring runs with the same markup", () => {
        expect(
            mergeRuns([
                { text: "a", tag: 1 },
                { text: "b", tag: 1 },
                { text: "c" },
                { text: "d" },
                { text: "e", tag: 1 }
            ])
        ).toEqual([{ text: "ab", tag: 1 }, { text: "cd" }, { text: "e", tag: 1 }]);
    });
});

describe("segmentText", () => {
    it("joins the text of every run", () => {
        expect(segmentText({ runs: [{ text: "Read " }, { text: "the docs", tag: 1 }] })).toBe("Read the docs");
    });
});
