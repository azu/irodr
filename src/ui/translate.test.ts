import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTranslateMode } from "./translate.ts";

const dom = vi.hoisted(() => ({
    body: {} as Element,
    scroller: new EventTarget(),
    groups: [] as Text[][],
    applied: [] as { node: Text; text: string }[][],
    restored: 0
}));
vi.mock("./dom.ts", () => ({
    CLASS: { itemBody: "body" },
    itemElement: () => ({ querySelector: () => dom.body }),
    articleScroller: () => dom.scroller
}));
vi.mock("./translate-dom.ts", () => ({
    nextTranslationBatch: () =>
        dom.groups.filter((group) => !dom.applied.some((changes) => changes[0]?.node === group[0])),
    applyVisibleTexts: (_body: Element, changes: { node: Text; text: string }[]) => {
        dom.applied.push(changes);
    },
    restoreOriginals: () => {
        dom.restored += 1;
    }
}));

beforeEach(() => {
    dom.scroller = new EventTarget();
    dom.groups = [];
    dom.applied = [];
    dom.restored = 0;
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", {});
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => vi.unstubAllGlobals());

const node = (data: string) => ({ data, isConnected: true }) as Text;

/** The browser's Translator API, translating one text per call; each call waits until the test resolves it. */
function fixture() {
    const calls: { text: string; resolve: (text: string) => void }[] = [];
    vi.stubGlobal("Translator", {
        availability: () => Promise.resolve("available"),
        create: () =>
            Promise.resolve({
                translate: (text: string) => new Promise<string>((resolve) => calls.push({ text, resolve })),
                destroy: () => undefined
            })
    });
    const notify = vi.fn();
    return { calls, notify, mode: createTranslateMode(notify) };
}

describe("translate mode scheduling", () => {
    it("renders a complete paragraph without waiting for another paragraph or the batch to finish", async () => {
        const first = [node("before link"), node("after link")];
        const second = [node("another paragraph")];
        dom.groups = [first, second];
        const { calls, mode } = fixture();
        const translating = mode.toggle("article");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0]!.resolve("前");
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(dom.applied).toHaveLength(0);
        calls[1]!.resolve("後");
        await vi.waitFor(() => expect(calls).toHaveLength(3));
        expect(dom.applied).toEqual([
            [
                { node: first[0], text: "前" },
                { node: first[1], text: "後" }
            ]
        ]);
        calls[2]!.resolve("別の段落");
        await translating;
        expect(dom.applied[1]).toEqual([{ node: second[0], text: "別の段落" }]);
        mode.off();
    });

    it("stops on OFF and ignores late results", async () => {
        dom.groups = [[node("first"), node("second")]];
        const { calls, mode, notify } = fixture();
        const translating = mode.toggle("article");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        await mode.toggle("article");
        calls[0]!.resolve("late result");
        await translating;
        expect(calls).toHaveLength(1);
        expect(dom.applied).toHaveLength(0);
        expect(dom.restored).toBe(1);
        expect(notify).not.toHaveBeenCalledWith(expect.anything(), { error: true });
    });

    it("submits only one batch at a time and re-reads viewport priorities after completion", async () => {
        dom.groups = [[node("old viewport")]];
        const { calls, mode } = fixture();
        const translating = mode.toggle("article");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        dom.groups = [[node("new viewport")]];
        dom.scroller.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(calls).toHaveLength(1);
        calls[0]!.resolve("old");
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(calls[1]?.text).toBe("new viewport");
        calls[1]!.resolve("new");
        await translating;
        mode.off();
    });

    it("resumes on scrolling after all nearby paragraphs are translated", async () => {
        const { calls, mode } = fixture();
        await mode.toggle("article");
        expect(calls).toHaveLength(0);
        dom.groups = [[node("now visible")]];
        dom.scroller.dispatchEvent(new Event("scroll"));
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0]!.resolve("visible");
        await vi.waitFor(() => expect(dom.applied).toHaveLength(1));
        mode.off();
    });

    it("aborts the previous article when the reader moves to another one", async () => {
        dom.groups = [[node("previous")]];
        const { calls, mode } = fixture();
        const old = mode.toggle("old");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        dom.groups = [[node("next")]];
        const next = mode.translate("next");
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        calls[0]!.resolve("late old result");
        calls[1]!.resolve("next result");
        await Promise.all([old, next]);
        expect(dom.applied.flat().map((result) => result.text)).toEqual(["next result"]);
        mode.off();
    });

    it("translates with a user script translator when the browser has none", async () => {
        const paragraph = [node("Hello"), node("world")];
        dom.groups = [paragraph];
        const translateBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map((text) => `[ja] ${text}`)));
        const target: EventTarget & Pick<Window, "irodrTranslator"> = new EventTarget();
        target.irodrTranslator = { translateBatch };
        vi.stubGlobal("window", target);
        const mode = createTranslateMode(vi.fn());
        await mode.toggle("article");
        expect(translateBatch).toHaveBeenCalledWith(["Hello", "world"], "en", "ja");
        expect(dom.applied).toEqual([
            [
                { node: paragraph[0], text: "[ja] Hello" },
                { node: paragraph[1], text: "[ja] world" }
            ]
        ]);
        mode.off();
    });
});
