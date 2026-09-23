import { describe, expect, it } from "vite-plus/test";
import plugin from "./index.ts";

/** Run a rule's visitor over declarations and collect the reports. */
function reports(kinds: string[]): string[] {
    const reported: string[] = [];
    const visitor = plugin.rules["no-let"].create({
        report: ({ node }) => reported.push(node.kind)
    });
    for (const kind of kinds) visitor.VariableDeclaration({ kind });
    return reported;
}

describe("immutable/no-let", () => {
    it("reports let", () => {
        expect(reports(["let"])).toEqual(["let"]);
    });

    it("allows const, and leaves var to no-var", () => {
        expect(reports(["const", "var", "using", "await using"])).toEqual([]);
    });
});
