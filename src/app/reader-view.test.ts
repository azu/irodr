import { describe, expect, it } from "vite-plus/test";
import type { Feed, SourceSnapshot } from "../sources/source.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import {
    cacheEntry,
    initialModel,
    opened,
    type ReaderModel,
    remember,
    withFocus,
    withReadPending
} from "./reader-model.ts";
import { createAsRead, initialState, projectState, type ReaderState, type ViewInputs } from "./reader-view.ts";

const EVERYTHING = { sources: true, list: true, view: true };

const feed = (title: string, unreadCount = 1, revision = "1"): Feed => ({
    id: `memory:${title}`,
    sourceId: "memory",
    title,
    category: "News",
    htmlUrl: `https://example.com/${title}`,
    unreadCount,
    revision
});

const A = feed("A");
const B = feed("B", 2);
const READ = feed("Read", 0);

const snapshot = (feeds: readonly Feed[]): SourceSnapshot => ({
    connected: true,
    status: { phase: "idle", message: "" },
    feeds,
    settings: { description: [], fields: [], actions: [] }
});

const source = {
    id: "memory",
    title: "Memory",
    capabilities: { loadMore: true, unreadFilter: true, liveItems: false }
};

const inputsOf = (feeds: readonly Feed[], asRead = createAsRead()): ViewInputs => ({
    sources: [{ source, snapshot: snapshot(feeds) }],
    asRead
});

const listed = (state: ReaderState) =>
    state.list.categories.flatMap((category) => category.feeds.map((shown) => `${shown.title}(${shown.unreadCount})`));

/** A model showing `shown`, with its items loaded. */
const showing = (shown: Feed): ReaderModel =>
    opened(
        remember(initialModel(DEFAULT_PREFERENCES), shown.id, cacheEntry(shown.revision, [], undefined)),
        shown,
        false
    );

describe("projectState", () => {
    it("returns the previous state when nothing changed", () => {
        const model = showing(A);
        const inputs = inputsOf([A, B, READ]);
        const state = projectState(initialState(model), model, inputs, EVERYTHING);
        expect(listed(state)).toEqual(["A(1)", "B(2)"]);
        expect(state.totals).toEqual({ unread: 3, feeds: 3 });
        expect(projectState(state, model, inputs, EVERYTHING)).toBe(state);
        // A new snapshot with the same feeds keeps the list and the view too.
        const next = projectState(state, model, inputsOf([A, B, READ]), EVERYTHING);
        expect(next.list).toBe(state.list);
        expect(next.view).toBe(state.view);
        expect(next.totals).toBe(state.totals);
    });

    it("keeps unchanged parts when another part changes", () => {
        const model = showing(A);
        const inputs = inputsOf([A, B]);
        const state = projectState(initialState(model), model, inputs, EVERYTHING);
        const focused = projectState(state, withFocus(model, "a1"), inputs, EVERYTHING);
        expect(focused).not.toBe(state);
        expect(focused.focusItemId).toBe("a1");
        expect(focused.sources).toBe(state.sources);
        expect(focused.list).toBe(state.list);
        expect(focused.view).toBe(state.view);
        expect(focused.totals).toBe(state.totals);
    });

    it("keeps the categories and navigation when another feed opens", () => {
        const inputs = inputsOf([A, B]);
        const state = projectState(initialState(showing(A)), showing(A), inputs, EVERYTHING);
        const next = projectState(state, opened(showing(A), B, false), inputs, EVERYTHING);
        expect(next.list.currentFeedId).toBe(B.id);
        expect(next.list.categories).toBe(state.list.categories);
        expect(next.list.navigation).toBe(state.list.navigation);
    });

    it("derives only the parts it is asked for", () => {
        const inputs = inputsOf([A, B]);
        const state = projectState(initialState(showing(A)), showing(A), inputs, EVERYTHING);
        const next = projectState(state, opened(showing(A), B, false), inputs, {});
        expect(next.scrollRequest).toEqual({ itemId: undefined, seq: 2 });
        expect(next.list).toBe(state.list);
        expect(next.view).toBe(state.view);
        const list = projectState(state, opened(showing(A), B, false), inputs, { list: true });
        expect(list.list.currentFeedId).toBe(B.id);
        expect(list.view).toBe(state.view);
    });

    it("shows feeds with 0 unread while their mark-read is in flight, as the same copy each time", () => {
        const model = withReadPending(showing(A), B.id);
        const inputs = inputsOf([A, B]);
        const state = projectState(initialState(model), model, inputs, EVERYTHING);
        expect(listed(state)).toEqual(["A(1)"]);
        expect(state.totals).toEqual({ unread: 1, feeds: 2 });
        // Listed while recently visited, with the same 0-unread copy in every projection.
        const visited = withReadPending(opened(model, B, false), B.id);
        const first = projectState(state, visited, inputs, EVERYTHING);
        const second = projectState(initialState(visited), visited, inputs, EVERYTHING);
        expect(listed(first)).toEqual(["A(1)", "B(0)"]);
        expect(first.view?.feed).toBe(first.list.categories[0]?.feeds[1]);
        expect(second.list.categories[0]?.feeds[1]).toBe(first.view?.feed);
    });

    it("keeps the current feed listed with 0 unread when its source drops it", () => {
        const model = showing(A);
        const asRead = createAsRead();
        const state = projectState(initialState(model), model, inputsOf([A, B], asRead), EVERYTHING);
        const dropped = projectState(state, model, inputsOf([B], asRead), EVERYTHING);
        expect(listed(dropped)).toEqual(["B(2)", "A(0)"]);
        expect(dropped.totals).toEqual({ unread: 2, feeds: 2 });
        expect(dropped.view?.feed).toBe(dropped.list.categories[0]?.feeds[1]);
        // The same copy while it stays dropped.
        const again = projectState(dropped, withFocus(model, "a1"), inputsOf([B], asRead), EVERYTHING);
        expect(again.list).toBe(dropped.list);
        expect(again.view).toBe(dropped.view);
    });

    it("lists as prefetched the feeds whose cached items are of their current revision", () => {
        const model = remember(showing(A), B.id, cacheEntry(B.revision, [], undefined));
        const state = projectState(initialState(model), model, inputsOf([A, B]), EVERYTHING);
        expect(state.list.prefetched).toEqual(new Set([A.id, B.id]));
        // Caching the same feeds again keeps the set.
        const recached = remember(model, B.id, cacheEntry(B.revision, [], undefined));
        expect(projectState(state, recached, inputsOf([A, B]), EVERYTHING).list.prefetched).toBe(state.list.prefetched);
        // A new revision is not prefetched until it loads.
        const changed = projectState(state, model, inputsOf([A, feed("B", 3, "2")]), EVERYTHING);
        expect(changed.list.prefetched).toEqual(new Set([A.id]));
    });
});
