import { Context, Dispatcher } from "almin";
import { appStoreGroup } from "../../../component/container/App/AppStoreGroup";
import { appLocator } from "../../../AppLocator";
import { storageManger } from "../../../infra/repository/Storage";
import { sourceRepository } from "../../../infra/repository/SourceRepository";
import { repositoryContainer } from "../../../infra/repository/RepositoryContainer";
import { GITHUB_SOURCE_ID, githubSourceSession } from "../../../infra/sources/GitHubSourceService";
import { githubRepositorySubscriptionId, projectSourceSubscriptions } from "../../../infra/sources/SourceSubscription";
import { ConnectGitHubSourceUseCase } from "../GitHubSourceUseCases";
import { createShowSubscriptionContentsUseCase } from "../../subscription/ShowSubscriptionContentsUseCase";
import { SubscriptionListContainer } from "../../../component/container/App/Subscription/SubscriptionList/SubscriptionListContainer";
import { SubscriptionListState } from "../../../component/container/App/Subscription/SubscriptionList/SubscriptionListStore";

jest.mock("lodash.debounce", () => () => () => undefined);

const response = (json: unknown, status = 200): Response =>
    ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => json } as Response);

it("auto-reads the departed GitHub feed, preserves skip/reselection, and excludes later arrivals", async () => {
    await storageManger.useMemoryDriver();
    const originalFetch = global.fetch;
    const patched: string[] = [];
    const notifications = [
        ["1", "owner/a"],
        ["2", "owner/a"],
        ["3", "owner/b"],
        ["4", "owner/c"],
        ["5", "owner/d"]
    ].map(([id, repository]) => ({
        id,
        unread: true,
        updated_at: "2026-01-01T00:00:00Z",
        subject: {
            type: "Release",
            title: `Release ${id}`,
            url: `https://api.github.com/repos/${repository}/releases/${id}`
        },
        repository: { full_name: repository }
    }));
    global.fetch = jest.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/user")) return response({ id: 123 });
        if (init?.method === "PUT") {
            const repository = new URL(url).pathname.split("/").slice(2, 4).join("/");
            patched.push(repository);
            expect(JSON.parse(init.body as string).last_read_at).toBe("2026-01-01T00:00:00.000Z");
            return response(undefined, repository === "owner/c" ? 403 : 205);
        }
        if (url.includes("/notifications?")) return response(notifications);
        return response({ body: "Release notes" });
    });
    const context = new Context({ store: appStoreGroup, dispatcher: new Dispatcher(), options: { strict: true } });
    appLocator.context = context;
    const { subscriptionRepository } = repositoryContainer.get();
    const count = (repository: string) =>
        subscriptionRepository.findById(githubRepositorySubscriptionId(repository))?.unread.count;
    const navigate = async (repository: string, skipCurrent = false, prefetch?: () => Promise<void>) => {
        const before = appStoreGroup.state.subscriptionList;
        await context
            .useCase(createShowSubscriptionContentsUseCase())
            .execute(githubRepositorySubscriptionId(repository), { skipCurrent });
        const after = new SubscriptionListState({
            ...appStoreGroup.state.subscriptionList,
            prefetchSubscriptionCount: 0
        });
        const container = new SubscriptionListContainer({ subscriptionList: after });
        const interception = prefetch
            ? jest.spyOn(container as any, "prefetchSubscriptions").mockImplementation(prefetch)
            : undefined;
        try {
            await container.componentDidUpdate({ subscriptionList: before });
        } finally {
            interception?.mockRestore();
        }
    };
    try {
        await context.useCase(new ConnectGitHubSourceUseCase("test-only-token")).execute();
        await navigate("owner/a");
        expect(patched).toEqual([]);

        // Equal identifiers can have different object references after a cache refresh.
        const before = appStoreGroup.state.subscriptionList;
        const sameFeed = new SubscriptionListState({
            ...before,
            currentSubscriptionId: githubRepositorySubscriptionId("owner/a"),
            prevSubscriptionId: githubRepositorySubscriptionId("owner/a"),
            prefetchSubscriptionCount: 0
        });
        await new SubscriptionListContainer({ subscriptionList: sameFeed }).componentDidUpdate({
            subscriptionList: before
        });
        expect(patched).toEqual([]);

        const rows = () =>
            appStoreGroup.state.subscriptionList.groupSubscriptions.map((subscription) => subscription.title);
        expect(rows()).toEqual(["owner/a", "owner/b", "owner/c", "owner/d"]);
        await navigate("owner/b");
        expect(patched).toEqual(["owner/a"]);
        // Like RSS, the read feed stays in place so the rows below do not shift.
        expect(count("owner/a")).toBe(0);
        expect(rows()).toEqual(["owner/a", "owner/b", "owner/c", "owner/d"]);
        expect(count("owner/b")).toBe(1);

        // Reselecting B must not add duplicate activity that breaks Shift+S.
        await navigate("owner/b");
        await navigate("owner/c", true);
        expect(patched).toEqual(["owner/a"]);
        expect(count("owner/b")).toBe(1);

        // A failed repository PUT must leave C unread without reverting selection.
        await navigate("owner/d");
        expect(patched).toEqual(["owner/a", "owner/c"]);
        expect(count("owner/c")).toBe(1);
        expect(
            appStoreGroup.state.subscriptionList.currentSubscriptionId?.equals(
                githubRepositorySubscriptionId("owner/d")
            )
        ).toBe(true);

        await navigate("owner/b");
        expect(patched).toEqual(["owner/a", "owner/c", "owner/d"]);
        await navigate("owner/c", false, async () => {
            const existing = sourceRepository.getItems(GITHUB_SOURCE_ID).find((item) => item.externalId === "3")!;
            await sourceRepository.saveItems(GITHUB_SOURCE_ID, [
                { ...existing, updatedAt: "2026-01-02T00:00:00.000Z" },
                {
                    sourceId: GITHUB_SOURCE_ID,
                    externalId: "6",
                    title: "Arrived after leaving",
                    updatedAt: "2026-01-02T00:00:00.000Z",
                    metadata: { type: "Release", repository: "owner/b", githubUnread: true }
                }
            ]);
            projectSourceSubscriptions(sourceRepository, subscriptionRepository);
            // Even failed prefetch must not prevent acknowledging the departed feed.
            throw new Error("Prefetch failed");
        });
        expect(patched).toEqual(["owner/a", "owner/c", "owner/d", "owner/b"]);
        expect(count("owner/b")).toBe(2);
        expect(sourceRepository.getItems(GITHUB_SOURCE_ID).some((item) => item.externalId === "6")).toBe(true);
    } finally {
        githubSourceSession.lock();
        global.fetch = originalFetch;
    }
});
