import {
    GitHubNotificationsAdapter,
    GitHubNotificationsCursor,
    GitHubRequestError
} from "./GitHubNotificationsAdapter";
import { sourceRepository, sourceItemId } from "../repository/SourceRepository";
import { sourceCredentialsRepository } from "../repository/SourceCredentialsRepository";
import { githubRepository, isCoveredByRead } from "./GitHubNotification";

export const GITHUB_SOURCE_ID = "github-notifications";

export interface GitHubSourceStatus {
    phase: "locked" | "idle" | "syncing" | "waiting" | "error";
    message: string;
    notifications: number;
    releases: number;
    pages: number;
}

class GitHubSourceError extends Error {}

function failureMessage(error: unknown): string {
    if (error instanceof GitHubRequestError) {
        const hint =
            error.status === 401
                ? "Reconnect with a valid classic PAT."
                : error.status === 403
                ? "Check the notifications scope, organization access and GitHub rate limits."
                : "GitHub may be unavailable or rate limited.";
        return `GitHub request failed (HTTP ${error.status}). ${hint} Already loaded articles are kept.`;
    }
    if (error instanceof GitHubSourceError) return error.message;
    return "GitHub sync failed. Check your connection and browser storage. Already loaded articles are kept.";
}

export class GitHubSourceSession {
    #token?: string;
    #syncing?: { generation: number; promise: Promise<void>; controller: AbortController };
    #connecting?: AbortController;
    #restoreAttempted = false;
    #restoring?: Promise<void>;
    #generation = 0;
    #retryAfter = 0;
    #listeners = new Set<() => void>();
    #readsDuringSync = new Map<string, number>();
    #writeRequests = new Set<AbortController>();
    #status: GitHubSourceStatus = {
        phase: "locked",
        message: "GitHub is disconnected. Open Sources to connect your token. Stored articles remain readable.",
        notifications: 0,
        releases: 0,
        pages: 0
    };

    constructor(
        private readonly store = sourceRepository,
        private readonly credentials = sourceCredentialsRepository
    ) {}

    get status(): Readonly<GitHubSourceStatus> {
        return this.#status;
    }

    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    private updateStatus(status: Partial<GitHubSourceStatus>) {
        this.#status = { ...this.#status, ...status };
        this.#listeners.forEach((listener) => listener());
    }

    get isUnlocked() {
        return Boolean(this.#token);
    }

    restore(): Promise<void> {
        if (this.#restoring) return this.#restoring;
        if (this.#restoreAttempted || this.#token) return Promise.resolve();
        this.#restoreAttempted = true;
        const generation = this.#generation;
        const restoring = (async () => {
            try {
                const token = await this.credentials.load(GITHUB_SOURCE_ID);
                if (!token || generation !== this.#generation || this.#token) return;
                this.#token = token;
                this.updateStatus({ phase: "idle", message: "Saved GitHub token restored. Ready to sync." });
            } catch {
                if (generation !== this.#generation) return;
                this.updateStatus({
                    phase: "error",
                    message: "Could not load the saved GitHub token. Open Sources to reconnect."
                });
            }
        })().finally(() => {
            if (this.#restoring === restoring) this.#restoring = undefined;
        });
        this.#restoring = restoring;
        return restoring;
    }

    lock() {
        this.#generation++;
        this.#restoreAttempted = true;
        this.#token = undefined;
        this.#connecting?.abort();
        this.#syncing?.controller.abort();
        this.#writeRequests.forEach((controller) => controller.abort());
        this.updateStatus({
            phase: "locked",
            message: "GitHub is disconnected. Open Sources to connect your token. Stored articles remain readable."
        });
    }

    async connect(token: string) {
        // A new connection replaces any previous session, including in-flight work.
        this.lock();
        const generation = this.#generation;
        const controller = new AbortController();
        this.#connecting = controller;
        this.updateStatus({
            phase: "syncing",
            message: "Connecting to GitHub…",
            notifications: 0,
            releases: 0,
            pages: 0
        });
        try {
            await this.authenticate(token, generation, controller.signal);
            if (generation !== this.#generation) throw new GitHubSourceError("GitHub connection cancelled.");
            this.updateStatus({ phase: "idle", message: "GitHub connected. Ready to sync." });
        } catch (error) {
            if (generation === this.#generation) {
                this.updateStatus({ phase: "error", message: failureMessage(error) });
            }
            throw error;
        } finally {
            if (this.#connecting === controller) this.#connecting = undefined;
        }
    }

    private async authenticate(token: string, generation: number, signal: AbortSignal) {
        // Bind the local inbox to an account, not to a PAT. Rotating a PAT must not
        // reset the cursor; using another account must not mix inboxes and states.
        const response = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
            redirect: "error",
            signal
        }).catch(() => {
            throw new GitHubSourceError("Could not connect to GitHub. Check your connection.");
        });
        if (!response.ok) {
            throw new GitHubSourceError(
                `GitHub authentication failed (HTTP ${response.status}). Check your classic PAT.`
            );
        }
        const user = await response.json();
        if (typeof user.id !== "number") {
            throw new GitHubSourceError("GitHub returned an invalid account.");
        }
        await this.store.ready();
        if (generation !== this.#generation) throw new GitHubSourceError("GitHub connection cancelled.");
        const existing = this.store.getSources().find((source) => source.id === GITHUB_SOURCE_ID);
        if (existing && existing.config.accountId !== user.id) {
            throw new GitHubSourceError(
                "This browser inbox belongs to another GitHub account. Use a separate browser profile."
            );
        }
        if (!existing) {
            await this.store.saveSource({
                id: GITHUB_SOURCE_ID,
                adapterType: "github-notifications",
                config: {
                    title: "GitHub Notifications",
                    accountId: user.id,
                    url: "https://github.com/notifications",
                    iconUrl: "https://github.githubassets.com/favicons/favicon.svg",
                    category: "GitHub Notifications"
                }
            });
        }
        if (generation !== this.#generation) throw new GitHubSourceError("GitHub connection cancelled.");
        this.#token = token;
        this.#retryAfter = 0;
    }

    /** One PUT per repository; every notification type up to the cutoff is acknowledged. */
    async markRead(itemIds: string[], onItemsSaved?: () => Promise<unknown>, readThrough?: string): Promise<void> {
        await this.restore();
        if (!this.#token) {
            throw new GitHubSourceError("Connect GitHub before marking notifications read.");
        }
        await this.store.ready();
        const wanted = new Set(itemIds);
        const items = this.store
            .getItems(GITHUB_SOURCE_ID)
            .filter((item) => wanted.has(sourceItemId(item.sourceId, item.externalId)));
        const repositories = new Map<string, number>();
        const frozenCutoff = readThrough === undefined ? undefined : Date.parse(readThrough);
        for (const item of items) {
            const repository = githubRepository(item);
            const cutoff = frozenCutoff ?? Date.parse(item.updatedAt || "");
            if (!repository || !Number.isFinite(cutoff) || cutoff <= 0) {
                throw new GitHubSourceError(
                    "Cannot safely mark a repository read without its name and notification timestamp."
                );
            }
            repositories.set(repository, Math.max(repositories.get(repository) || 0, cutoff));
        }
        const token = this.#token;
        const generation = this.#generation;
        const controller = new AbortController();
        this.#writeRequests.add(controller);
        try {
            const groups = Array.from(repositories);
            for (let offset = 0; offset < groups.length; offset += 4) {
                const results = await Promise.allSettled(
                    groups.slice(offset, offset + 4).map(async ([repository, cutoff]) => {
                        const response = await fetch(`https://api.github.com/repos/${repository}/notifications`, {
                            method: "PUT",
                            redirect: "error",
                            signal: controller.signal,
                            headers: {
                                Authorization: `Bearer ${token}`,
                                Accept: "application/vnd.github+json",
                                "X-GitHub-Api-Version": "2022-11-28",
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({ last_read_at: new Date(cutoff).toISOString() })
                        }).catch(() => {
                            throw new GitHubSourceError("Could not mark the notification read on GitHub.");
                        });
                        if (response.status !== 205 && response.status !== 202) {
                            throw new GitHubRequestError("mark-read", response, new Date());
                        }
                        return { repository, cutoff, pending: response.status === 202 };
                    })
                );
                if (generation !== this.#generation) throw new GitHubSourceError("GitHub read operation cancelled.");
                const acknowledged = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
                const completed = new Map(
                    acknowledged
                        .filter((result) => !result.pending)
                        .map(({ repository, cutoff }) => [repository, cutoff])
                );
                completed.forEach((cutoff, repository) =>
                    this.#readsDuringSync.set(repository, Math.max(this.#readsDuringSync.get(repository) || 0, cutoff))
                );
                if (completed.size > 0) {
                    await this.store.removeMatchingItems(GITHUB_SOURCE_ID, (item) => isCoveredByRead(item, completed));
                    await onItemsSaved?.();
                }
                if (acknowledged.some((result) => result.pending)) {
                    this.updateStatus({
                        phase: "waiting",
                        message:
                            "GitHub is marking repository notifications read in the background. The next refresh will confirm completion."
                    });
                }
                const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
                if (failure) throw failure.reason;
            }
        } catch (error) {
            if (generation === this.#generation) {
                this.updateStatus({
                    phase: "error",
                    message: `${failureMessage(error)} Failed notifications remain unread.`
                });
            }
            throw error;
        } finally {
            this.#writeRequests.delete(controller);
        }
    }

    sync(onItemsSaved?: () => Promise<unknown>): Promise<void> {
        if (this.#syncing?.generation === this.#generation) return this.#syncing.promise;
        // Hot reload can replace the in-memory session without running app boot.
        // Refresh must still restore the saved credential exactly once.
        if (!this.#token && (this.#restoring || !this.#restoreAttempted)) {
            return this.restore().then(() => this.sync(onItemsSaved));
        }
        if (!this.#token) {
            if (this.#status.phase !== "error") this.lock();
            return Promise.resolve();
        }
        if (Date.now() < this.#retryAfter) {
            // Preserve the failure explanation instead of silently claiming success.
            return Promise.resolve();
        }
        const token = this.#token;
        const generation = this.#generation;
        const controller = new AbortController();
        const readsDuringSync = new Map<string, number>();
        this.#readsDuringSync = readsDuringSync;
        const promise = (async () => {
            try {
                await this.store.ready();
                if (generation !== this.#generation) return;
                const source = this.store.getSources().find((entry) => entry.id === GITHUB_SOURCE_ID);
                if (!source) return;
                const cursor = source.cursor as GitHubNotificationsCursor | undefined;
                if (cursor?.nextPollAt && Date.parse(cursor.nextPollAt) > Date.now()) {
                    this.updateStatus({
                        phase: "waiting",
                        message: `GitHub polling interval: next request after ${new Date(
                            cursor.nextPollAt
                        ).toLocaleTimeString()}.`
                    });
                    return;
                }
                this.updateStatus({
                    phase: "syncing",
                    message: "Loading GitHub notifications…",
                    notifications: 0,
                    releases: 0,
                    pages: 0
                });
                const adapter = new GitHubNotificationsAdapter({
                    signal: controller.signal,
                    existingItems: this.store.getItems(source.id),
                    onProgress: (progress) => {
                        if (generation !== this.#generation) return;
                        this.updateStatus({
                            phase: "syncing",
                            notifications: progress.notifications,
                            releases: progress.releases,
                            pages: progress.pages,
                            message:
                                progress.phase === "notifications"
                                    ? "Loading GitHub notification pages… Articles appear as they arrive."
                                    : `Loading notification details (${progress.resolved}/${progress.items})…`
                        });
                    },
                    onItems: async (items) => {
                        if (generation !== this.#generation) throw new GitHubSourceError("GitHub sync cancelled.");
                        const unread = items.filter((item) => !isCoveredByRead(item, readsDuringSync));
                        if (unread.length === 0) return;
                        await this.store.saveItems(source.id, unread);
                        if (generation !== this.#generation) return;
                        await onItemsSaved?.();
                    },
                    onSnapshot: async (items, nextCursor) => {
                        if (generation !== this.#generation) throw new GitHubSourceError("GitHub sync cancelled.");
                        await this.store.commitSnapshot(
                            source.id,
                            items.filter((item) => !isCoveredByRead(item, readsDuringSync)),
                            nextCursor
                        );
                        if (generation !== this.#generation) return;
                        await onItemsSaved?.();
                    }
                });
                const result = await adapter.sync({
                    config: { sourceId: source.id, token },
                    cursor
                });
                if (generation !== this.#generation) return;
                await onItemsSaved?.();
                this.updateStatus({
                    phase: "idle",
                    message:
                        result.items.length > 0
                            ? `GitHub sync complete: ${this.store.getItems(source.id).length} unread notifications.`
                            : "GitHub sync complete: no unread notifications."
                });
            } catch (error) {
                if (generation !== this.#generation) return;
                // Avoid a tight retry loop on network/authentication/rate-limit failures.
                this.#retryAfter =
                    Date.now() + (error instanceof GitHubRequestError ? error.retryAfterMs : 5 * 60 * 1000);
                this.updateStatus({
                    phase: "error",
                    message: `${failureMessage(error)} Retry after ${new Date(this.#retryAfter).toLocaleTimeString()}.`
                });
                throw error;
            }
        })().finally(() => {
            if (this.#syncing?.generation === generation) this.#syncing = undefined;
        });
        this.#syncing = { generation, promise, controller };
        return promise;
    }
}

// Secrets stay in memory, outside source records, reader state and Almin payloads.
export const githubSourceSession = new GitHubSourceSession();
