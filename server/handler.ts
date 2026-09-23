/**
 * irodr-local: serves the built irodr and the local API (docs/local-server.md) as one
 * `(Request) => Promise<Response>` handler, so any runtime (Node, Bun) can host it.
 */
import { parseSegments, type TranslationSegment } from "../src/lib/translation-segment.ts";
import type { TranslateStream } from "../src/lib/translation-stream.ts";
import { translationResponse } from "./translation-response.ts";

export interface Asset {
    readonly body: Uint8Array<ArrayBuffer>;
    readonly contentType: string;
}

/** The built app (`dist/`), by URL path such as "/index.html". */
export interface Assets {
    get: (path: string) => Asset | undefined;
}

export interface Translator {
    translate: (texts: readonly string[], sourceLanguage: string, targetLanguage: string) => Promise<string[]>;
    translateStream?: TranslateStream;
    /** Paragraphs with inline markup; see src/lib/translation-segment.ts. */
    translateSegments?: (
        segments: readonly TranslationSegment[],
        sourceLanguage: string,
        targetLanguage: string
    ) => Promise<TranslationSegment[]>;
}

export interface LocalServerOptions {
    /** The origins the page is served from, e.g. "http://127.0.0.1:18888". Anything else is refused. */
    origins: readonly string[];
    version: string;
    assets: Assets;
    translator?: Translator;
    fetch: typeof fetch;
}

/** Same as netlify/edge-functions/cors-proxy.ts: Inoreader does not allow CORS. */
const PROXY_PREFIX = "/cors-proxy/";
const PROXY_ORIGINS = new Set(["https://www.inoreader.com", "https://jp.inoreader.com"]);
/** Request headers forwarded to Inoreader. Cookies and browser metadata stay local. */
const FORWARDED_HEADERS = ["accept", "authorization", "content-type", "appid", "appkey"];
/** Set by `fetch`, which has already decoded the body. */
const DROPPED_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

export function createLocalServerHandler(options: LocalServerOptions): (request: Request) => Promise<Response> {
    const origins = new Set(options.origins);
    const hosts = new Set(options.origins.map((origin) => new URL(origin).host));

    const features = [
        ...(options.translator ? ["translate"] : []),
        ...(options.translator?.translateSegments ? ["translate-segments"] : []),
        ...(options.translator?.translateStream ? ["translate-stream"] : [])
    ];
    const info = () => json({ name: "irodr-local", version: options.version, features });

    const translate = async (request: Request): Promise<Response> => {
        const { translator } = options;
        if (!translator) return json({ error: "Translation is not available on this server" }, 501);
        // A JSON body cannot be sent cross-site without a preflight, which this server never answers.
        if (!request.headers.get("content-type")?.startsWith("application/json")) {
            return json({ error: "Content-Type must be application/json" }, 415);
        }
        const body: unknown = await request.json().catch(() => undefined);
        const segments = isRecord(body) && body.segments !== undefined ? parseSegments(body.segments) : undefined;
        if (
            !isRecord(body) ||
            (!isStringArray(body.texts) && !segments) ||
            typeof body.sourceLanguage !== "string" ||
            typeof body.targetLanguage !== "string"
        ) {
            return json({ error: "Expected { texts or segments, sourceLanguage, targetLanguage }" }, 400);
        }
        const { sourceLanguage, targetLanguage } = body;
        try {
            if (body.stream === true) {
                if (segments) return json({ error: "Streaming requires texts, not segments" }, 400);
                const stream = translator.translateStream;
                if (!stream) return json({ error: "Streaming is not supported" }, 501);
                return translationResponse(request.signal, (streamOptions) =>
                    stream(body.texts as string[], sourceLanguage, targetLanguage, streamOptions)
                );
            }
            if (segments) {
                if (!translator.translateSegments) return json({ error: "Segments are not supported" }, 501);
                return json({ segments: await translator.translateSegments(segments, sourceLanguage, targetLanguage) });
            }
            return json({ texts: await translator.translate(body.texts as string[], sourceLanguage, targetLanguage) });
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Translation failed" }, 422);
        }
    };

    const proxy = async (request: Request, url: URL): Promise<Response> => {
        const target = new URL(url.pathname.slice(PROXY_PREFIX.length) + url.search);
        if (!PROXY_ORIGINS.has(target.origin)) return new Response("Bad Origin", { status: 400 });
        const headers = new Headers(
            FORWARDED_HEADERS.flatMap((name) => {
                const value = request.headers.get(name);
                return value === null ? [] : [[name, value] as [string, string]];
            })
        );
        const hasBody = request.method !== "GET" && request.method !== "HEAD";
        const response = await options.fetch(target, {
            method: request.method,
            headers,
            body: hasBody ? await request.arrayBuffer() : undefined,
            redirect: "manual"
        });
        const responseHeaders = new Headers(
            [...response.headers].filter(([name]) => !DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()))
        );
        responseHeaders.set("Cache-Control", "no-store");
        return new Response(response.body, { status: response.status, headers: responseHeaders });
    };

    const serveAsset = (url: URL): Response => {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const asset = options.assets.get(path);
        if (!asset) return new Response("Not Found", { status: 404 });
        return new Response(asset.body, {
            headers: {
                "Content-Type": asset.contentType,
                // Vite puts content-hashed files under /assets/.
                "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
            }
        });
    };

    return async (request) => {
        const url = new URL(request.url);
        // DNS rebinding: a page on another name resolving to 127.0.0.1 sends its own Host.
        if (!hosts.has(url.host)) return new Response("Forbidden", { status: 403 });
        // Other sites may send requests to localhost; only the page itself may use the API and proxy.
        const origin = request.headers.get("origin");
        if (origin !== null && !origins.has(origin)) return new Response("Forbidden", { status: 403 });
        try {
            if (url.pathname.startsWith(PROXY_PREFIX)) return await proxy(request, url);
            const route = `${request.method} ${url.pathname}`;
            if (route === "GET /api/local") return info();
            if (route === "POST /api/translate") return await translate(request);
            if (url.pathname.startsWith("/api/")) return json({ error: "Not Found" }, 404);
            if (request.method !== "GET" && request.method !== "HEAD") {
                return new Response("Method Not Allowed", { status: 405 });
            }
            return serveAsset(url);
        } catch (error) {
            return new Response(error instanceof Error ? error.message : "Internal Server Error", { status: 500 });
        }
    };
}
