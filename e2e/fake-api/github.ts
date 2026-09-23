import { bearer, type FakeRequest, type FakeResponse, json } from "./http.ts";

/**
 * A fake GitHub REST API implementing what irodr uses:
 * https://docs.github.com/en/rest/activity/notifications and the subject endpoints.
 */

export type SubjectType = "Release" | "Issue" | "PullRequest" | "Discussion" | "Commit" | "CheckSuite";

export interface GitHubNotificationSeed {
    id: string;
    repository: string;
    type: SubjectType;
    title: string;
    updated_at: string;
    unread?: boolean;
    /** Markdown body (or commit message) returned by the subject endpoint. */
    body?: string;
    /** Release/issue/PR number, or commit SHA. Defaults to the notification ID. */
    number?: string;
    /** HTTP status of the subject endpoint, e.g. 404 for inaccessible subjects. */
    detailStatus?: number;
}

export interface GitHubScenario {
    /** token → account. Defaults to { "ghp_valid": { id: 1, login: "octocat" } }. */
    accounts?: Record<string, { id: number; login: string }>;
    notifications?: GitHubNotificationSeed[];
    /** Items per notifications page, regardless of per_page (to exercise pagination). */
    pageSize?: number;
    pollInterval?: number;
    /** Repository → status of PUT /repos/{repo}/notifications. Default 205. */
    markReadStatus?: Record<string, number>;
    /** Status of GET /notifications, e.g. 500 or 403. */
    notificationsStatus?: number;
}

const SUBJECT_PATHS: Partial<Record<SubjectType, string>> = {
    Release: "releases",
    Issue: "issues",
    PullRequest: "pulls",
    Discussion: "discussions",
    Commit: "commits"
};

export class FakeGitHub {
    accounts: Record<string, { id: number; login: string }> = {};
    notifications: (GitHubNotificationSeed & { unread: boolean })[] = [];
    pageSize?: number;
    pollInterval = 60;
    markReadStatus: Record<string, number> = {};
    notificationsStatus?: number;

    reset(scenario: GitHubScenario = {}): void {
        this.accounts = scenario.accounts ?? { ghp_valid: { id: 1, login: "octocat" } };
        this.notifications = (scenario.notifications ?? []).map((seed) => ({ ...seed, unread: seed.unread ?? true }));
        this.pageSize = scenario.pageSize;
        this.pollInterval = scenario.pollInterval ?? 60;
        this.markReadStatus = scenario.markReadStatus ?? {};
        this.notificationsStatus = scenario.notificationsStatus;
    }

    add(seeds: GitHubNotificationSeed[]): void {
        for (const seed of seeds) {
            this.notifications = this.notifications.filter((notification) => notification.id !== seed.id);
            this.notifications.push({ ...seed, unread: seed.unread ?? true });
        }
    }

    /** Mark read as if it happened in another browser. */
    markRead(ids: string[]): void {
        for (const notification of this.notifications) {
            if (ids.includes(notification.id)) notification.unread = false;
        }
    }

    unread(): string[] {
        return this.notifications.filter((notification) => notification.unread).map((notification) => notification.id);
    }

    handle(request: FakeRequest, path: string, base: string): FakeResponse {
        const token = bearer(request);
        const account = token ? this.accounts[token] : undefined;
        if (!account) return json({ message: "Bad credentials" }, 401);
        if (path === "/user" && request.method === "GET") return json({ id: account.id, login: account.login });
        if (path === "/notifications" && request.method === "GET") return this.list(request, base);
        const repoRead = /^\/repos\/([\w.-]+\/[\w.-]+)\/notifications$/.exec(path);
        if (repoRead?.[1] && request.method === "PUT") return this.markRepository(repoRead[1], request);
        const subject = /^\/repos\/([\w.-]+\/[\w.-]+)\/(releases|issues|pulls|discussions|commits)\/([\w]+)$/.exec(
            path
        );
        if (subject?.[1] && subject[2] && subject[3] && request.method === "GET") {
            return this.subject(subject[1], subject[2], subject[3]);
        }
        return json({ message: "Not Found" }, 404);
    }

    private list(request: FakeRequest, base: string): FakeResponse {
        if (this.notificationsStatus) {
            return json({ message: "Failure" }, this.notificationsStatus, {
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60)
            });
        }
        const params = request.url.searchParams;
        const perPage = Math.min(Number(params.get("per_page") ?? 50) || 50, 100);
        const size = this.pageSize ?? perPage;
        const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
        const all = params.get("all") === "true";
        const matching = this.notifications
            .filter((notification) => all || notification.unread)
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        const slice = matching.slice((page - 1) * size, page * size);
        const headers: Record<string, string> = { "X-Poll-Interval": String(this.pollInterval) };
        if (page * size < matching.length) {
            const next = new URL(`${base}/notifications`);
            next.searchParams.set("all", String(all));
            next.searchParams.set("per_page", String(perPage));
            next.searchParams.set("page", String(page + 1));
            headers.Link = `<${next.toString()}>; rel="next"`;
        }
        return json(
            slice.map((notification) => {
                const kind = SUBJECT_PATHS[notification.type];
                return {
                    id: notification.id,
                    unread: notification.unread,
                    reason: "subscribed",
                    updated_at: notification.updated_at,
                    last_read_at: null,
                    subject: {
                        title: notification.title,
                        url: kind
                            ? `${base}/repos/${notification.repository}/${kind}/${notification.number ?? notification.id}`
                            : null,
                        latest_comment_url: null,
                        type: notification.type
                    },
                    repository: {
                        full_name: notification.repository,
                        html_url: `https://github.com/${notification.repository}`
                    },
                    url: `${base}/notifications/threads/${notification.id}`
                };
            }),
            200,
            headers
        );
    }

    private markRepository(repository: string, request: FakeRequest): FakeResponse {
        const status = this.markReadStatus[repository] ?? 205;
        if (status !== 205 && status !== 202) return json({ message: "Forbidden" }, status);
        const body = request.body ? (JSON.parse(request.body) as { last_read_at?: string }) : {};
        const cutoff = body.last_read_at ? Date.parse(body.last_read_at) : Date.now();
        // A 202 means GitHub finishes asynchronously; this fake applies it immediately either way.
        for (const notification of this.notifications) {
            if (notification.repository === repository && Date.parse(notification.updated_at) <= cutoff) {
                notification.unread = false;
            }
        }
        return { status };
    }

    private subject(repository: string, kind: string, number: string): FakeResponse {
        const notification = this.notifications.find(
            (candidate) =>
                candidate.repository === repository &&
                SUBJECT_PATHS[candidate.type] === kind &&
                (candidate.number ?? candidate.id) === number
        );
        if (!notification) return json({ message: "Not Found" }, 404);
        if (notification.detailStatus && notification.detailStatus !== 200) {
            return json({ message: "Unavailable" }, notification.detailStatus);
        }
        const htmlPath =
            kind === "releases" ? `releases/tag/v${number}` : kind === "pulls" ? `pull/${number}` : `${kind}/${number}`;
        const html_url = `https://github.com/${repository}/${htmlPath}`;
        if (kind === "commits") {
            return json({
                html_url,
                commit: { message: notification.body ?? "", author: { date: notification.updated_at } }
            });
        }
        return json({
            html_url,
            body: notification.body ?? "",
            created_at: notification.updated_at,
            ...(kind === "releases" ? { published_at: notification.updated_at } : {})
        });
    }
}
