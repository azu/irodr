import { describe, expect, it } from "vite-plus/test";
import plugin from "./index.ts";

/** Whether no-let reports a declaration of this kind. */
function letReported(kind: string): boolean {
    const reported: unknown[] = [];
    const visitor = plugin.rules["no-let"].create({ report: (descriptor) => reported.push(descriptor) });
    visitor.VariableDeclaration({ type: "VariableDeclaration", kind });
    return reported.length > 0;
}

/** Whether no-class reports a class with this superclass. */
function classReported(
    superClass: { type: string; name?: string } | null,
    type: "ClassDeclaration" | "ClassExpression" = "ClassDeclaration"
): boolean {
    const reported: unknown[] = [];
    const visitor = plugin.rules["no-class"].create({ report: (descriptor) => reported.push(descriptor) });
    visitor[type]({ type, superClass });
    return reported.length > 0;
}

describe("immutable/no-let", () => {
    it("reports let", () => {
        expect(letReported("let")).toBe(true);
    });

    it("allows const, and leaves var to no-var", () => {
        for (const kind of ["const", "var", "using", "await using"]) expect(letReported(kind)).toBe(false);
    });
});

describe("immutable/no-class", () => {
    it("reports classes and class expressions", () => {
        expect(classReported(null)).toBe(true);
        expect(classReported(null, "ClassExpression")).toBe(true);
        expect(classReported({ type: "Identifier", name: "Store" })).toBe(true);
    });

    it("allows errors", () => {
        expect(classReported({ type: "Identifier", name: "Error" })).toBe(false);
        expect(classReported({ type: "Identifier", name: "InoreaderRequestError" })).toBe(false);
    });

    it("reports a computed superclass, which cannot be checked", () => {
        expect(classReported({ type: "CallExpression" })).toBe(true);
    });
});
