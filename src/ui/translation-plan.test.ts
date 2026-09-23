import { describe, expect, it } from "vite-plus/test";
import { planTranslationBatch, type PositionedText } from "./translation-plan.ts";

const paragraph = (value: string, top: number, bottom: number, size = 200): PositionedText<string> => ({
    value,
    top,
    bottom,
    size
});
const view = { top: 100, bottom: 500 };

describe("translation priority", () => {
    it("starts inside the current viewport, not at the start of the article", () => {
        expect(
            planTranslationBatch(
                [paragraph("above", -200, 0), paragraph("visible", 200, 300), paragraph("ahead", 600, 700)],
                view,
                1000
            )
        ).toEqual(["visible"]);
    });
    it("includes partially visible paragraphs, even one covering the entire viewport", () => {
        expect(planTranslationBatch([paragraph("long", 0, 1000)], view, 1000)).toEqual(["long"]);
    });
    it("prefetches only the next screen after visible text is finished", () => {
        expect(
            planTranslationBatch(
                [paragraph("above", -200, 0), paragraph("ahead", 500, 700), paragraph("far", 900, 1100)],
                view,
                1000
            )
        ).toEqual(["ahead"]);
    });
    it("keeps DOM order within a bounded batch and does not split paragraphs", () => {
        expect(
            planTranslationBatch([paragraph("first", 100, 200, 700), paragraph("second", 200, 300, 400)], view, 1000)
        ).toEqual(["first"]);
        expect(planTranslationBatch([paragraph("large", 100, 400, 2000)], view, 1000)).toEqual(["large"]);
    });
    it("reprioritizes remaining text after scrolling and ignores hidden nodes", () => {
        const texts = [paragraph("old", 100, 200), paragraph("hidden", 0, 0), paragraph("new", 1000, 1200)];
        expect(planTranslationBatch(texts, { top: 950, bottom: 1400 }, 1000)).toEqual(["new"]);
    });
});
