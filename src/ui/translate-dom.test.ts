import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { applyText, restoreOriginals } from "./translate-dom.ts";

/** Only the DOM operations used by apply/restore; full markup is tested in e2e/translate.spec.ts. */
function element(textContent: string, title: string | null = null) {
    const attributes = new Map<string, string>(title === null ? [] : [["title", title]]);
    return {
        textContent,
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        replaceWith: vi.fn()
    };
}

function fixture(title: string | null) {
    const link = element("the docs", title);
    link.setAttribute("href", "https://example.com/docs");
    const spans: ReturnType<typeof element>[] = [];
    vi.stubGlobal("document", {
        createElement: () => {
            const span = element("");
            spans.push(span);
            return span;
        },
        createTextNode: (data: string) => ({ data })
    });
    const root = {
        querySelectorAll: (selector: string) => (selector === "a" ? [link] : spans)
    } as unknown as ParentNode;
    const node = (data: string, inLink = true) =>
        ({
            data,
            parentElement: { closest: () => (inLink ? link : null) },
            replaceWith: vi.fn()
        }) as unknown as Text;
    return { link, spans, root, node };
}

afterEach(() => vi.unstubAllGlobals());

describe("translated link titles", () => {
    it("captures the whole original label once, even when nested text finishes out of order", () => {
        const { link, spans, node } = fixture("Documentation");
        const nested = node("docs");
        applyText(nested, "ドキュメント");
        link.textContent = "the ドキュメント";
        applyText(node("the "), "その");

        expect(link.getAttribute("title")).toBe("the docs");
        expect(link.getAttribute("href")).toBe("https://example.com/docs");
        expect(spans.map((span) => span.textContent)).toEqual(["ドキュメント", "その"]);
        expect(spans.map((span) => span.getAttribute("data-original-text"))).toEqual(["docs", "the "]);
    });

    it.each([null, "", "Documentation"])(
        "restores the original title %j and captures a fresh label on reuse",
        (title) => {
            const { link, spans, root, node } = fixture(title);
            applyText(node("the docs"), "ドキュメント");
            restoreOriginals(root);
            expect(link.getAttribute("title")).toBe(title);
            expect(spans[0]?.replaceWith).toHaveBeenCalledWith({ data: "the docs" });

            link.textContent = "new label";
            applyText(node("new label"), "新しいラベル");
            expect(link.getAttribute("title")).toBe("new label");
            restoreOriginals(root);
            expect(link.getAttribute("title")).toBe(title);
            expect(link.getAttribute("href")).toBe("https://example.com/docs");
        }
    );

    it("leaves untouched links alone when translating surrounding text", () => {
        const { link, spans, root, node } = fixture("Documentation");
        applyText(node("Read", false), "読む");
        expect(link.getAttribute("title")).toBe("Documentation");
        expect(spans[0]?.getAttribute("title")).toBeNull();
        restoreOriginals(root);
        expect(link.getAttribute("title")).toBe("Documentation");
    });
});
