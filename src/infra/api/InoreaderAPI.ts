// MIT © 2017 azu
import { Token } from "client-oauth2";
import { getNewTokenUrl, getToken } from "./auth";
import { UnreadCountsResponse } from "./UnreadCountResponse";
import { SubscriptionsResponse } from "./SubscriptionResponse";
import { Subscription } from "../../domain/Subscriptions/Subscription";
import { StreamContentsResponse } from "./StreamContentsResponse";
import { stringify } from "querystring";

const baseURL = process.env.REACT_APP_INOREADER_API_BASE_URL;

export class InoreaderAPI {
    baseURL: string;

    constructor() {
        this.baseURL = baseURL || "";
    }

    private getToken(): Promise<Token> {
        return getToken().catch(error => {
            // TODO: make clear
            if (confirm(`Does you go to Inoreader Auth page? Error:${error.message}`)) {
                location.href = getNewTokenUrl();
            }
            return Promise.reject(error);
        });
    }

    getAuthorizeUrl() {
        return getNewTokenUrl();
    }

    getRequest(apiPath: string, parameters?: object): Promise<Response> {
        return this.getToken().then(token => {
            // Sign API requests on behalf of the current user.
            const query = parameters ? `?${stringify(parameters)}` : "";
            const requestObject = token.sign({
                method: "get",
                url: this.baseURL + apiPath + query
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
                url: this.baseURL + apiPath
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
        // use SubscriptionIdentifiers
        // http://www.inoreader.com/developers/stream-contents
        // /api/0/stream/contents/feed%2Fhttps%3A%2F%2Faddons.mozilla.org%2Fja%2Ffirefox%2Fextensions%2Fweb-development%2Fformat%3Arss%3Fsort%3Dnewest?n=20
        // http://irodr.netlify.com/api/0/stream/contents/feed/http://b.hatena.ne.jp/keyword/JavaScript?mode=rss&sort=hot&threshold=5?n=20

        const isNetlify = process.env.REACT_APP_IS_NETLIFY === "true";
        const feedId = encodeURIComponent(subscription.id.toValue());
        // Netlify proxy can't treat escaped ?
        // We want to fix this: encodeURIComponent(encodeURIComponent("?"))
        const fixedFeedId = isNetlify ? feedId.replace(/%3F/g, "%253F").replace(/%26/g, "%2526") : feedId;
        return this.getRequest(`/api/0/stream/contents/${fixedFeedId}`, {
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
