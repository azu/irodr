import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LocalApi } from "../lib/local-api.ts";
import type { TranslationStreamOptions } from "../lib/translation-stream.ts";
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

function fixture() {
    const calls: { texts: readonly string[]; options: TranslationStreamOptions; finish: () => void }[] = [];
    const local: LocalApi = {
        info: () =>
            Promise.resolve({
                name: "irodr-local",
                version: "test",
                features: new Set(["translate", "translate-stream"])
            }),
        translate: () => Promise.reject(new Error("must stream")),
        translateSegments: () => Promise.reject(new Error("must preserve links in DOM")),
        translateStream: (texts, _source, _target, options) =>
            new Promise<void>((resolve, reject) => {
                calls.push({ texts, options, finish: resolve });
                options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
            })
    };
    const notify = vi.fn();
    return { calls, notify, mode: createTranslateMode(notify, local) };
}

describe("translate mode scheduling", () => {
    it("renders a complete paragraph without waiting for another paragraph or the batch to finish", async () => {
        const first = [node("before link"), node("after link")];
        const second = [node("another paragraph")];
        dom.groups = [first, second];
        const { calls, mode } = fixture();
        const translating = mode.toggle("article");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        const request = calls[0]!;
        request.options.onResult({ index: 0, text: "前" });
        expect(dom.applied).toHaveLength(0);
        request.options.onResult({ index: 2, text: "別の段落" });
        expect(dom.applied).toEqual([[{ node: second[0], text: "別の段落" }]]);
        request.options.onResult({ index: 1, text: "後" });
        expect(dom.applied[1]).toEqual([
            { node: first[0], text: "前" },
            { node: first[1], text: "後" }
        ]);
        request.finish();
        await translating;
        mode.off();
    });

    it("cancels native work on OFF and ignores late results", async () => {
        dom.groups = [[node("first"), node("second")]];
        const { calls, mode, notify } = fixture();
        const translating = mode.toggle("article");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        calls[0]!.options.onResult({ index: 0, text: "first result" });
        await mode.toggle("article");
        expect(calls[0]!.options.signal?.aborted).toBe(true);
        calls[0]!.options.onResult({ index: 1, text: "late result" });
        await translating;
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
        expect(calls).toHaveLength(1);
        calls[0]!.options.onResult({ index: 0, text: "old" });
        calls[0]!.finish();
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(calls[1]?.texts).toEqual(["new viewport"]);
        calls[1]!.options.onResult({ index: 0, text: "new" });
        calls[1]!.finish();
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
        calls[0]!.options.onResult({ index: 0, text: "visible" });
        calls[0]!.finish();
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
        expect(calls[0]!.options.signal?.aborted).toBe(true);
        calls[0]!.options.onResult({ index: 0, text: "late old result" });
        calls[1]!.options.onResult({ index: 0, text: "next result" });
        calls[1]!.finish();
        await Promise.all([old, next]);
        expect(dom.applied.flat().map((result) => result.text)).toEqual(["next result"]);
        mode.off();
    });
});
