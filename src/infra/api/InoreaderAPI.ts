// MIT © 2017 azu
import { Token } from "client-oauth2";
import { getNewTokenUrl, getToken } from "./auth";
import { UnreadCountsResponse } from "./UnreadCountResponse";
import { SubscriptionsResponse } from "./SubscriptionResponse";
import { Subscription } from "../../domain/Subscriptions/Subscription";
import { StreamContentsResponse } from "./StreamContentsResponse";
import { stringify } from "querystring";

export class InoreaderAPI {
    private basePath = process.env.INOREADER_API_BASE_URL || "";

    private getToken(): Promise<Token> {
        return getToken().catch(error => {
            // TODO: make clear
            location.href = getNewTokenUrl();
            return Promise.reject(error);
        });
    }

    getRequest(apiPath: string, parameters?: object): Promise<Response> {
        return this.getToken().then(token => {
            // Sign API requests on behalf of the current user.
            const query = stringify ? `?${stringify(parameters)}` : "";
            const requestObject = token.sign({
                method: "get",
                url: this.basePath + apiPath + query
            });
            const headers = new Headers();
            Object.keys((requestObject as any).headers).forEach(key => {
                headers.append(key, (requestObject as any).headers[key]);
            });
            return fetch(requestObject.url, {
                method: requestObject.method,
                headers: headers
            });
        });
    }

    postRequest<T>(apiPath: string, body: object): Promise<T> {
        return this.getToken().then(token => {
            // Sign API requests on behalf of the current user.
            const requestObject = token.sign({
                method: "post",
                url: this.basePath + apiPath
            });
            const headers = new Headers();
            Object.keys((requestObject as any).headers).forEach(key => {
                headers.append(key, (requestObject as any).headers[key]);
            });
            headers.append("Accept", "application/json, text/plain, */*");
            headers.append("Content-Type", "application/json");
            return fetch(requestObject.url, {
                method: requestObject.method,
                headers: headers,
                body: JSON.stringify(body)
            })
                .then(res => res.json())
                .then(function(res: T) {
                    return res;
                });
        });
    }

    subscriptions(): Promise<SubscriptionsResponse> {
        return this.getRequest("/api/0/subscription/list")
            .then(res => res.json())
            .then(function(res: SubscriptionsResponse) {
                return res;
            });
    }

    unreadCounts(): Promise<UnreadCountsResponse> {
        return this.getRequest("/api/0/unread-count")
            .then(res => res.json())
            .then(function(res: UnreadCountsResponse) {
                return res;
            });
    }

    streamContents(subscription: Subscription, prefetchSubscriptionCount: number): Promise<StreamContentsResponse> {
        // use SubscriptionIdentifier
        // http://www.inoreader.com/developers/stream-contents
        return this.getRequest(`/api/0/stream/contents/${encodeURIComponent(subscription.id.toValue())}`, {
            n: prefetchSubscriptionCount
        })
            .then(res => res.json())
            .then(function(res: StreamContentsResponse) {
                return res;
            });
    }

    markAsRead(subscription: Subscription): Promise<boolean> {
        // http://www.inoreader.com/developers/mark-all-as-read
        return this.getRequest("/api/0/mark-all-as-read", {
            s: subscription.id.toValue(),
            ts: subscription.unread.readTimestamp.second
        })
            .then(res => res.text())
            .then((res: string) => {
                return res === "ok";
            });
    }
}
