import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakeGitHub, type FakeGitHub, type GitHubNotificationSeed, type GitHubScenario } from "./github.ts";
import { handleGoogleTranslate } from "./google-translate.ts";
import { type FakeRequest, type FakeResponse, json, text } from "./http.ts";
import {
    createFakeInoreader,
    type FakeInoreader,
    type InoreaderItemSeed,
    type InoreaderScenario
} from "./inoreader.ts";

export interface Scenario {
    inoreader?: InoreaderScenario;
    github?: GitHubScenario;
}

export interface LoggedRequest {
    readonly method: string;
    readonly service: "inoreader" | "github" | "google-translate";
    readonly path: string;
    readonly query: Readonly<Record<string, string>>;
    readonly body: string;
}

export interface FakeApiServer {
    readonly origin: string;
    readonly inoreader: FakeInoreader;
    readonly github: FakeGitHub;
    /** Requests to the fake services since the last reset, oldest first. */
    log: () => readonly LoggedRequest[];
    reset: (scenario?: Scenario) => void;
    close: () => Promise<void>;
}

// Mirrors the headers GitHub exposes to browsers.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers":
        "Date, Link, Retry-After, X-Poll-Interval, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
};

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
}

/**
 * Starts fake Inoreader (`/inoreader`), GitHub API (`/github`) and Google Translate (`/google-translate`) services
 * on one port.
 * `/__control/*` lets tests seed data and inspect requests.
 */
export async function startFakeApi(options: { port?: number; host?: string } = {}): Promise<FakeApiServer> {
    const inoreader = createFakeInoreader();
    const github = createFakeGitHub();
    const recorded: { log: readonly LoggedRequest[] } = { log: [] };
    // Known once the server listens.
    const listening = { origin: "" };

    const reset = (scenario: Scenario = {}) => {
        inoreader.reset(scenario.inoreader);
        github.reset(scenario.github);
        recorded.log = [];
    };
    reset();

    const control = (request: FakeRequest, path: string): FakeResponse => {
        const body: Record<string, unknown> = request.body ? JSON.parse(request.body) : {};
        switch (`${request.method} ${path}`) {
            case "GET /health":
                return text("ok");
            case "POST /reset":
                reset(body);
                return json({ ok: true });
            case "GET /log":
                return json(recorded.log);
            case "POST /inoreader/items":
                inoreader.addItems(String(body.streamId), body.items as InoreaderItemSeed[]);
                return json({ ok: true });
            case "POST /inoreader/expire-tokens":
                inoreader.expireTokens();
                return json({ ok: true });
            case "POST /inoreader/config":
                // Only array values replace the failing streams; other keys and values are ignored.
                inoreader.configure({
                    ...(Array.isArray(body.failingStreams) ? { failingStreams: body.failingStreams as string[] } : {}),
                    ...(Array.isArray(body.failingMarkRead)
                        ? { failingMarkRead: body.failingMarkRead as string[] }
                        : {})
                });
                return json({ ok: true });
            case "GET /inoreader/unread":
                return json(Object.fromEntries(inoreader.streamIds().map((id) => [id, inoreader.unreadCount(id)])));
            case "POST /github/notifications":
                github.add(body.notifications as GitHubNotificationSeed[]);
                return json({ ok: true });
            case "POST /github/read":
                github.markRead(body.ids as string[]);
                return json({ ok: true });
            case "GET /github/unread":
                return json(github.unread());
            case "POST /github/config":
                github.configure(body);
                return json({ ok: true });
            default:
                return json({ error: `Unknown control ${request.method} ${path}` }, 404);
        }
    };

    const route = (request: FakeRequest): FakeResponse => {
        const path = request.url.pathname;
        if (path.startsWith("/__control/")) return control(request, path.slice("/__control".length));
        const service = (["inoreader", "github", "google-translate"] as const).find((name) =>
            path.startsWith(`/${name}/`)
        );
        if (!service) return json({ error: "not found" }, 404);
        const rest = path.slice(service.length + 1);
        recorded.log = [
            ...recorded.log,
            {
                method: request.method,
                service,
                path: rest,
                query: Object.fromEntries(request.url.searchParams),
                body: request.body
            }
        ];
        if (service === "google-translate") return handleGoogleTranslate(request, rest);
        return service === "inoreader"
            ? inoreader.handle(request, rest)
            : github.handle(request, rest, `${listening.origin}/github`);
    };

    const handle = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
        try {
            if (incoming.method === "OPTIONS") {
                outgoing.writeHead(204, {
                    ...CORS,
                    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers":
                        incoming.headers["access-control-request-headers"] ?? "Authorization, Content-Type",
                    "Access-Control-Max-Age": "600"
                });
                outgoing.end();
                return;
            }
            const request: FakeRequest = {
                method: incoming.method ?? "GET",
                url: new URL(incoming.url ?? "/", listening.origin),
                headers: incoming.headers as Record<string, string | undefined>,
                body: await readBody(incoming)
            };
            const response = route(request);
            outgoing.writeHead(response.status, { ...CORS, Date: new Date().toUTCString(), ...response.headers });
            outgoing.end(response.body);
        } catch (error) {
            outgoing.writeHead(500, CORS);
            outgoing.end(String(error));
        }
    };
    const server: Server = createServer((incoming, outgoing) => {
        void handle(incoming, outgoing);
    });

    await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    listening.origin = `http://${options.host ?? "127.0.0.1"}:${address.port}`;

    return {
        origin: listening.origin,
        inoreader,
        github,
        log: () => recorded.log,
        reset,
        close: () =>
            new Promise((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            })
    };
}
