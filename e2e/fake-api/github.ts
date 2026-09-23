import { bearer, type FakeRequest, type FakeResponse, json } from "./http.ts";

/**
 * A fake GitHub REST API implementing what irodr uses:
 * https://docs.github.com/en/rest/activity/notifications and the subject endpoints.
 */

export type SubjectType = "Release" | "Issue" | "PullRequest" | "Discussion" | "Commit" | "CheckSuite";

export interface GitHubNotificationSeed {
    readonly id: string;
    readonly repository: string;
    readonly type: SubjectType;
    readonly title: string;
    readonly updated_at: string;
    readonly unread?: boolean;
    /** Markdown body (or commit message) returned by the subject endpoint. */
    readonly body?: string;
    /** Release/issue/PR number, or commit SHA. Defaults to the notification ID. */
    readonly number?: string;
    /** HTTP status of the subject endpoint, e.g. 404 for inaccessible subjects. */
    readonly detailStatus?: number;
}

/** Behavior tests can change at any time with `configure`. */
export interface GitHubConfig {
    /** token → account. Defaults to { "ghp_valid": { id: 1, login: "octocat" } }. */
    readonly accounts: Readonly<Record<string, { readonly id: number; readonly login: string }>>;
    /** Items per notifications page, regardless of per_page (to exercise pagination). */
    readonly pageSize?: number;
    readonly pollInterval: number;
    /** Notification ID or repository → status of PATCH /notifications/threads/{id}. Default 205. */
    readonly markReadStatus: Readonly<Record<string, number>>;
    /** Status of GET /notifications, e.g. 500 or 403. */
    readonly notificationsStatus?: number;
}

export interface GitHubScenario extends Partial<GitHubConfig> {
    readonly notifications?: readonly GitHubNotificationSeed[];
}

export interface FakeGitHub {
    /** Replace the notifications and configuration. */
    reset: (scenario?: GitHubScenario) => void;
    /** Change the configuration keys the patch names. */
    configure: (patch: Partial<GitHubConfig>) => void;
    /** Add notifications, replacing those with the same IDs. */
    add: (seeds: readonly GitHubNotificationSeed[]) => void;
    /** Mark read as if it happened in another browser. */
    markRead: (ids: readonly string[]) => void;
    unread: () => string[];
    handle: (request: FakeRequest, path: string, base: string) => FakeResponse;
}

type Thread = GitHubNotificationSeed & { readonly unread: boolean };

interface State {
    readonly config: GitHubConfig;
    readonly notifications: readonly Thread[];
}

const SUBJECT_PATHS: Partial<Record<SubjectType, string>> = {
    Release: "releases",
    Issue: "issues",
    PullRequest: "pulls",
    Discussion: "discussions",
    Commit: "commits"
};

const thread = (seed: GitHubNotificationSeed): Thread => ({ ...seed, unread: seed.unread ?? true });

function scenarioState(scenario: GitHubScenario): State {
    return {
        config: {
            accounts: scenario.accounts ?? { ghp_valid: { id: 1, login: "octocat" } },
            pageSize: scenario.pageSize,
            pollInterval: scenario.pollInterval ?? 60,
            markReadStatus: scenario.markReadStatus ?? {},
            notificationsStatus: scenario.notificationsStatus
        },
        notifications: (scenario.notifications ?? []).map(thread)
    };
}

function configured(state: State, patch: Partial<GitHubConfig>): State {
    return { ...state, config: { ...state.config, ...patch } };
}

/** Add notifications, replacing those with the same IDs. */
function withNotifications(state: State, seeds: readonly GitHubNotificationSeed[]): State {
    return {
        ...state,
        notifications: seeds.reduce(
            (notifications, seed) => [
                ...notifications.filter((notification) => notification.id !== seed.id),
                thread(seed)
            ],
            state.notifications
        )
    };
}

function withRead(state: State, isRead: (notification: Thread) => boolean): State {
    return {
        ...state,
        notifications: state.notifications.map((notification) =>
            isRead(notification) ? { ...notification, unread: false } : notification
        )
    };
}

function pageUrl(base: string, all: boolean, perPage: number, page: number): string {
    const url = new URL(`${base}/notifications`);
    url.searchParams.set("all", String(all));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    return url.toString();
}

function listNotifications(state: State, request: FakeRequest, base: string): FakeResponse {
    const { config } = state;
    if (config.notificationsStatus) {
        return json({ message: "Failure" }, config.notificationsStatus, {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60)
        });
    }
    const params = request.url.searchParams;
    const perPage = Math.min(Number(params.get("per_page") ?? 50) || 50, 100);
    const size = config.pageSize ?? perPage;
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const all = params.get("all") === "true";
    const matching = state.notifications
        .filter((notification) => all || notification.unread)
        .toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const slice = matching.slice((page - 1) * size, page * size);
    const headers = {
        "X-Poll-Interval": String(config.pollInterval),
        ...(page * size < matching.length ? { Link: `<${pageUrl(base, all, perPage, page + 1)}>; rel="next"` } : {})
    };
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

function subjectDetails(state: State, repository: string, kind: string, number: string): FakeResponse {
    const notification = state.notifications.find(
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

export function createFakeGitHub(): FakeGitHub {
    const current = { state: scenarioState({}) };

    const markThread = (id: string): FakeResponse => {
        const notification = current.state.notifications.find((candidate) => candidate.id === id);
        if (!notification) return json({ message: "Not Found" }, 404);
        const { markReadStatus } = current.state.config;
        const status = markReadStatus[notification.id] ?? markReadStatus[notification.repository] ?? 205;
        if (status !== 205) return json({ message: "Forbidden" }, status);
        if (!notification.unread) return { status: 304 };
        current.state = withRead(current.state, (candidate) => candidate.id === id);
        return { status };
    };

    const handle = (request: FakeRequest, path: string, base: string): FakeResponse => {
        const token = bearer(request);
        const account = token ? current.state.config.accounts[token] : undefined;
        if (!account) return json({ message: "Bad credentials" }, 401);
        if (path === "/user" && request.method === "GET") return json({ id: account.id, login: account.login });
        if (path === "/notifications" && request.method === "GET") {
            return listNotifications(current.state, request, base);
        }
        const threadRead = /^\/notifications\/threads\/(\w+)$/.exec(path);
        if (threadRead?.[1] && request.method === "PATCH") return markThread(threadRead[1]);
        const subject = /^\/repos\/([\w.-]+\/[\w.-]+)\/(releases|issues|pulls|discussions|commits)\/([\w]+)$/.exec(
            path
        );
        if (subject?.[1] && subject[2] && subject[3] && request.method === "GET") {
            return subjectDetails(current.state, subject[1], subject[2], subject[3]);
        }
        return json({ message: "Not Found" }, 404);
    };

    return {
        reset: (scenario = {}) => {
            current.state = scenarioState(scenario);
        },
        configure: (patch) => {
            current.state = configured(current.state, patch);
        },
        add: (seeds) => {
            current.state = withNotifications(current.state, seeds);
        },
        markRead: (ids) => {
            current.state = withRead(current.state, (notification) => ids.includes(notification.id));
        },
        unread: () =>
            current.state.notifications
                .filter((notification) => notification.unread)
                .map((notification) => notification.id),
        handle
    };
}
