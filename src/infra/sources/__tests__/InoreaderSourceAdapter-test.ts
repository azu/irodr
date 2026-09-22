import { InoreaderSourceAdapter, toInoreaderSourceItem } from "../InoreaderSourceAdapter";
import { StreamContentResponse, StreamContentsResponse } from "../../api/StreamContentsResponse";
import {
    createSubscriptionContentFromResponse,
    createSubscriptionContentsFromResponse
} from "../../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactory";
import { SubscriptionContentSerializer } from "../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import fixture from "../../api/__tests__/stream-contents.json";

const he = require("he");
const response = fixture as StreamContentsResponse;

// Independent snapshot of the old factory's mapping: do not derive expected values from the normalizer.
function legacyJSON(streamId: string, item: StreamContentResponse) {
    return {
        id: `${streamId}--${item.id}--${item.canonical.map((canonical) => canonical.href).join(",")}`.replace(
            /\s+/,
            ""
        ),
        url: item.canonical[0].href,
        title: he.decode(item.title),
        author: item.author,
        body: { content: item.summary.content, enclosures: item.enclosure ?? [] },
        publishedDate: item.published * 1000,
        updatedDate: (item.updated !== undefined && item.updated !== 0 ? item.updated : item.published) * 1000
    };
}

describe("Inoreader normalization compatibility", () => {
    it("preserves every existing fixture article and the stream pagination metadata", () => {
        const contents = createSubscriptionContentsFromResponse(response);
        expect(contents.contents.map((item) => SubscriptionContentSerializer.toJSON(item))).toEqual(
            response.items.map((item) => legacyJSON(response.id, item))
        );
        expect(contents.continuationKey).toBe(response.continuation);
        expect(contents.lastUpdatedTimestamp.millSecond).toBe(response.updated * 1000);
        for (const content of contents.contents) {
            expect(content.canonicalItemId).toBeUndefined();
            expect(content.readerState).toBeUndefined();
        }
    });

    it.each([0, undefined, 1700000100])(
        "preserves updated=%s, title decoding, canonical order and enclosures",
        (updated) => {
            const item = {
                ...response.items[0],
                id: "article with more spaces",
                title: "A &amp; B &#10; &lt;C&gt;",
                author: "An author",
                published: 1700000000,
                updated,
                canonical: [{ href: "https://example.com/first" }, { href: "https://example.com/second" }],
                summary: { content: "<p>Body &amp; content</p>", direction: "ltr" },
                enclosure: [{ href: "https://example.com/image.jpg", type: "image/jpeg", length: "100" }]
            } as StreamContentResponse;
            const sourceItem = toInoreaderSourceItem("feed/a b", item);
            const content = createSubscriptionContentFromResponse("feed/a b", item);
            expect(SubscriptionContentSerializer.toJSON(content)).toEqual(legacyJSON("feed/a b", item));
            expect(sourceItem).toMatchObject({
                externalId: item.id,
                sourceId: "feed/a b",
                title: "A & B \n <C>",
                url: "https://example.com/first",
                content: item.summary.content,
                publishedAt: "2023-11-14T22:13:20.000Z",
                updatedAt: updated ? "2023-11-14T22:15:00.000Z" : "2023-11-14T22:13:20.000Z",
                metadata: {
                    legacyId: "feed/ab--article with more spaces--https://example.com/first,https://example.com/second",
                    canonical: item.canonical,
                    enclosures: item.enclosure,
                    author: item.author
                }
            });
            expect(content.body.HTMLString).toContain('class="SubscriptionContentBody-enclosure"');
        }
    );

    it("keeps missing enclosures empty and does not substitute a URL for missing canonical links", () => {
        const item = { ...response.items[0], enclosure: undefined };
        expect(toInoreaderSourceItem(response.id, item).metadata.enclosures).toEqual([]);
        expect(() => toInoreaderSourceItem(response.id, { ...item, canonical: [] })).toThrow();
    });
});

describe("InoreaderSourceAdapter", () => {
    it("fetches only one page per sync and forwards the caller's stream, count and continuation", async () => {
        const fetchStream = jest
            .fn()
            .mockResolvedValueOnce(response)
            .mockResolvedValueOnce({
                ...response,
                items: [],
                continuation: undefined
            });
        const adapter = new InoreaderSourceAdapter(fetchStream);
        const config = { sourceId: "inoreader-account", streamId: "feed/requested", fetchCount: 50 };
        const first = await adapter.sync({ config });
        expect(fetchStream).toHaveBeenCalledTimes(1);
        expect(fetchStream).toHaveBeenNthCalledWith(1, {
            streamId: config.streamId,
            fetchCount: 50,
            continuation: undefined
        });
        expect(first.items).toEqual(
            response.items.map((item) => ({
                ...toInoreaderSourceItem(response.id, item),
                sourceId: config.sourceId
            }))
        );
        expect(first.cursor).toEqual({ continuation: response.continuation });
        const second = await adapter.sync({ config, cursor: first.cursor });
        expect(fetchStream).toHaveBeenCalledTimes(2);
        expect(fetchStream).toHaveBeenNthCalledWith(2, {
            streamId: config.streamId,
            fetchCount: 50,
            continuation: response.continuation
        });
        expect(second).toEqual({ items: [], cursor: { continuation: undefined } });
    });

    it("defaults to a single feed and propagates failures without advancing the input cursor", async () => {
        const error = new Error("request failed");
        const fetchStream = jest.fn().mockRejectedValue(error);
        const adapter = new InoreaderSourceAdapter(fetchStream);
        const cursor = { continuation: "previous-page" };
        await expect(adapter.sync({ config: { sourceId: "feed/example" }, cursor })).rejects.toBe(error);
        expect(fetchStream).toHaveBeenCalledWith({
            streamId: "feed/example",
            fetchCount: 20,
            continuation: "previous-page"
        });
        expect(cursor).toEqual({ continuation: "previous-page" });
    });
});
