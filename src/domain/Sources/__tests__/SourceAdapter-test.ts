import type { ItemState, SourceAdapter, SourceItem } from "../SourceAdapter";

describe("SourceAdapter contract", () => {
    it("keeps source content separate from local user state", async () => {
        const item: SourceItem = { externalId: "1", sourceId: "source", title: "Release" };
        const state: ItemState = {
            itemId: "source:1",
            read: true,
            readStateUpdatedAt: "2026-01-01T00:00:00.000Z",
            starred: false,
            starStateUpdatedAt: "2026-01-01T00:00:00.000Z"
        };
        const adapter: SourceAdapter<{ sourceId: string }, { version: number }> = {
            sync: async ({ config, cursor }) => ({
                items: [{ ...item, sourceId: config.sourceId }],
                cursor: { version: (cursor?.version || 0) + 1 }
            })
        };
        expect(await adapter.sync({ config: { sourceId: "source" } })).toEqual({
            items: [item],
            cursor: { version: 1 }
        });
        expect(item).not.toHaveProperty("read");
        expect(state.read).toBe(true);
    });
});
