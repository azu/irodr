import { Context, Dispatcher } from "almin";
import { appStoreGroup } from "../../../component/container/App/AppStoreGroup";
import { storageManger } from "../../../infra/repository/Storage";
import { sourceRepository, SourceRepository, sourceItemId } from "../../../infra/repository/SourceRepository";
import { repositoryContainer } from "../../../infra/repository/RepositoryContainer";
import { GITHUB_SOURCE_ID, githubSourceSession } from "../../../infra/sources/GitHubSourceService";
import { SubscriptionIdentifier } from "../../../domain/Subscriptions/Subscription";
import { ConnectGitHubSourceUseCase, SetGitHubReleaseFilterUseCase } from "../GitHubSourceUseCases";
import { createShowSubscriptionContentsUseCase } from "../../subscription/ShowSubscriptionContentsUseCase";
import { createMarkAsReadToServerUseCase } from "../../subscription/MarkAsReadToServerUseCase";
import { createPrefetchSubscriptContentsUseCase } from "../../subscription/PrefetchSubscriptContentsUseCase";
import { createFetchMoreSubscriptContentsUseCase } from "../../subscription/FetchMoreSubscriptContentsUseCase";
import { projectSourceSubscriptions, githubRepositorySubscriptionId } from "../../../infra/sources/SourceSubscription";
import { InoreaderAPI } from "../../../infra/api/InoreaderAPI";
import { createUpdateSubscriptionsUseCase } from "../../subscription/UpdateSubscriptionsUseCase";
import { SubscriptionListState } from "../../../component/container/App/Subscription/SubscriptionList/SubscriptionListStore";
import { SubscriptionListContainer } from "../../../component/container/App/Subscription/SubscriptionList/SubscriptionListContainer";
import { appLocator } from "../../../AppLocator";

jest.mock("lodash.debounce", () => () => () => undefined);

function response(json: unknown): Response {
    return { ok: true, status: 200, headers: new Headers(), json: async () => json } as Response;
}

describe("GitHub source Reader workflow", () => {
    it("groups all unread types, optionally filters display, and marks the whole repository read", async () => {
        await storageManger.useMemoryDriver();
        const originalFetch = global.fetch;
        let notifications = [
            {
                id: "42",
                unread: true,
                updated_at: "2026-01-01T00:00:00Z",
                subject: { type: "Release", title: "v1.0", url: "https://api.github.com/repos/owner/repo/releases/1" },
                repository: { full_name: "owner/repo" }
            },
            {
                id: "44",
                unread: true,
                updated_at: "2026-01-01T00:00:00Z",
                subject: { type: "Release", title: "v1.1", url: "https://api.github.com/repos/owner/repo/releases/2" },
                repository: { full_name: "owner/repo" }
            },
            {
                id: "45",
                unread: true,
                updated_at: "2026-01-01T00:00:00Z",
                subject: {
                    type: "Release",
                    title: "Other release",
                    url: "https://api.github.com/repos/other/repo/releases/3"
                },
                repository: { full_name: "other/repo" }
            },
            {
                id: "43",
                unread: true,
                updated_at: "2026-01-01T00:00:00Z",
                subject: { type: "Issue", title: "Issue", url: "" },
                repository: { full_name: "owner/repo" }
            }
        ];
        const patched: string[] = [];
        const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (init?.method === "PUT") {
                const repository = new URL(url).pathname.split("/").slice(2, 4).join("/");
                const cutoff = Date.parse(JSON.parse(init.body as string).last_read_at);
                patched.push(repository);
                notifications = notifications.filter(
                    (item) => item.repository.full_name !== repository || Date.parse(item.updated_at) > cutoff
                );
                return { ...response(undefined), status: 205 };
            }
            if (url.includes("/notifications")) return response(notifications);
            return response({
                html_url: "https://github.com/owner/repo/releases/tag/v1.0",
                body: "Release notes",
                published_at: "2026-01-01T00:00:00Z"
            });
        });
        global.fetch = fetchMock;
        const remoteRead = jest.spyOn(InoreaderAPI.prototype, "markAsRead");
        const remoteContents = jest.spyOn(InoreaderAPI.prototype, "streamContents");
        const context = new Context({ store: appStoreGroup, dispatcher: new Dispatcher() });
        appLocator.context = context;
        const subscriptionId = githubRepositorySubscriptionId("owner/repo");
        const otherSubscriptionId = githubRepositorySubscriptionId("other/repo");
        const itemId = sourceItemId(GITHUB_SOURCE_ID, "42");
        const { subscriptionRepository } = repositoryContainer.get();
        try {
            await context.useCase(new ConnectGitHubSourceUseCase("test-only-token")).execute();
            expect(sourceRepository.getItems(GITHUB_SOURCE_ID)).toHaveLength(4);
            expect(subscriptionRepository.getAllByCategories("GitHub Notifications")).toHaveLength(2);
            expect(subscriptionRepository.findById(subscriptionId)?.title).toBe("owner/repo");
            expect(subscriptionRepository.findById(subscriptionId)?.unread.count).toBe(3);
            expect(subscriptionRepository.findById(otherSubscriptionId)?.unread.count).toBe(1);
            // Old local flags cannot override GitHub's unread inbox.
            await sourceRepository.setRead([itemId], true);
            projectSourceSubscriptions(sourceRepository, subscriptionRepository);
            expect(subscriptionRepository.findById(subscriptionId)?.unread.count).toBe(3);
            await context.useCase(new SetGitHubReleaseFilterUseCase()).execute(true);
            expect(subscriptionRepository.findById(subscriptionId)?.unread.count).toBe(2);
            expect(sourceRepository.getItems(GITHUB_SOURCE_ID)).toHaveLength(4);

            await context.useCase(createShowSubscriptionContentsUseCase()).execute(subscriptionId);
            expect(appStoreGroup.state.subscriptionContents.contents?.getContentList()[0].title).toBe("v1.0");
            await context.useCase(createPrefetchSubscriptContentsUseCase()).execute(subscriptionId);
            await context.useCase(createFetchMoreSubscriptContentsUseCase()).execute(subscriptionId);
            expect(remoteContents).not.toHaveBeenCalled();

            const previousList = appStoreGroup.state.subscriptionList;
            const movedList = new SubscriptionListState({
                ...previousList,
                currentSubscriptionId: new SubscriptionIdentifier("another-feed"),
                // A skipped feed is omitted from navigation history.
                prevSubscriptionId: undefined,
                prefetchSubscriptionCount: 0
            });
            const listContainer = new SubscriptionListContainer({ subscriptionList: movedList });
            await listContainer.componentDidUpdate({ subscriptionList: previousList });
            expect(patched).toEqual([]);
            await context.useCase(createMarkAsReadToServerUseCase()).execute(subscriptionId);
            expect(patched).toEqual(["owner/repo"]);
            // The display-only filter does not protect older Issue notifications from bulk read.
            expect(notifications.some((item) => item.id === "43")).toBe(false);
            expect(remoteRead).not.toHaveBeenCalled();
            // Like a read RSS feed, the recently opened repository stays in place as read.
            expect(subscriptionRepository.findById(subscriptionId)?.unread.count).toBe(0);
            expect(appStoreGroup.state.subscriptionList.getItem(subscriptionId)?.hasBeenRead).toBe(true);
            expect(
                appStoreGroup.state.subscriptionList.getNextItem(subscriptionId)?.props.id.equals(otherSubscriptionId)
            ).toBe(true);
            expect(appStoreGroup.state.subscriptionContents.contentsCount).toBe(0);
            expect(subscriptionRepository.findById(otherSubscriptionId)?.unread.count).toBe(1);
            const reloaded = new SourceRepository();
            await reloaded.ready();
            expect(reloaded.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["45"]);
            expect(JSON.stringify(reloaded.getSources())).not.toContain("test-only-token");
            // Refresh while credentials are locked still leaves stored items available.
            githubSourceSession.lock();
            const calls = fetchMock.mock.calls.length;
            await context.useCase(createUpdateSubscriptionsUseCase()).execute();
            expect(fetchMock).toHaveBeenCalledTimes(calls);
            expect(subscriptionRepository.findById(otherSubscriptionId)?.unread.count).toBe(1);
        } finally {
            githubSourceSession.lock();
            global.fetch = originalFetch;
            remoteRead.mockRestore();
            remoteContents.mockRestore();
        }
    });
});
