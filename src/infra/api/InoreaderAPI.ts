// MIT © 2017 azu
import { Token } from "client-oauth2";
import { getNewTokenUrl, getToken } from "./auth";
import { UnreadCountsResponse } from "./UnreadCountResponse";
import { SubscriptionsResponse } from "./SubscriptionResponse";
import { Subscription } from "../../domain/Subscriptions/Subscription";
import { StreamContentsResponse } from "./StreamContentsResponse";

export class InoreaderAPI {
    private basePath = "";

    private getToken(): Promise<Token> {
        return getToken().catch(error => {
            // TODO: make clear
            location.href = getNewTokenUrl();
            return Promise.reject(error);
        });
    }

    getRequest<T>(apiPath: string): Promise<T> {
        return this.getToken().then(token => {
            // Sign API requests on behalf of the current user.
            const requestObject = token.sign({
                method: "get",
                url: this.basePath + apiPath
            });
            const headers = new Headers();
            Object.keys((requestObject as any).headers).forEach(key => {
                headers.append(key, (requestObject as any).headers[key]);
            });
            return fetch(requestObject.url, {
                method: requestObject.method,
                headers: headers
            })
                .then(res => res.json())
                .then(function(res: T) {
                    return res;
                });
        });
    }

    subscriptions(): Promise<SubscriptionsResponse> {
        return this.getRequest<SubscriptionsResponse>("/api/0/subscription/list");
    }

    unreadCounts(): Promise<UnreadCountsResponse> {
        return this.getRequest<UnreadCountsResponse>("/api/0/unread-count");
    }

    streamContents(subscription: Subscription): Promise<StreamContentsResponse> {
        // use SubscriptionIdentifier
        // http://www.inoreader.com/developers/stream-contents
        return this.getRequest<StreamContentsResponse>(
            `/api/0/stream/contents/${encodeURIComponent(subscription.id.toValue())}`
        );
    }
}
