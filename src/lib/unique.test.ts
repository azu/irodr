import { describe, expect, it } from "vite-plus/test";
import { uniqueBy } from "./unique.ts";

describe("uniqueBy", () => {
    it("keeps the first item of each key, in order", () => {
        const items = [
            { id: "a", n: 1 },
            { id: "b", n: 2 },
            { id: "a", n: 3 },
            { id: "c", n: 4 },
            { id: "b", n: 5 }
        ];
        expect(uniqueBy(items, (item) => item.id)).toEqual([
            { id: "a", n: 1 },
            { id: "b", n: 2 },
            { id: "c", n: 4 }
        ]);
    });

    it("returns every item when keys are unique", () => {
        expect(uniqueBy(["x", "y"], (item) => item)).toEqual(["x", "y"]);
    });
});
