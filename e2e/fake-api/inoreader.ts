import { bearer, escapeHtml, type FakeRequest, type FakeResponse, formBody, html, json, text } from "./http.ts";

/**
 * A fake Inoreader implementing the parts of https://www.inoreader.com/developers/ irodr uses:
 * OAuth 2.0 (authorization code + refresh token), subscription list, unread counts,
 * stream contents with continuation, and mark-all-as-read.
 */

export interface InoreaderItemSeed {
    id: string;
    title: string;
    content?: string;
    url?: string;
    author?: string;
    /** Seconds */
    published: number;
    /** Seconds */
    updated?: number;
    read?: boolean;
    enclosure?: { href: string; type: string }[];
}

export interface InoreaderSubscriptionSeed {
    /** Stream ID, e.g. feed/https://example.com/rss */
    id: string;
    title: string;
    categories?: string[];
    url?: string;
    htmlUrl?: string;
    iconUrl?: string;
    /** Newest first. */
    items: InoreaderItemSeed[];
}

export interface InoreaderScenario {
    clientId?: string;
    clientSecret?: string;
    /** Seconds until an access token expires. */
    tokenLifetime?: number;
    subscriptions?: InoreaderSubscriptionSeed[];
    /** Streams whose contents requests fail with HTTP 500. */
    failingStreams?: string[];
    /** Streams whose mark-all-as-read requests fail with HTTP 500. */
    failingMarkRead?: string[];
}

interface Item extends InoreaderItemSeed {
    timestampUsec: number;
    read: boolean;
}

interface Stream {
    seed: InoreaderSubscriptionSeed;
    items: Item[];
}

const USER = "user/1005921515";
const READ = `${USER}/state/com.google/read`;

export class FakeInoreader {
    clientId = "e2e-client";
    clientSecret = "e2e-secret";
    tokenLifetime = 3600;
    streams = new Map<string, Stream>();
    failingStreams = new Set<string>();
    failingMarkRead = new Set<string>();
    #codes = new Map<string, { redirectUri: string }>();
    #accessTokens = new Map<string, number>();
    #refreshTokens = new Set<string>();
    #sequence = 0;

    reset(scenario: InoreaderScenario = {}): void {
        this.clientId = scenario.clientId ?? "e2e-client";
        this.clientSecret = scenario.clientSecret ?? "e2e-secret";
        this.tokenLifetime = scenario.tokenLifetime ?? 3600;
        this.streams = new Map();
        for (const seed of scenario.subscriptions ?? []) this.addSubscription(seed);
        this.failingStreams = new Set(scenario.failingStreams ?? []);
        this.failingMarkRead = new Set(scenario.failingMarkRead ?? []);
        this.#codes.clear();
        this.#accessTokens.clear();
        this.#refreshTokens.clear();
    }

    addSubscription(seed: InoreaderSubscriptionSeed): void {
        this.streams.set(seed.id, { seed, items: [] });
        this.addItems(seed.id, seed.items);
    }

    /** Add items to the top of a stream (newest first). */
    addItems(streamId: string, seeds: InoreaderItemSeed[]): void {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error(`Unknown stream ${streamId}`);
        const items = seeds.map((seed) => ({
            ...seed,
            // Crawl time with microsecond resolution and a unique suffix, like Inoreader.
            timestampUsec: (seed.updated ?? seed.published) * 1_000_000 + (++this.#sequence % 1000),
            read: seed.read ?? false
        }));
        stream.items = [...items, ...stream.items].sort((a, b) => b.timestampUsec - a.timestampUsec);
    }

    /** Expire every access token, as if an hour had passed. */
    expireTokens(): void {
        for (const token of this.#accessTokens.keys()) this.#accessTokens.set(token, 0);
    }

    unreadCount(streamId: string): number {
        return this.streams.get(streamId)?.items.filter((item) => !item.read).length ?? 0;
    }

    handle(request: FakeRequest, path: string): FakeResponse {
        if (path === "/oauth2/auth" && request.method === "GET") return this.authorize(request);
        if (path === "/oauth2/token" && request.method === "POST") return this.token(request);
        if (!path.startsWith("/reader/api/0/")) return json({ error: "not found" }, 404);
        const token = bearer(request);
        const expires = token ? this.#accessTokens.get(token) : undefined;
        if (expires === undefined || expires <= Date.now()) return text("Unauthorized", 401);
        const api = path.slice("/reader/api/0".length);
        if (api === "/subscription/list") return this.subscriptionList();
        if (api === "/unread-count") return this.unreadCounts();
        if (api.startsWith("/stream/contents/")) {
            return this.streamContents(decodeURIComponent(api.slice("/stream/contents/".length)), request.url);
        }
        if (api === "/mark-all-as-read") return this.markAllAsRead(request);
        return json({ error: "not found" }, 404);
    }

    /** The consent page: the test clicks "Authorize" like a user. */
    private authorize(request: FakeRequest): FakeResponse {
        const params = request.url.searchParams;
        const redirectUri = params.get("redirect_uri");
        if (params.get("client_id") !== this.clientId || params.get("response_type") !== "code" || !redirectUri) {
            return html("<h1>Invalid authorization request</h1>", 400);
        }
        const code = `code-${crypto.randomUUID()}`;
        this.#codes.set(code, { redirectUri });
        const approve = new URL(redirectUri);
        approve.searchParams.set("code", code);
        approve.searchParams.set("state", params.get("state") ?? "");
        const deny = new URL(redirectUri);
        deny.searchParams.set("error", "access_denied");
        deny.searchParams.set("state", params.get("state") ?? "");
        return html(`<!doctype html><title>Fake Inoreader</title>
<h1>Authorize irodr?</h1>
<p>Scope: ${escapeHtml(params.get("scope") ?? "")}</p>
<a id="authorize" href="${escapeHtml(approve.toString())}">Authorize</a>
<a id="deny" href="${escapeHtml(deny.toString())}">Deny</a>`);
    }

    private token(request: FakeRequest): FakeResponse {
        const form = formBody(request);
        const basic = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1];
        const [basicId, basicSecret] = basic ? atob(basic).split(":") : [];
        const clientId = form.get("client_id") ?? basicId;
        const clientSecret = form.get("client_secret") ?? basicSecret;
        if (clientId !== this.clientId || clientSecret !== this.clientSecret) {
            return json({ error: "invalid_client" }, 401);
        }
        const grant = form.get("grant_type");
        if (grant === "authorization_code") {
            const code = this.#codes.get(form.get("code") ?? "");
            if (!code || code.redirectUri !== form.get("redirect_uri")) return json({ error: "invalid_grant" }, 400);
            this.#codes.delete(form.get("code") ?? "");
            return json(this.issue(`refresh-${crypto.randomUUID()}`));
        }
        if (grant === "refresh_token") {
            const refresh = form.get("refresh_token") ?? "";
            if (!this.#refreshTokens.has(refresh)) return json({ error: "invalid_grant" }, 400);
            return json(this.issue(refresh));
        }
        return json({ error: "unsupported_grant_type" }, 400);
    }

    private issue(refreshToken: string) {
        const accessToken = `access-${crypto.randomUUID()}`;
        this.#accessTokens.set(accessToken, Date.now() + this.tokenLifetime * 1000);
        this.#refreshTokens.add(refreshToken);
        return {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: this.tokenLifetime,
            refresh_token: refreshToken,
            scope: "read write"
        };
    }

    private subscriptionList(): FakeResponse {
        return json({
            subscriptions: [...this.streams.values()].map(({ seed, items }, index) => ({
                id: seed.id,
                title: seed.title,
                categories: (seed.categories ?? []).map((label) => ({ id: `${USER}/label/${label}`, label })),
                sortid: String(index).padStart(8, "0"),
                firstitemmsec: (items.at(-1)?.timestampUsec ?? 0) - 1,
                url: seed.url ?? seed.id.replace(/^feed\//, ""),
                htmlUrl: seed.htmlUrl ?? "https://example.com/",
                iconUrl: seed.iconUrl ?? ""
            }))
        });
    }

    private unreadCounts(): FakeResponse {
        return json({
            max: "1000",
            unreadcounts: [...this.streams.values()].map(({ seed, items }) => ({
                id: seed.id,
                count: items.filter((item) => !item.read).length,
                newestItemTimestampUsec: String(items[0]?.timestampUsec ?? 0)
            }))
        });
    }

    private streamContents(streamId: string, url: URL): FakeResponse {
        const stream = this.streams.get(streamId);
        if (!stream) return json({ error: "not found" }, 404);
        if (this.failingStreams.has(streamId)) return text("Internal Server Error", 500);
        const count = Math.min(Number(url.searchParams.get("n") ?? 20) || 20, 100);
        const offset = Number(url.searchParams.get("c") ?? 0) || 0;
        const page = stream.items.slice(offset, offset + count);
        const next = offset + count < stream.items.length ? String(offset + count) : undefined;
        return json({
            direction: "ltr",
            id: streamId,
            title: stream.seed.title,
            description: "",
            self: { href: url.toString() },
            updated: Math.floor((stream.items[0]?.timestampUsec ?? 0) / 1_000_000),
            updatedUsec: String(stream.items[0]?.timestampUsec ?? 0),
            items: page.map((item) => ({
                crawlTimeMsec: String(Math.floor(item.timestampUsec / 1000)),
                timestampUsec: String(item.timestampUsec),
                id: item.id,
                categories: [`${USER}/state/com.google/reading-list`, ...(item.read ? [READ] : [])],
                title: item.title,
                published: item.published,
                updated: item.updated ?? 0,
                canonical: [{ href: item.url ?? `https://example.com/${encodeURIComponent(item.id)}` }],
                alternate: [
                    { href: item.url ?? `https://example.com/${encodeURIComponent(item.id)}`, type: "text/html" }
                ],
                summary: { direction: "ltr", content: item.content ?? "" },
                author: item.author ?? "",
                enclosure: item.enclosure,
                origin: { streamId, title: stream.seed.title, htmlUrl: stream.seed.htmlUrl ?? "https://example.com/" }
            })),
            ...(next ? { continuation: next } : {})
        });
    }

    private markAllAsRead(request: FakeRequest): FakeResponse {
        const params = request.method === "POST" && request.body ? formBody(request) : request.url.searchParams;
        const streamId = params.get("s") ?? "";
        const stream = this.streams.get(streamId);
        if (!stream) return text("Unknown stream", 400);
        if (this.failingMarkRead.has(streamId)) return text("Internal Server Error", 500);
        const raw = Number(params.get("ts"));
        // "Unix Timestamp in seconds or microseconds"; articles older than it are marked read.
        const ts = raw < 1e12 ? raw * 1_000_000 : raw;
        for (const item of stream.items) {
            if (item.timestampUsec < ts) item.read = true;
        }
        return text("OK");
    }
}
