import { escapeHtml } from "../../lib/html.ts";
import { renderMarkdown } from "./markdown.ts";

/** Bump to re-resolve cached bodies after changing how they are rendered. */
export const CONTENT_VERSION = 1;

export interface GitHubApiOptions {
    /** https://api.github.com */
    readonly apiBaseUrl: string;
    /** https://github.com */
    readonly webBaseUrl: string;
    readonly fetch: typeof fetch;
    readonly now: () => number;
}

/** The subset of https://docs.github.com/en/rest/activity/notifications irodr reads. */
export interface GitHubNotification {
    readonly id: string;
    readonly unread?: boolean;
    readonly updated_at?: string;
    readonly subject: { readonly title: string; readonly url?: string | null; readonly type?: string };
    readonly repository?: { readonly full_name?: string };
}

export interface NotificationPage {
    readonly notifications: readonly GitHubNotification[];
    /** From X-Poll-Interval. */
    readonly pollSeconds?: number;
    readonly next?: string;
}

export interface NotificationDetails {
    readonly url?: string;
    readonly content?: string;
    readonly publishedAt?: string;
    /** False when a later token with more access may resolve the details. */
    readonly resolved: boolean;
}

export class GitHubRequestError extends Error {
    override name = "GitHubRequestError";
    readonly retryAfterMs: number;
    readonly status: number;

    constructor(resource: string, status: number, headers: Headers, now: number) {
        super(`GitHub ${resource} request failed (${status}).`);
        this.status = status;
        const serverNow = Date.parse(headers.get("Date") ?? "") || now;
        const retryAfter = headers.get("Retry-After");
        const retryMs = retryAfter
            ? /^\d+$/.test(retryAfter)
                ? Number(retryAfter) * 1000
                : Date.parse(retryAfter) - serverNow
            : 0;
        const reset =
            headers.get("X-RateLimit-Remaining") === "0"
                ? Number(headers.get("X-RateLimit-Reset")) * 1000 - serverNow
                : 0;
        this.retryAfterMs = Math.max(
            5 * 60 * 1000,
            Number.isFinite(retryMs) ? retryMs : 0,
            Number.isFinite(reset) ? reset : 0
        );
    }
}

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

/** `owner/repo`, or undefined for malformed or path-traversing names. */
export function validRepository(name: unknown): string | undefined {
    if (typeof name !== "string" || !REPOSITORY.test(name)) return undefined;
    if (name.split("/").some((part) => part === "." || part === "..")) return undefined;
    return name;
}

export function isoDate(value: unknown): string | undefined {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
    return new Date(value).toISOString();
}

/** The GitHub REST endpoints irodr uses. Requests carry the token; errors and results never do. */
export interface GitHubApi {
    readonly getUser: (token: string, signal?: AbortSignal) => Promise<{ id: number; login?: string }>;
    readonly firstNotificationsUrl: () => string;
    /** One page of the unread inbox: https://docs.github.com/en/rest/activity/notifications */
    readonly notificationPage: (url: string, token: string, signal?: AbortSignal) => Promise<NotificationPage>;
    /** Resolve the browser URL and body of a Release, Issue, PullRequest, Discussion or Commit. */
    readonly details: (
        notification: GitHubNotification,
        token: string,
        signal?: AbortSignal
    ) => Promise<NotificationDetails>;
    /**
     * https://docs.github.com/en/rest/activity/notifications#mark-a-thread-as-read
     * Resolves when GitHub marked the thread read (205) or it already was (304).
     */
    readonly markThreadRead: (threadId: string, token: string, signal?: AbortSignal) => Promise<void>;
}

export function createGitHubApi(options: GitHubApiOptions): GitHubApi {
    const api = new URL(options.apiBaseUrl.replace(/\/$/, ""));
    const web = new URL(options.webBaseUrl.replace(/\/$/, ""));
    const apiRoot = api.href.replace(/\/$/, "");
    const apiPath = api.pathname.replace(/\/$/, "");

    const send = async (
        url: string,
        token: string,
        signal: AbortSignal | undefined,
        init: { method?: string; body?: string } = {}
    ): Promise<Response> => {
        try {
            return await options.fetch(url, {
                method: init.method ?? "GET",
                redirect: "error",
                signal,
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${token}`,
                    "X-GitHub-Api-Version": "2022-11-28",
                    ...(init.body ? { "Content-Type": "application/json" } : {})
                },
                body: init.body
            });
        } catch {
            // Never expose request URLs or credentials in errors.
            throw new Error("GitHub request failed. Check your connection.");
        }
    };

    return {
        getUser: async (token, signal) => {
            const response = await send(`${apiRoot}/user`, token, signal);
            if (!response.ok) {
                throw new Error(`GitHub authentication failed (HTTP ${response.status}). Check your classic PAT.`);
            }
            const user = (await response.json()) as { id?: unknown; login?: unknown };
            if (typeof user.id !== "number") throw new Error("GitHub returned an invalid account.");
            return { id: user.id, login: typeof user.login === "string" ? user.login : undefined };
        },

        firstNotificationsUrl: () => {
            const url = new URL(`${apiRoot}/notifications`);
            url.searchParams.set("all", "false");
            url.searchParams.set("per_page", "100");
            return url.toString();
        },

        notificationPage: async (url, token, signal) => {
            const response = await send(url, token, signal);
            const interval = Number(response.headers.get("X-Poll-Interval"));
            if (!response.ok) {
                throw new GitHubRequestError("notifications", response.status, response.headers, options.now());
            }
            const notifications = await readJson(response, "Invalid GitHub notifications response.");
            if (!Array.isArray(notifications)) throw new Error("Invalid GitHub notifications response.");
            for (const notification of notifications as GitHubNotification[]) {
                if (typeof notification?.id !== "string" || typeof notification.subject?.title !== "string") {
                    throw new Error("Invalid GitHub notification.");
                }
            }
            return {
                notifications: notifications as GitHubNotification[],
                pollSeconds: Number.isFinite(interval) && interval > 0 ? interval : undefined,
                next: nextPage(response.headers.get("Link"), api.origin, apiPath)
            };
        },

        details: async (notification, token, signal) => {
            const repository = validRepository(notification.repository?.full_name);
            const subject = safeUrl(notification.subject.url, api.origin);
            const prefix = `${apiPath}/repos/${repository}/`;
            if (
                !repository ||
                !subject ||
                subject.search ||
                !subject.pathname.startsWith(prefix) ||
                !/^(?:(?:releases|issues|pulls|discussions)\/\d+|commits\/[a-fA-F0-9]{7,40})$/.test(
                    subject.pathname.slice(prefix.length)
                )
            ) {
                return { resolved: true };
            }
            const response = await send(subject.toString(), token, signal);
            const rateLimited =
                response.status === 403 &&
                (response.headers.get("X-RateLimit-Remaining") === "0" || response.headers.get("Retry-After") !== null);
            if (!rateLimited && [403, 404, 410].includes(response.status)) {
                // A later PAT with repo access may resolve an ordinary permission denial.
                return { resolved: response.status !== 403 };
            }
            if (!response.ok) {
                throw new GitHubRequestError("notification details", response.status, response.headers, options.now());
            }
            const detail = (await readJson(response, "Invalid GitHub notification details response.")) as {
                html_url?: unknown;
                body?: unknown;
                published_at?: unknown;
                created_at?: unknown;
                commit?: { message?: unknown; author?: { date?: unknown } };
            };
            if (!detail || typeof detail !== "object") throw new Error("Invalid GitHub notification details response.");
            const browserUrl = safeUrl(detail.html_url, web.origin);
            const content =
                typeof detail.body === "string"
                    ? renderMarkdown(detail.body)
                    : typeof detail.commit?.message === "string"
                      ? `<pre>${escapeHtml(detail.commit.message)}</pre>`
                      : undefined;
            return {
                url: browserUrl?.pathname.startsWith(`/${repository}/`) ? browserUrl.toString() : undefined,
                content,
                publishedAt:
                    isoDate(detail.published_at) ?? isoDate(detail.created_at) ?? isoDate(detail.commit?.author?.date),
                resolved: true
            };
        },

        markThreadRead: async (threadId, token, signal) => {
            const response = await send(
                `${apiRoot}/notifications/threads/${encodeURIComponent(threadId)}`,
                token,
                signal,
                {
                    method: "PATCH"
                }
            );
            if (response.status !== 205 && response.status !== 304) {
                throw new GitHubRequestError("mark-read", response.status, response.headers, options.now());
            }
        }
    };
}

/**
 * Follow only well-formed `rel="next"` links to the same unread query
 * on the API origin `origin` under the path `apiPath`.
 */
function nextPage(link: string | null, origin: string, apiPath: string): string | undefined {
    if (!link) return undefined;
    for (const part of link.split(",")) {
        if (!/;\s*rel\s*=\s*"next"/i.test(part)) continue;
        const url = safeUrl(part.match(/^\s*<([^>]+)>/)?.[1], origin);
        if (
            !url ||
            url.pathname !== `${apiPath}/notifications` ||
            url.searchParams.getAll("all").some((value) => value !== "false") ||
            url.searchParams.get("per_page") !== "100" ||
            url.searchParams.has("since") ||
            url.searchParams.has("before") ||
            url.searchParams.has("participating")
        ) {
            throw new Error("Invalid GitHub pagination.");
        }
        return url.toString();
    }
    return undefined;
}

/** Parse a JSON body, reporting malformed JSON as `message`. */
async function readJson(response: Response, message: string): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        throw new Error(message);
    }
}

/** An URL on `origin`, without credentials or fragments. */
function safeUrl(value: unknown, origin: string): URL | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const url = new URL(value);
        if (url.origin === origin && !url.username && !url.password && !url.hash) return url;
    } catch {
        // Invalid URL
    }
    return undefined;
}
