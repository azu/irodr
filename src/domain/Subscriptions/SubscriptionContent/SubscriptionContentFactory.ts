// MIT © 2017 azu
import { StreamContentResponse, StreamContentsResponse } from "../../../infra/api/StreamContentsResponse";
import { SubscriptionContent, SubscriptionContentIdentifier } from "./SubscriptionContent";
import { SubscriptionContentBody } from "./SubscriptionContentBody";
import { SubscriptionContents } from "./SubscriptionContents";
import { TimeStamp } from "../TimeStamp";
import { toInoreaderSourceItem } from "../../../infra/sources/InoreaderSourceAdapter";

export const createSubscriptionContentsFromResponse = (
    streamContentResponse: StreamContentsResponse
): SubscriptionContents => {
    const contentList = streamContentResponse.items.map((item) => {
        return createSubscriptionContentFromResponse(streamContentResponse.id, item);
    });
    return new SubscriptionContents({
        contents: contentList,
        continuationKey: streamContentResponse.continuation,
        lastUpdatedTimestamp: TimeStamp.createTimeStampFromSecond(streamContentResponse.updated)
    });
};

export const createSubscriptionContentFromResponse = (
    streamId: string,
    streamContentResponse: StreamContentResponse
): SubscriptionContent => {
    const item = toInoreaderSourceItem(streamId, streamContentResponse);
    // Compatibility bridge: RSS keeps its historical IDs and remote read behavior.
    // Do not opt this view into canonicalItemId or local readerState yet.
    return new SubscriptionContent({
        id: new SubscriptionContentIdentifier(item.metadata.legacyId),
        url: item.url,
        title: item.title,
        author: item.metadata.author,
        body: new SubscriptionContentBody({
            content: item.content,
            enclosures: item.metadata.enclosures
        }),
        publishedDate: TimeStamp.createTimeStampFromMillisecond(Date.parse(item.publishedAt)),
        updatedDate: TimeStamp.createTimeStampFromMillisecond(Date.parse(item.updatedAt))
    });
};
