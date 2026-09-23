import { Context, Dispatcher } from "almin";
import { appStoreGroup } from "../../../component/container/App/AppStoreGroup";
import { storageManger } from "../../../infra/repository/Storage";
import { sourceRepository, sourceItemId } from "../../../infra/repository/SourceRepository";
import { GITHUB_SOURCE_ID, githubSourceSession } from "../../../infra/sources/GitHubSourceService";
import { githubRepositorySubscriptionId } from "../../../infra/sources/SourceSubscription";
import { ConnectGitHubSourceUseCase } from "../GitHubSourceUseCases";
import { createShowSubscriptionContentsUseCase } from "../../subscription/ShowSubscriptionContentsUseCase";
import { createMarkAsReadToServerUseCase } from "../../subscription/MarkAsReadToServerUseCase";

const response = (json: unknown): Response =>
    ({ ok: true, status: 200, headers: new Headers(), json: async () => json } as Response);

it("updates the Reader before the connecting use case completes and keeps interactions during loading", async () => {
    await storageManger.useMemoryDriver();
    const originalFetch = global.fetch;
    let releaseStarted!: () => void;
    const waitingForRelease = new Promise<void>((resolve) => {
        releaseStarted = resolve;
    });
    let finishRelease!: () => void;
    const release = new Promise<void>((resolve) => {
        finishRelease = resolve;
    });
    global.fetch = jest.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/user")) return response({ id: 123 });
        if (init?.method === "PUT") return { ...response(undefined), status: 205 };
        if (url.includes("notifications"))
            return response([
                {
                    id: "42",
                    updated_at: "2026-01-01T00:00:00Z",
                    subject: {
                        type: "Release",
                        title: "Early article",
                        url: "https://api.github.com/repos/owner/repo/releases/1"
                    },
                    repository: { full_name: "owner/repo" }
                }
            ]);
        releaseStarted();
        await release;
        return response({ body: "Late release notes" });
    });
    const context = new Context({ store: appStoreGroup, dispatcher: new Dispatcher(), options: { strict: true } });
    const subscriptionId = githubRepositorySubscriptionId("owner/repo");
    const connecting = context.useCase(new ConnectGitHubSourceUseCase("test-only-token")).execute();
    try {
        await waitingForRelease;
        expect(appStoreGroup.state.subscriptionList.getItem(subscriptionId)?.unread.count).toBe(1);
        await context.useCase(createShowSubscriptionContentsUseCase()).execute(subscriptionId);
        expect(appStoreGroup.state.subscriptionContents.getFirstContent()?.title).toBe("Early article");
        expect(appStoreGroup.state.subscriptionContents.subscription?.lastUpdated.millSecond).toBeGreaterThan(0);
        await context
            .useCase(createMarkAsReadToServerUseCase())
            .execute(subscriptionId, [sourceItemId(GITHUB_SOURCE_ID, "42")]);
        finishRelease();
        await connecting;
        expect(sourceRepository.getItems(GITHUB_SOURCE_ID)).toEqual([]);
        expect(appStoreGroup.state.subscriptionContents.contentsCount).toBe(0);
        expect(appStoreGroup.state.subscriptionList.getItem(subscriptionId)?.unread.count).toBe(0);
        expect(appStoreGroup.state.subscriptionContents.subscription?.lastUpdated.millSecond).toBeGreaterThan(0);
    } finally {
        finishRelease();
        await connecting.catch(() => undefined);
        githubSourceSession.lock();
        global.fetch = originalFetch;
    }
});
