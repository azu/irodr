// MIT © 2017 azu
import { Token } from "client-oauth2";
import { UnreadCountsResponse } from "./UnreadCountResponse";
import { SubscriptionsResponse } from "./SubscriptionResponse";
import { Subscription } from "../../domain/Subscriptions/Subscription";
import { StreamContentsResponse } from "./StreamContentsResponse";
import { stringify } from "querystring";
import { InoreaderAuthority } from "../../domain/App/Authority/InoreaderAuthority";
import { OAuth } from "./OAuth";

const debug = require("debug")("irodr:InoreaderAPI");
const baseURL = process.env.REACT_APP_INOREADER_API_BASE_URL;

export class InoreaderAPI {
    baseURL: string;
    private auth: OAuth;

    constructor(private inoreaderAuthority: InoreaderAuthority) {
        this.auth = new OAuth({
            clientId: this.inoreaderAuthority.clientId,
            clientSecret: this.inoreaderAuthority.clientSecret,
            accessTokenUri: this.inoreaderAuthority.accessTokenUri,
            authorizationUri: this.inoreaderAuthority.authorizationUri,
            scopes: this.inoreaderAuthority.scopes,
            state: this.inoreaderAuthority.state
        });
        this.baseURL = baseURL || "";
    }

    getToken(): Promise<Token> {
        return this.auth.getToken();
    }

    saveTokenFromCallbackURL(url: string) {
        return this.auth.saveTokenFromCallbackURL(url);
    }

    getAuthorizeUrl() {
        return this.auth.getNewTokenUrl();
    }

    getRequest(apiPath: string, parameters?: { [index: string]: any }): Promise<Response> {
        return this.getToken()
            .then(token => {
                debug("token", token);
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
                    headers: headers,
                    credentials: "include"
                });
            })
            .catch(error => {
                debug("Fetch Error", error);
                return Promise.reject(error);
            });
    }

    postRequest<T>(apiPath: string, body: object): Promise<T> {
        return this.getToken()
            .then(token => {
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
            })
            .catch(error => {
                debug("Fetch Error", error);
                return Promise.reject(error);
            });
    }

    subscriptions(): Promise<SubscriptionsResponse> {
        return this.getRequest("/api/0/subscription/list")
            .then(res => {
                debug("res", res);
                return res.json();
            })
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

    streamContents(
        subscription: Subscription,
        fetchCount: number,
        isContinuous?: boolean
    ): Promise<StreamContentsResponse> {
        // use SubscriptionIdentifiers
        // http://www.inoreader.com/developers/stream-contents
        // /api/0/stream/contents/feed%2Fhttps%3A%2F%2Faddons.mozilla.org%2Fja%2Ffirefox%2Fextensions%2Fweb-development%2Fformat%3Arss%3Fsort%3Dnewest?n=20
        // http://irodr.netlify.com/api/0/stream/contents/feed/http://b.hatena.ne.jp/keyword/JavaScript?mode=rss&sort=hot&threshold=5?n=20
        const feedId = encodeURIComponent(subscription.id.toValue());
        return this.getRequest(`/api/0/stream/contents/${feedId}`, {
            n: fetchCount,
            c: isContinuous && subscription.contents.continuationKey ? subscription.contents.continuationKey : undefined
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
