// MIT © 2017 azu
import { StreamContentResponse, StreamContentsResponse } from "../../../infra/api/StreamContentsResponse";
import { SubscriptionContent, SubscriptionContentIdentifier } from "./SubscriptionContent";
import { SubscriptionContentBody } from "./SubscriptionContentBody";
import { SubscriptionContents } from "./SubscriptionContents";
import { TimeStamp } from "../TimeStamp";

const he = require("he");
export const createSubscriptionContentsFromResponse = (
    streamContentResponse: StreamContentsResponse
): SubscriptionContents => {
    const contentList = streamContentResponse.items.map(item => {
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
    // Inoreader response updated: 0
    const hasUpdate = streamContentResponse.updated !== undefined && streamContentResponse.updated !== 0;
    const canonicalHref = streamContentResponse.canonical.map(canonical => canonical.href).join(",");
    // some id includes space, it is invalid as css selector, so remote it
    // e.g. http://feeds.feedburner.com/alistapart/main
    const identifier = `${streamId}--${streamContentResponse.id}--${canonicalHref}`.replace(/\s+/, "");
    return new SubscriptionContent({
        // stream.id + content.id + content.href(s)
        id: new SubscriptionContentIdentifier(identifier),
        url: streamContentResponse.canonical[0].href,
        // 2017-10-21~ Inoreader API Response sometimes encode 10 entity
        title: he.decode(streamContentResponse.title) as string,
        author: streamContentResponse.author,
        body: new SubscriptionContentBody(streamContentResponse.summary.content),
        publishedDate: TimeStamp.createTimeStampFromSecond(streamContentResponse.published),
        updatedDate: hasUpdate
            ? TimeStamp.createTimeStampFromSecond(streamContentResponse.updated)
            : TimeStamp.createTimeStampFromSecond(streamContentResponse.published)
    });
};
