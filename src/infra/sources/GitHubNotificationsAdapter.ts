import type { SourceAdapter, SourceItem } from "../../domain/Sources/SourceAdapter";
import MarkdownIt from "markdown-it";

// Treat raw HTML as text; markdown-it also rejects unsafe link/image schemes.
// HTMLContent still sanitizes the resulting HTML at the display boundary.
const markdown = new MarkdownIt({ html: false, linkify: true });
const validateLink = markdown.validateLink;
// Relative destinations would resolve against irodr, not the GitHub repository.
// Require explicit HTTP(S) URLs for both links and images instead of guessing a base.
markdown.validateLink = (url) => /^https?:\/\//i.test(url) && validateLink(url);
const contentVersion = 1;

export interface GitHubNotificationsConfig {
    sourceId: string;
    token: string;
}

export interface GitHubNotificationsCursor {
    /** Legacy incremental fields are ignored; every sync fetches the current unread inbox. */
    since?: string;
    lastModified?: string;
    nextPollAt?: string;
    /** Legacy validator provenance, also ignored for unread reconciliation. */
    lastModifiedQuery?: string;
}

export interface GitHubSyncProgress {
    phase: "notifications" | "details";
    notifications: number;
    items: number;
    releases: number;
    pages: number;
    resolved: number;
}

export interface GitHubNotificationsAdapterOptions {
    fetch?: typeof fetch;
    now?: () => Date;
    signal?: AbortSignal;
    existingItems?: SourceItem[];
    onItems?: (items: SourceItem[]) => Promise<void>;
    onSnapshot?: (items: SourceItem[], cursor: GitHubNotificationsCursor) => Promise<void>;
    onProgress?: (progress: GitHubSyncProgress) => void;
}

const API = "https://api.github.com/notifications";

export class GitHubRequestError extends Error {
    readonly retryAfterMs: number;
    readonly status: number;

    constructor(resource: string, response: Response, now: Date) {
        super(`GitHub ${resource} request failed (${response.status}).`);
        this.status = response.status;
        const serverNow = Date.parse(response.headers.get("Date") || "") || now.getTime();
        const retryAfter = response.headers.get("Retry-After");
        const retryMs = retryAfter
            ? /^\d+$/.test(retryAfter)
                ? Number(retryAfter) * 1000
                : Date.parse(retryAfter) - serverNow
            : 0;
        const reset =
            response.headers.get("X-RateLimit-Remaining") === "0"
                ? Number(response.headers.get("X-RateLimit-Reset")) * 1000 - serverNow
                : 0;
        this.retryAfterMs = Math.max(
            5 * 60 * 1000,
            Number.isFinite(retryMs) ? retryMs : 0,
            Number.isFinite(reset) ? reset : 0
        );
    }
}

function iso(value: unknown): string | undefined {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        return undefined;
    }
    return new Date(value).toISOString();
}

function safeURL(value: unknown, host: string): URL | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === "https:" && url.host === host && !url.username && !url.password && !url.hash) {
            return url;
        }
    } catch (_) {
        // Never expose remote URLs or credentials in errors.
    }
    return undefined;
}

function escapeHTML(value: string): string {
    const escaped: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    };
    return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

export class GitHubNotificationsAdapter implements SourceAdapter<GitHubNotificationsConfig, GitHubNotificationsCursor> {
    private readonly request: typeof fetch;
    private readonly now: () => Date;

    constructor(private readonly options: GitHubNotificationsAdapterOptions = {}) {
        this.request = options.fetch || ((input, init) => fetch(input, init));
        this.now = options.now || (() => new Date());
    }

    private async get(url: string, token: string): Promise<Response> {
        try {
            return await this.request(url, {
                method: "GET",
                redirect: "error",
                signal: this.options.signal,
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${token}`,
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            });
        } catch (_) {
            throw new Error("GitHub request failed.");
        }
    }

    async sync({
        config,
        cursor = {}
    }: {
        config: GitHubNotificationsConfig;
        cursor?: GitHubNotificationsCursor;
    }): Promise<{ items: SourceItem[]; cursor: GitHubNotificationsCursor }> {
        const startedAt = this.now();
        if (cursor.nextPollAt && Date.parse(cursor.nextPollAt) > startedAt.getTime()) {
            return { items: [], cursor: { ...cursor } };
        }
        const first = new URL(API);
        first.searchParams.set("all", "false");
        first.searchParams.set("per_page", "100");
        const firstURL = first.toString();
        const visited = new Set<string>();
        const items = new Map<string, SourceItem>();
        const existing = new Map(
            (this.options.existingItems || [])
                .filter((item) => item.sourceId === config.sourceId)
                .map((item) => [item.externalId, item])
        );
        const pending = new Map<string, { notification: any; item: SourceItem }>();
        const progress: GitHubSyncProgress = {
            phase: "notifications",
            notifications: 0,
            items: 0,
            releases: 0,
            pages: 0,
            resolved: 0
        };
        const report = () => this.options.onProgress?.({ ...progress });
        let next: string | undefined = firstURL;
        let pollSeconds = 60;
        while (next) {
            if (visited.has(next)) throw new Error("Invalid GitHub pagination.");
            visited.add(next);
            const response = await this.get(next, config.token);
            const interval = Number(response.headers.get("X-Poll-Interval"));
            if (Number.isFinite(interval) && interval > 0) pollSeconds = Math.max(pollSeconds, interval);
            if (!response.ok) throw new GitHubRequestError("notifications", response, this.now());
            let notifications: any;
            try {
                notifications = await response.json();
            } catch (_) {
                throw new Error("Invalid GitHub notifications response.");
            }
            if (!Array.isArray(notifications)) throw new Error("Invalid GitHub notifications response.");
            progress.pages++;
            progress.notifications += notifications.length;
            const pageItems = new Map<string, SourceItem>();
            for (const notification of notifications) {
                if (notification?.unread === false) continue;
                if (typeof notification?.id !== "string" || typeof notification.subject?.title !== "string") {
                    throw new Error("Invalid GitHub notification.");
                }
                const base = this.baseItem(notification, config);
                const cached = existing.get(base.externalId);
                const reusable =
                    (cached?.metadata?.detailsResolved === true || cached?.metadata?.releaseResolved === true) &&
                    cached.metadata.contentVersion === contentVersion &&
                    cached.metadata.type === base.metadata?.type &&
                    base.updatedAt !== undefined &&
                    cached.updatedAt === base.updatedAt;
                // Keep previously loaded details visible until refreshed details arrive.
                const item: SourceItem = cached
                    ? {
                          ...cached,
                          ...base,
                          url: cached.url || base.url,
                          content: cached.content,
                          publishedAt: cached.publishedAt,
                          metadata: {
                              ...base.metadata,
                              contentVersion: cached.metadata?.contentVersion,
                              detailsResolved: reusable
                          }
                      }
                    : base;
                items.set(item.externalId, item);
                pageItems.set(item.externalId, item);
                if (reusable) pending.delete(item.externalId);
                else pending.set(item.externalId, { notification, item });
            }
            progress.items = items.size;
            progress.releases = Array.from(items.values()).filter((item) => item.metadata?.type === "Release").length;
            report();
            if (pageItems.size > 0) await this.options.onItems?.(Array.from(pageItems.values()));
            next = this.nextPage(response.headers.get("Link"), first);
        }
        const nextCursor = { nextPollAt: new Date(this.now().getTime() + pollSeconds * 1000).toISOString() };
        // Absence means read only after every notification page succeeded. Body
        // enrichment is optional and must not block cross-browser read reconciliation.
        await this.options.onSnapshot?.(Array.from(items.values()), nextCursor);
        // Fetch the inbox first: titles must not wait for every release body.
        // Resolve bodies in groups of four, checkpointing every 100 successes
        // (or on completion/failure) to avoid rewriting the archive per item.
        progress.phase = "details";
        progress.resolved = items.size - pending.size;
        report();
        const unresolved = Array.from(pending.values());
        let checkpoint: SourceItem[] = [];
        for (let offset = 0; offset < unresolved.length; offset += 4) {
            const results = await Promise.allSettled(
                unresolved
                    .slice(offset, offset + 4)
                    .map(({ notification, item }) => this.resolveItem(notification, config, item))
            );
            let failure: PromiseRejectedResult | undefined;
            for (const result of results) {
                if (result.status === "fulfilled") {
                    items.set(result.value.externalId, result.value);
                    checkpoint.push(result.value);
                    progress.resolved++;
                } else if (!failure) failure = result;
            }
            report();
            if (checkpoint.length >= 100 || failure || offset + 4 >= unresolved.length) {
                if (checkpoint.length > 0) await this.options.onItems?.(checkpoint);
                checkpoint = [];
            }
            if (failure) throw failure.reason;
        }
        return {
            items: Array.from(items.values()),
            cursor: nextCursor
        };
    }

    private nextPage(link: string | null, first: URL): string | undefined {
        if (!link) return undefined;
        for (const part of link.split(",")) {
            if (!/;\s*rel\s*=\s*"next"/i.test(part)) continue;
            const match = part.match(/^\s*<([^>]+)>/);
            const url = safeURL(match && match[1], "api.github.com");
            if (
                !url ||
                url.pathname !== "/notifications" ||
                url.searchParams.getAll("all").some((value) => value !== "false") ||
                url.searchParams.get("per_page") !== "100" ||
                url.searchParams.get("since") !== first.searchParams.get("since") ||
                url.searchParams.has("before") ||
                url.searchParams.has("participating")
            ) {
                throw new Error("Invalid GitHub pagination.");
            }
            return url.toString();
        }
        return undefined;
    }

    private baseItem(notification: any, config: GitHubNotificationsConfig): SourceItem {
        const repo = notification.repository?.full_name;
        const validRepo = typeof repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo);
        const type = typeof notification.subject.type === "string" ? notification.subject.type : "Notification";
        const fallback = validRepo ? `https://github.com/${repo}${type === "Release" ? "/releases" : ""}` : undefined;
        return {
            externalId: notification.id,
            sourceId: config.sourceId,
            title: notification.subject.title,
            url: fallback,
            updatedAt: iso(notification.updated_at),
            metadata: {
                type,
                repository: validRepo ? repo : undefined,
                ...(typeof notification.unread === "boolean" ? { githubUnread: notification.unread } : {})
            }
        };
    }

    private async resolveItem(
        notification: any,
        config: GitHubNotificationsConfig,
        base: SourceItem
    ): Promise<SourceItem> {
        const item: SourceItem = {
            ...base,
            metadata: { ...base.metadata, detailsResolved: true, contentVersion }
        };
        const repo = notification.repository?.full_name;
        const validRepo = typeof repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo);
        const subject = safeURL(notification.subject.url, "api.github.com");
        if (
            !subject ||
            subject.search ||
            !validRepo ||
            !subject.pathname.startsWith(`/repos/${repo}/`) ||
            !/^\/repos\/[\w.-]+\/[\w.-]+\/(?:(?:releases|issues|pulls|discussions)\/\d+|commits\/[a-fA-F0-9]{7,40})$/.test(
                subject.pathname
            )
        ) {
            return item;
        }
        const response = await this.get(subject.toString(), config.token);
        const rateLimited =
            response.status === 403 &&
            (response.headers.get("X-RateLimit-Remaining") === "0" || response.headers.get("Retry-After") !== null);
        if (!rateLimited && [403, 404, 410].includes(response.status)) {
            // A later PAT with repo access may resolve an ordinary permission denial.
            if (response.status === 403) item.metadata!.detailsResolved = false;
            return item;
        }
        if (!response.ok) throw new GitHubRequestError("notification details", response, this.now());
        let detail: any;
        try {
            detail = await response.json();
        } catch (_) {
            throw new Error("Invalid GitHub notification details response.");
        }
        if (!detail || typeof detail !== "object") throw new Error("Invalid GitHub notification details response.");
        const browserURL = safeURL(detail.html_url, "github.com");
        if (browserURL && browserURL.pathname.startsWith(`/${repo}/`)) item.url = browserURL.toString();
        if (typeof detail.body === "string") {
            item.content = markdown.render(detail.body);
        } else if (typeof detail.commit?.message === "string") {
            item.content = `<pre>${escapeHTML(detail.commit.message)}</pre>`;
        }
        item.publishedAt = iso(detail.published_at) || iso(detail.created_at) || iso(detail.commit?.author?.date);
        return item;
    }
}
