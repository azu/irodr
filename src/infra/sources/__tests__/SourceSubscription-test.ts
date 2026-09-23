import { storageManger } from "../../repository/Storage";
import { SourceRepository } from "../../repository/SourceRepository";
import { SubscriptionRepository } from "../../repository/SubscriptionRepository";
import { GITHUB_SOURCE_ID } from "../GitHubSourceService";
import { githubRepositorySubscriptionId, projectSourceSubscriptions } from "../SourceSubscription";
import { SubscriptionListState } from "../../../component/container/App/Subscription/SubscriptionList/SubscriptionListStore";
import { AppSubscriptionActivity } from "../../../domain/App/User/AppSubscriptionActivity";
import { AppSubscriptionActivityItem } from "../../../domain/App/User/AppSubscriptionActivityItem";

const item = (externalId: string, repository: string, type = "Release") => ({
    sourceId: GITHUB_SOURCE_ID,
    externalId,
    title: `${type} ${externalId}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadata: { type, repository, githubUnread: true }
});

const listed = (subscriptions: SubscriptionRepository, recent: string[]) =>
    new SubscriptionListState({
        prefetchSubscriptionCount: 0,
        categoryMap: {},
        groups: [],
        groupSubscriptions: [],
        groupIsCollapsed: {}
    })
        .updateCategoryMap(
            subscriptions.groupByCategory(),
            new AppSubscriptionActivity({
                items: recent.map(
                    (name) => new AppSubscriptionActivityItem({ id: githubRepositorySubscriptionId(name) })
                )
            })
        )
        .groupSubscriptions.map((subscription) => `${subscription.title} (${subscription.unread.count})`);

it("keeps a read GitHub repository in place like a read RSS feed", async () => {
    await storageManger.useMemoryDriver();
    const store = new SourceRepository();
    await store.ready();
    await store.saveSource({ id: GITHUB_SOURCE_ID, adapterType: "github-notifications", config: {} });
    await store.saveItems(GITHUB_SOURCE_ID, [item("1", "owner/a"), item("2", "owner/b"), item("3", "owner/c")]);
    const subscriptions = new SubscriptionRepository();
    projectSourceSubscriptions(store, subscriptions);
    expect(listed(subscriptions, [])).toEqual(["owner/a (1)", "owner/b (1)", "owner/c (1)"]);

    // Reading owner/a on GitHub removes its items from the local inbox.
    await store.removeItems(GITHUB_SOURCE_ID, ["1"]);
    projectSourceSubscriptions(store, subscriptions);
    expect(subscriptions.findById(githubRepositorySubscriptionId("owner/a"))?.contents.hasContent).toBe(false);
    expect(listed(subscriptions, ["owner/a", "owner/b"])).toEqual(["owner/a (0)", "owner/b (1)", "owner/c (1)"]);
    // Like RSS, it leaves the list once it is no longer in the recent navigation activity.
    expect(listed(subscriptions, [])).toEqual(["owner/b (1)", "owner/c (1)"]);

    // New notifications bring the repository back at the same position.
    await store.saveItems(GITHUB_SOURCE_ID, [item("4", "owner/a")]);
    projectSourceSubscriptions(store, subscriptions);
    expect(listed(subscriptions, [])).toEqual(["owner/a (1)", "owner/b (1)", "owner/c (1)"]);

    // A repository hidden by the Release-only filter still has unread notifications, so it is not shown as read.
    await store.saveItems(GITHUB_SOURCE_ID, [item("5", "owner/c", "Issue")]);
    await store.removeItems(GITHUB_SOURCE_ID, ["3"]);
    await store.updateSourceConfig(GITHUB_SOURCE_ID, { releaseOnly: true });
    projectSourceSubscriptions(store, subscriptions);
    expect(subscriptions.findById(githubRepositorySubscriptionId("owner/c"))).toBeUndefined();
    expect(listed(subscriptions, ["owner/c"])).toEqual(["owner/a (1)", "owner/b (1)"]);
});
