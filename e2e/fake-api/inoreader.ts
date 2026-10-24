import { bearer, escapeHtml, type FakeRequest, type FakeResponse, formBody, html, json, text } from "./http.ts";

/**
 * A fake Inoreader implementing the parts of https://www.inoreader.com/developers/ irodr uses:
 * OAuth 2.0 (authorization code + refresh token), subscription list, unread counts,
 * stream contents with continuation, item IDs, mark-all-as-read, and saving web pages
 * (`save-web-page`, the request of Inoreader's browser extension; not in the public documentation).
 */

export interface InoreaderItemSeed {
    readonly id: string;
    readonly title: string;
    readonly content?: string;
    readonly url?: string;
    readonly author?: string;
    /** Seconds */
    readonly published: number;
    /** Seconds */
    readonly updated?: number;
    readonly read?: boolean;
    readonly enclosure?: readonly { readonly href: string; readonly type: string }[];
}

export interface InoreaderSubscriptionSeed {
    /** Stream ID, e.g. feed/https://example.com/rss */
    readonly id: string;
    readonly title: string;
    readonly categories?: readonly string[];
    readonly url?: string;
    readonly htmlUrl?: string;
    readonly iconUrl?: string;
    /** Newest first. */
    readonly items: readonly InoreaderItemSeed[];
}

/** Behavior tests can change at any time with `configure`. */
export interface InoreaderConfig {
    /** Exhausted API zones, which respond with HTTP 429. */
    readonly rateLimitedZones: readonly (1 | 2)[];
    /** X-Reader-Limits-Reset-After, in seconds; omitted when a proxy hides the header. */
    readonly limitsResetAfter?: number;
    /** Seconds until an access token expires. */
    readonly tokenLifetime: number;
    /** Streams whose contents requests fail with HTTP 500. */
    readonly failingStreams: readonly string[];
    /** Streams whose mark-all-as-read requests fail with HTTP 500. */
    readonly failingMarkRead: readonly string[];
    /** HTTP status the token endpoint answers with, e.g. 503 for an outage. */
    readonly tokenFailure?: number;
}

export interface InoreaderScenario extends Partial<InoreaderConfig> {
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly subscriptions?: readonly InoreaderSubscriptionSeed[];
}

export interface FakeInoreader {
    /** Replace the subscriptions and configuration, and forget every code and token. */
    reset: (scenario?: InoreaderScenario) => void;
    /** Change the configuration keys the patch names. */
    configure: (patch: Partial<InoreaderConfig>) => void;
    /** Add items to the top of a stream (newest first). */
    addItems: (streamId: string, seeds: readonly InoreaderItemSeed[]) => void;
    /** Mark every item of a stream unread, as if it happened in another client. */
    markUnread: (streamId: string) => void;
    /** Expire every access token, as if an hour had passed. */
    expireTokens: () => void;
    streamIds: () => string[];
    unreadCount: (streamId: string) => number;
    /** URLs of the saved web pages, newest first. */
    savedUrls: () => string[];
    handle: (request: FakeRequest, path: string) => FakeResponse;
}

interface Item extends InoreaderItemSeed {
    readonly timestampUsec: number;
    readonly read: boolean;
}

interface Stream {
    readonly seed: InoreaderSubscriptionSeed;
    /** Newest first. */
    readonly items: readonly Item[];
}

interface State {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly config: InoreaderConfig;
    readonly streams: ReadonlyMap<string, Stream>;
    /** Authorization code → the redirect URI it was issued for. */
    readonly codes: ReadonlyMap<string, { readonly redirectUri: string }>;
    /** Access token → expiry in epoch milliseconds. */
    readonly accessTokens: ReadonlyMap<string, number>;
    readonly refreshTokens: ReadonlySet<string>;
    /** Items added since the fake was created, for unique crawl time suffixes. Resets keep it. */
    readonly sequence: number;
}

const USER = "user/1005921515";
const READ = `${USER}/state/com.google/read`;
/** Saved web pages, a state stream: not a subscription, and not in unread-count. */
const SAVED_WEB_PAGES = "user/-/state/com.google/saved-web-pages";

/** Stream IDs name the current user as "user/-". */
function normalizeStreamId(streamId: string): string {
    return streamId.replace(`${USER}/`, "user/-/");
}

function isSubscription(streamId: string): boolean {
    return !streamId.startsWith("user/");
}

/** Replace the items of a known stream. */
function withStreamItems(state: State, streamId: string, change: (items: readonly Item[]) => readonly Item[]): State {
    const stream = state.streams.get(streamId);
    if (!stream) throw new Error(`Unknown stream ${streamId}`);
    return { ...state, streams: new Map(state.streams).set(streamId, { ...stream, items: change(stream.items) }) };
}

/** Add items to the top of a stream (newest first). */
function withItems(state: State, streamId: string, seeds: readonly InoreaderItemSeed[]): State {
    const added = withStreamItems(state, streamId, (current) => {
        const items = seeds.map((seed, index) => ({
            ...seed,
            // Crawl time with microsecond resolution and a unique suffix, like Inoreader.
            timestampUsec: (seed.updated ?? seed.published) * 1_000_000 + ((state.sequence + index + 1) % 1000),
            read: seed.read ?? false
        }));
        return [...items, ...current].toSorted((a, b) => b.timestampUsec - a.timestampUsec);
    });
    return { ...added, sequence: state.sequence + seeds.length };
}

function withSubscription(state: State, seed: InoreaderSubscriptionSeed): State {
    return withItems(
        { ...state, streams: new Map(state.streams).set(seed.id, { seed, items: [] }) },
        seed.id,
        seed.items
    );
}

function scenarioState(scenario: InoreaderScenario, sequence: number): State {
    const empty: State = {
        clientId: scenario.clientId ?? "e2e-client",
        clientSecret: scenario.clientSecret ?? "e2e-secret",
        config: {
            rateLimitedZones: [...new Set(scenario.rateLimitedZones ?? [])],
            limitsResetAfter: scenario.limitsResetAfter,
            tokenLifetime: scenario.tokenLifetime ?? 3600,
            // Copied through a Set: `POST /__control/reset` passes its JSON through unchecked, and a
            // non-iterable value must fail the reset rather than every later request.
            failingStreams: [...new Set(scenario.failingStreams ?? [])],
            failingMarkRead: [...new Set(scenario.failingMarkRead ?? [])],
            tokenFailure: scenario.tokenFailure
        },
        streams: new Map(),
        codes: new Map(),
        accessTokens: new Map(),
        refreshTokens: new Set(),
        sequence
    };
    return (scenario.subscriptions ?? []).reduce(withSubscription, {
        ...empty,
        streams: new Map([
            [SAVED_WEB_PAGES, { seed: { id: SAVED_WEB_PAGES, title: "Saved web pages", items: [] }, items: [] }]
        ])
    });
}

function configured(state: State, patch: Partial<InoreaderConfig>): State {
    return { ...state, config: { ...state.config, ...patch } };
}

function withCode(state: State, code: string, redirectUri: string): State {
    return { ...state, codes: new Map(state.codes).set(code, { redirectUri }) };
}

function withoutCode(state: State, code: string): State {
    return { ...state, codes: new Map([...state.codes].filter(([key]) => key !== code)) };
}

/** Grant an access token until `expires` (epoch milliseconds), refreshable with `refreshToken`. */
function withTokens(state: State, accessToken: string, expires: number, refreshToken: string): State {
    return {
        ...state,
        accessTokens: new Map(state.accessTokens).set(accessToken, expires),
        refreshTokens: new Set(state.refreshTokens).add(refreshToken)
    };
}

function withExpiredTokens(state: State): State {
    return { ...state, accessTokens: new Map([...state.accessTokens.keys()].map((token) => [token, 0])) };
}

/** Mark read the items of a stream crawled before `timestampUsec`. */
function withReadBefore(state: State, streamId: string, timestampUsec: number): State {
    return withStreamItems(state, streamId, (items) =>
        items.map((item) => (item.timestampUsec < timestampUsec ? { ...item, read: true } : item))
    );
}

function withAllUnread(state: State, streamId: string): State {
    return withStreamItems(state, streamId, (items) => items.map((item) => ({ ...item, read: false })));
}

function subscriptionList(state: State): FakeResponse {
    return json({
        subscriptions: [...state.streams.values()]
            .filter(({ seed }) => isSubscription(seed.id))
            .map(({ seed, items }, index) => ({
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

function unreadCounts(state: State): FakeResponse {
    return json({
        max: "1000",
        unreadcounts: [...state.streams.values()]
            .filter(({ seed }) => isSubscription(seed.id))
            .map(({ seed, items }) => ({
                id: seed.id,
                count: items.filter((item) => !item.read).length,
                newestItemTimestampUsec: String(items[0]?.timestampUsec ?? 0)
            }))
    });
}

function streamContents(state: State, streamId: string, url: URL): FakeResponse {
    const stream = state.streams.get(streamId);
    if (!stream) return json({ error: "not found" }, 404);
    if (state.config.failingStreams.includes(streamId)) return text("Internal Server Error", 500);
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
            alternate: [{ href: item.url ?? `https://example.com/${encodeURIComponent(item.id)}`, type: "text/html" }],
            summary: { direction: "ltr", content: item.content ?? "" },
            author: item.author ?? "",
            enclosure: item.enclosure,
            origin: { streamId, title: stream.seed.title, htmlUrl: stream.seed.htmlUrl ?? "https://example.com/" }
        })),
        ...(next ? { continuation: next } : {})
    });
}

/** https://www.inoreader.com/developers/item-ids, with `xt` limited to the read state. */
function itemIds(state: State, url: URL): FakeResponse {
    const streamId = normalizeStreamId(url.searchParams.get("s") ?? "");
    const stream = state.streams.get(streamId);
    if (!stream) return json({ error: "not found" }, 404);
    if (state.config.failingStreams.includes(streamId)) return text("Internal Server Error", 500);
    const unreadOnly = normalizeStreamId(url.searchParams.get("xt") ?? "") === "user/-/state/com.google/read";
    const count = Math.min(Number(url.searchParams.get("n") ?? 20) || 20, 1000);
    const items = stream.items.filter((item) => !unreadOnly || !item.read).slice(0, count);
    return json({
        items: [],
        itemRefs: items.map((item) => ({ id: item.id, directStreamIds: [], timestampUsec: String(item.timestampUsec) }))
    });
}

export function createFakeInoreader(): FakeInoreader {
    const current = { state: scenarioState({}, 0) };

    /** The consent page: the test clicks "Authorize" like a user. */
    const authorize = (request: FakeRequest): FakeResponse => {
        const params = request.url.searchParams;
        const redirectUri = params.get("redirect_uri");
        if (
            params.get("client_id") !== current.state.clientId ||
            params.get("response_type") !== "code" ||
            !redirectUri
        ) {
            return html("<h1>Invalid authorization request</h1>", 400);
        }
        const code = `code-${crypto.randomUUID()}`;
        current.state = withCode(current.state, code, redirectUri);
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
    };

    const issue = (refreshToken: string) => {
        const accessToken = `access-${crypto.randomUUID()}`;
        const lifetime = current.state.config.tokenLifetime;
        current.state = withTokens(current.state, accessToken, Date.now() + lifetime * 1000, refreshToken);
        return {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: lifetime,
            refresh_token: refreshToken,
            scope: "read write"
        };
    };

    const grantToken = (request: FakeRequest): FakeResponse => {
        const { tokenFailure } = current.state.config;
        if (tokenFailure) return text("Service Unavailable", tokenFailure);
        const form = formBody(request);
        const basic = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1];
        const [basicId, basicSecret] = basic ? atob(basic).split(":") : [];
        const clientId = form.get("client_id") ?? basicId;
        const clientSecret = form.get("client_secret") ?? basicSecret;
        if (clientId !== current.state.clientId || clientSecret !== current.state.clientSecret) {
            return json({ error: "invalid_client" }, 401);
        }
        const grant = form.get("grant_type");
        if (grant === "authorization_code") {
            const code = current.state.codes.get(form.get("code") ?? "");
            if (!code || code.redirectUri !== form.get("redirect_uri")) return json({ error: "invalid_grant" }, 400);
            current.state = withoutCode(current.state, form.get("code") ?? "");
            return json(issue(`refresh-${crypto.randomUUID()}`));
        }
        if (grant === "refresh_token") {
            const refresh = form.get("refresh_token") ?? "";
            if (!current.state.refreshTokens.has(refresh)) return json({ error: "invalid_grant" }, 400);
            return json(issue(refresh));
        }
        return json({ error: "unsupported_grant_type" }, 400);
    };

    const markAllAsRead = (request: FakeRequest): FakeResponse => {
        const params = request.method === "POST" && request.body ? formBody(request) : request.url.searchParams;
        const streamId = normalizeStreamId(params.get("s") ?? "");
        if (!current.state.streams.has(streamId)) return text("Unknown stream", 400);
        if (current.state.config.failingMarkRead.includes(streamId)) return text("Internal Server Error", 500);
        const raw = Number(params.get("ts"));
        // "Unix Timestamp in seconds or microseconds"; articles older than it are marked read.
        const ts = raw < 1e12 ? raw * 1_000_000 : raw;
        current.state = withReadBefore(current.state, streamId, ts);
        return text("OK");
    };

    /** Save a web page by its URL, as Inoreader's browser extension does. Answers the saved article's path. */
    const saveWebPage = (request: FakeRequest): FakeResponse => {
        if (request.method !== "POST") return text("Method Not Allowed", 405);
        const pageUrl = request.url.searchParams.get("url") ?? "";
        if (!URL.canParse(pageUrl)) return text("Invalid URL", 400);
        const id = (current.state.sequence + 1).toString(16).padStart(16, "0");
        current.state = withItems(current.state, SAVED_WEB_PAGES, [
            {
                id: `tag:google.com,2005:reader/item/${id}`,
                title: `Saved page ${pageUrl}`,
                url: pageUrl,
                content: `<p>Saved from ${escapeHtml(pageUrl)}.</p>`,
                published: Math.floor(Date.now() / 1000)
            }
        ]);
        return text(`/article/${id}`);
    };

    const handle = (request: FakeRequest, path: string): FakeResponse => {
        if (path === "/oauth2/auth" && request.method === "GET") return authorize(request);
        if (path === "/oauth2/token" && request.method === "POST") return grantToken(request);
        if (!path.startsWith("/reader/api/0/")) return json({ error: "not found" }, 404);
        const token = bearer(request);
        const expires = token ? current.state.accessTokens.get(token) : undefined;
        if (expires === undefined || expires <= Date.now()) return text("Unauthorized", 401);
        const api = path.slice("/reader/api/0".length);
        // https://www.inoreader.com/developers/rate-limiting
        const zone = api === "/mark-all-as-read" || api === "/save-web-page" ? 2 : 1;
        if (current.state.config.rateLimitedZones.includes(zone)) {
            const seconds = current.state.config.limitsResetAfter;
            return text(
                "Rate limit exceeded",
                429,
                seconds === undefined ? {} : { "X-Reader-Limits-Reset-After": String(seconds) }
            );
        }
        if (api === "/subscription/list") return subscriptionList(current.state);
        if (api === "/unread-count") return unreadCounts(current.state);
        if (api.startsWith("/stream/contents/")) {
            const streamId = normalizeStreamId(decodeURIComponent(api.slice("/stream/contents/".length)));
            return streamContents(current.state, streamId, request.url);
        }
        if (api === "/stream/items/ids") return itemIds(current.state, request.url);
        if (api === "/mark-all-as-read") return markAllAsRead(request);
        if (api === "/save-web-page") return saveWebPage(request);
        return json({ error: "not found" }, 404);
    };

    return {
        reset: (scenario = {}) => {
            current.state = scenarioState(scenario, current.state.sequence);
        },
        configure: (patch) => {
            current.state = configured(current.state, patch);
        },
        addItems: (streamId, seeds) => {
            current.state = withItems(current.state, streamId, seeds);
        },
        markUnread: (streamId) => {
            current.state = withAllUnread(current.state, streamId);
        },
        expireTokens: () => {
            current.state = withExpiredTokens(current.state);
        },
        streamIds: () => [...current.state.streams.keys()].filter(isSubscription),
        savedUrls: () => current.state.streams.get(SAVED_WEB_PAGES)?.items.map((item) => item.url ?? "") ?? [],
        unreadCount: (streamId) => current.state.streams.get(streamId)?.items.filter((item) => !item.read).length ?? 0,
        handle
    };
}
