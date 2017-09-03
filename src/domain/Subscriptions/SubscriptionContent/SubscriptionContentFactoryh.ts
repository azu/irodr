// MIT © 2017 azu
import { StreamContentResponse, StreamContentsResponse } from "../../../infra/api/StreamContentsResponse";
import { SubscriptionContent, SubscriptionContentIdentifier } from "./SubscriptionContent";
import { SubscriptionContentBody } from "./SubscriptionContentBody";
import { SubscriptionContents } from "./SubscriptionContents";
import { TimeStamp } from "../TimeStamp";

export const createSubscriptionContentsFromResponse = (
    streamContentResponse: StreamContentsResponse
): SubscriptionContents => {
    const contentList = streamContentResponse.items.map(item => {
        return createSubscriptionContentFromResponse(item);
    });
    return new SubscriptionContents({
        contents: contentList,
        lastUpdatedTimestamp: TimeStamp.createTimeStampFromSecond(streamContentResponse.updated)
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
        publishedDate: TimeStamp.createTimeStampFromSecond(streamContentResponse.published),
        updatedDate: hasUpdate
            ? TimeStamp.createTimeStampFromSecond(streamContentResponse.updated)
            : TimeStamp.createTimeStampFromSecond(streamContentResponse.published)
    });
};
