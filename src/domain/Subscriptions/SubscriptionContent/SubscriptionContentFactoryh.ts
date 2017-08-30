// MIT © 2017 azu
import { StreamContentResponse, StreamContentsResponse } from "../../../infra/api/StreamContentsResponse";
import { SubscriptionContent, SubscriptionContentIdentifier } from "./SubscriptionContent";
import { SubscriptionContentBody } from "./SubscriptionContentBody";
import { SubscriptionContents } from "./SubscriptionContents";

export const createSubscriptionContentsFromResponse = (
    streamContentResponse: StreamContentsResponse
): SubscriptionContents => {
    const contentList = streamContentResponse.items.map(item => {
        return createSubscriptionContentFromResponse(item);
    });
    const updatedTimestampMs = streamContentResponse.updated * 1000;
    return new SubscriptionContents({
        contents: contentList,
        lastUpdatedTimestampMs: updatedTimestampMs
    });
};

export const createSubscriptionContentFromResponse = (
    streamContentResponse: StreamContentResponse
): SubscriptionContent => {
    // Inoreader response updated: 0
    const hasUpdate = streamContentResponse.updated !== undefined && streamContentResponse.updated !== 0;
    return new SubscriptionContent({
        id: new SubscriptionContentIdentifier(streamContentResponse.id),
        url: streamContentResponse.canonical[0].href,
        title: streamContentResponse.title,
        author: streamContentResponse.author,
        body: new SubscriptionContentBody(streamContentResponse.summary.content),
        publishedDate: new Date(streamContentResponse.published * 1000),
        updatedDate: hasUpdate
            ? new Date(streamContentResponse.updated * 1000)
            : new Date(streamContentResponse.published * 1000)
    });
};
