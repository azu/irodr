import { getStore } from "@netlify/blobs";
import { CLIENT_HEADER, clientOf, endpointOf, STATS_STORE, statsKey } from "../inoreader-stats.ts";

const isInoreaderUrl = (url: string) => {
    const url1 = new URL(url);
    return url1.origin === "https://www.inoreader.com" || url1.origin === "https://jp.inoreader.com";
};
export default async (req: Request, context: { readonly waitUntil: (promise: Promise<unknown>) => void }) => {
    try {
        const url = new URL(req.url);
        if (req.method === "OPTIONS") {
            return new Response(null, {
                status: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
                    "Access-Control-Allow-Headers": `Authorization, Content-Type, ${CLIENT_HEADER}`
                }
            });
        }
        // https://host.test/cors-proxy/https://example.com?q=1
        // -> https://example.com?q=1
        const targetUrl = url.pathname.replace("/cors-proxy/", "");
        const targetUrlWithQuery = targetUrl + url.search;
        const proxyReq = new Request(targetUrlWithQuery, req);
        proxyReq.headers.delete(CLIENT_HEADER);
        if (!isInoreaderUrl(proxyReq.url)) {
            return new Response("Bad Origin", {
                status: 400
            });
        }
        const response = await fetch(proxyReq);
        // Count the request after answering it; a failed count must not fail the request.
        const key = statsKey(new Date(), clientOf(req), endpointOf(proxyReq.url), crypto.randomUUID());
        context.waitUntil(
            getStore(STATS_STORE)
                .set(key, "")
                .catch(() => undefined)
        );
        // always no cache
        // https://docs.netlify.com/edge-functions/optional-configuration/
        const proxiedResponse = new Response(response.body, response);
        proxiedResponse.headers.set("Cache-Control", "no-store");
        return proxiedResponse;
    } catch (e: any) {
        return new Response(e.message, {
            status: 500
        });
    }
};

export const config = { cache: "manual", path: "/cors-proxy/*" };
