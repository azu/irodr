/**
 * Counts of the Inoreader requests that pass the CORS proxy, to see which clients and endpoints use the app's daily
 * API limits (https://www.inoreader.com/developers/rate-limiting). One Netlify Blobs entry per request, keyed
 * `<UTC date>/<client><endpoint>/<request ID>`. Keys hold no tokens or feed URLs. Count one day with the Netlify CLI:
 * netlify blobs:list inoreader-requests --prefix 2026-10-27/ --json \
 *   | jq -r '.blobs[].key | split("/") | "\(.[1]) /\(.[2:-1] | join("/"))"' | sort | uniq -c | sort -rn
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
    const api =
        /^\/reader\/api\/0\/(stream\/(?:contents|items\/ids|items\/contents)|(?:(?:subscription|tag|preferences)\/)?[\w-]{1,40}(?=\/|$))/.exec(
            pathname
        )?.[1];
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
