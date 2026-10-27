/**
 * Counts of the Inoreader requests that pass the CORS proxy, to see which clients and endpoints use the app's daily
 * API limits (https://www.inoreader.com/developers/rate-limiting). One Netlify Blobs entry per request, keyed
 * `<UTC date>/<client><endpoint>/<request ID>`; `/cors-proxy-stats` counts them. Keys hold no tokens or feed URLs.
 */
export const STATS_STORE = "inoreader-requests";

/** Sent by irodr 2 through the proxy, which removes it. Requests without it come from irodr 1.x or other clients. */
export const CLIENT_HEADER = "X-Irodr-Client";

/**
 * The Inoreader endpoint of a URL, without stream IDs or query: feed URLs can carry credentials.
 * e.g. https://www.inoreader.com/reader/api/0/stream/contents/feed%2F... -> /reader/api/0/stream/contents
 */
export function endpointOf(url: string): string {
    const { pathname } = new URL(url);
    const api = /^\/reader\/api\/0\/(stream\/(?:contents|items\/ids|items\/contents)|[\w-]+)/.exec(pathname)?.[1];
    if (api) return `/reader/api/0/${api}`;
    return pathname === "/oauth2/token" ? pathname : "/other";
}

/** The client that sent a proxied request: "2" for irodr 2, "legacy" otherwise. */
export function clientOf(request: Request): string {
    return request.headers.get(CLIENT_HEADER) === "2" ? "2" : "legacy";
}

export function statsKey(date: Date, client: string, endpoint: string, id: string): string {
    return `${date.toISOString().slice(0, 10)}/${client}${endpoint}/${id}`;
}

/** Requests per "<client> <endpoint>", most first, from the keys of one day. */
export function countKeys(keys: readonly string[]): Record<string, number> {
    const counts = keys.reduce((counted, key) => {
        const [, client, ...rest] = key.split("/");
        const name = `${client} /${rest.slice(0, -1).join("/")}`;
        return counted.set(name, (counted.get(name) ?? 0) + 1);
    }, new Map<string, number>());
    return Object.fromEntries([...counts].toSorted((a, b) => b[1] - a[1]));
}
