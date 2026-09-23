import { escapeHtml } from "../../lib/html.ts";
import { renderMarkdown } from "./markdown.ts";

/** Bump to re-resolve cached bodies after changing how they are rendered. */
export const CONTENT_VERSION = 1;

export interface GitHubApiOptions {
    /** https://api.github.com */
    apiBaseUrl: string;
    /** https://github.com */
    webBaseUrl: string;
    fetch: typeof fetch;
    now: () => number;
}

/** The subset of https://docs.github.com/en/rest/activity/notifications irodr reads. */
export interface GitHubNotification {
    id: string;
    unread?: boolean;
    updated_at?: string;
    subject: { title: string; url?: string | null; type?: string };
    repository?: { full_name?: string };
}

export interface NotificationPage {
    notifications: GitHubNotification[];
    /** From X-Poll-Interval. */
    pollSeconds?: number;
    next?: string;
}

export interface NotificationDetails {
    url?: string;
    content?: string;
    publishedAt?: string;
    /** False when a later token with more access may resolve the details. */
    resolved: boolean;
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

export class GitHubApi {
    readonly #api: URL;
    readonly #web: URL;
    private readonly options: GitHubApiOptions;

    constructor(options: GitHubApiOptions) {
        this.options = options;
        this.#api = new URL(options.apiBaseUrl.replace(/\/$/, ""));
        this.#web = new URL(options.webBaseUrl.replace(/\/$/, ""));
    }

    private get apiPath(): string {
        return this.#api.pathname.replace(/\/$/, "");
    }

    /** An URL on the configured API origin, without credentials or fragments. */
    private apiUrl(value: unknown): URL | undefined {
        return safeUrl(value, this.#api.origin);
    }

    private async send(
        url: string,
        token: string,
        signal: AbortSignal | undefined,
        init: { method?: string; body?: string } = {}
    ): Promise<Response> {
        try {
            return await this.options.fetch(url, {
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
    }

    async getUser(token: string, signal?: AbortSignal): Promise<{ id: number; login?: string }> {
        const response = await this.send(`${this.#api.href.replace(/\/$/, "")}/user`, token, signal);
        if (!response.ok) {
            throw new Error(`GitHub authentication failed (HTTP ${response.status}). Check your classic PAT.`);
        }
        const user = (await response.json()) as { id?: unknown; login?: unknown };
        if (typeof user.id !== "number") throw new Error("GitHub returned an invalid account.");
        return { id: user.id, login: typeof user.login === "string" ? user.login : undefined };
    }

    firstNotificationsUrl(): string {
        const url = new URL(`${this.#api.href.replace(/\/$/, "")}/notifications`);
        url.searchParams.set("all", "false");
        url.searchParams.set("per_page", "100");
        return url.toString();
    }

    /** One page of the unread inbox: https://docs.github.com/en/rest/activity/notifications */
    async notificationPage(url: string, token: string, signal?: AbortSignal): Promise<NotificationPage> {
        const response = await this.send(url, token, signal);
        const interval = Number(response.headers.get("X-Poll-Interval"));
        if (!response.ok) {
            throw new GitHubRequestError("notifications", response.status, response.headers, this.options.now());
        }
        let notifications: unknown;
        try {
            notifications = await response.json();
        } catch {
            throw new Error("Invalid GitHub notifications response.");
        }
        if (!Array.isArray(notifications)) throw new Error("Invalid GitHub notifications response.");
        for (const notification of notifications as GitHubNotification[]) {
            if (typeof notification?.id !== "string" || typeof notification.subject?.title !== "string") {
                throw new Error("Invalid GitHub notification.");
            }
        }
        return {
            notifications: notifications as GitHubNotification[],
            pollSeconds: Number.isFinite(interval) && interval > 0 ? interval : undefined,
            next: this.nextPage(response.headers.get("Link"))
        };
    }

    /** Follow only well-formed `rel="next"` links to the same unread query. */
    private nextPage(link: string | null): string | undefined {
        if (!link) return undefined;
        for (const part of link.split(",")) {
            if (!/;\s*rel\s*=\s*"next"/i.test(part)) continue;
            const url = this.apiUrl(part.match(/^\s*<([^>]+)>/)?.[1]);
            if (
                !url ||
                url.pathname !== `${this.apiPath}/notifications` ||
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

    /** Resolve the browser URL and body of a Release, Issue, PullRequest, Discussion or Commit. */
    async details(notification: GitHubNotification, token: string, signal?: AbortSignal): Promise<NotificationDetails> {
        const repository = validRepository(notification.repository?.full_name);
        const subject = this.apiUrl(notification.subject.url);
        const prefix = `${this.apiPath}/repos/${repository}/`;
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
        const response = await this.send(subject.toString(), token, signal);
        const rateLimited =
            response.status === 403 &&
            (response.headers.get("X-RateLimit-Remaining") === "0" || response.headers.get("Retry-After") !== null);
        if (!rateLimited && [403, 404, 410].includes(response.status)) {
            // A later PAT with repo access may resolve an ordinary permission denial.
            return { resolved: response.status !== 403 };
        }
        if (!response.ok) {
            throw new GitHubRequestError("notification details", response.status, response.headers, this.options.now());
        }
        let detail: {
            html_url?: unknown;
            body?: unknown;
            published_at?: unknown;
            created_at?: unknown;
            commit?: { message?: unknown; author?: { date?: unknown } };
        };
        try {
            detail = (await response.json()) as typeof detail;
        } catch {
            throw new Error("Invalid GitHub notification details response.");
        }
        if (!detail || typeof detail !== "object") throw new Error("Invalid GitHub notification details response.");
        const browserUrl = safeUrl(detail.html_url, this.#web.origin);
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
    }

    /**
     * https://docs.github.com/en/rest/activity/notifications#mark-repository-notifications-as-read
     * Resolves `true` when GitHub finished (205), `false` when it continues asynchronously (202).
     */
    async markRepositoryRead(
        repository: string,
        lastReadAt: string,
        token: string,
        signal?: AbortSignal
    ): Promise<boolean> {
        const response = await this.send(
            `${this.#api.href.replace(/\/$/, "")}/repos/${repository}/notifications`,
            token,
            signal,
            { method: "PUT", body: JSON.stringify({ last_read_at: lastReadAt }) }
        );
        if (response.status !== 205 && response.status !== 202) {
            throw new GitHubRequestError("mark-read", response.status, response.headers, this.options.now());
        }
        return response.status === 205;
    }
}

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
