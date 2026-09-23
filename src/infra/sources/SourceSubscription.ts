import { Subscription, SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import {
    SubscriptionContent,
    SubscriptionContentIdentifier
} from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { SubscriptionContentBody } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentBody";
import { SubscriptionContents } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContents";
import { SubscriptionUnread } from "../../domain/Subscriptions/SubscriptionUnread";
import { TimeStamp } from "../../domain/Subscriptions/TimeStamp";
import { SourceRepository, sourceItemId } from "../repository/SourceRepository";
import { SubscriptionRepository } from "../repository/SubscriptionRepository";
import { SourceItem } from "../../domain/Sources/SourceAdapter";
import { githubRepository } from "./GitHubNotification";

const GITHUB_REPOSITORY_SUBSCRIPTION_PREFIX = "github-notifications/repository/";

export function githubRepositorySubscriptionId(repository: string): SubscriptionIdentifier {
    return new SubscriptionIdentifier(`${GITHUB_REPOSITORY_SUBSCRIPTION_PREFIX}${encodeURIComponent(repository)}`);
}

export function isGitHubRepositorySubscriptionId(id: SubscriptionIdentifier): boolean {
    return id.toValue().startsWith(GITHUB_REPOSITORY_SUBSCRIPTION_PREFIX);
}

// GitHub feeds are a projection of the server's unread inbox, not local ItemState.
export function projectSourceSubscriptions(store: SourceRepository, subscriptions: SubscriptionRepository) {
    for (const source of store.getSources()) {
        const github = source.adapterType === "github-notifications";
        const groups = new Map<string, SourceItem[]>();
        // Repositories hidden by the display filter still have unread notifications.
        const filtered = new Set<string>();
        const category = github
            ? "GitHub Notifications"
            : typeof source.config.category === "string"
            ? source.config.category
            : "Sources";
        subscriptions.ensureCategory(category);
        for (const item of store.getItems(source.id)) {
            const repository = githubRepository(item);
            if (github && source.config.releaseOnly === true && item.metadata?.type !== "Release") {
                if (repository && item.metadata?.githubUnread !== false) filtered.add(repository);
                continue;
            }
            if (github && (item.metadata?.githubUnread === false || !repository)) continue;
            const key = github ? (repository as string) : source.id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
        }
        if (!github && groups.size === 0) groups.set(source.id, []);
        const projected = new Set<string>();
        for (const [group, items] of groups) {
            const id = github ? githubRepositorySubscriptionId(group) : new SubscriptionIdentifier(source.id);
            projected.add(id.toValue());
            const contents = items
                .map((item) => {
                    const itemId = sourceItemId(item.sourceId, item.externalId);
                    const published = Date.parse(item.publishedAt || item.updatedAt || "") || 0;
                    const updated = Date.parse(item.updatedAt || item.publishedAt || "") || published;
                    return new SubscriptionContent({
                        id: new SubscriptionContentIdentifier(itemId),
                        canonicalItemId: itemId,
                        readerState: github ? undefined : store.getState(itemId),
                        title: item.title,
                        url: item.url || "",
                        author: typeof item.metadata?.repository === "string" ? item.metadata.repository : "",
                        body: new SubscriptionContentBody({ content: item.content || "" }),
                        publishedDate: new TimeStamp(published),
                        updatedDate: new TimeStamp(updated)
                    });
                })
                .sort((a, b) => b.updatedDate.millSecond - a.updatedDate.millSecond);
            const unreadCount = contents.filter((item) => !item.readerState?.read).length;
            const updatedAt = new TimeStamp(Date.parse(source.lastSyncedAt || "") || 0);
            subscriptions.save(
                new Subscription({
                    id,
                    sourceId: source.id,
                    title: github ? group : typeof source.config.title === "string" ? source.config.title : source.id,
                    url: github
                        ? `https://github.com/${group}`
                        : typeof source.config.url === "string"
                        ? source.config.url
                        : "",
                    htmlUrl: github
                        ? `https://github.com/${group}`
                        : typeof source.config.url === "string"
                        ? source.config.url
                        : "",
                    iconUrl: typeof source.config.iconUrl === "string" ? source.config.iconUrl : "",
                    categories: [category],
                    contents: new SubscriptionContents({ contents, lastUpdatedTimestamp: updatedAt }),
                    unread: new SubscriptionUnread({
                        count: unreadCount,
                        maxCount: Number.MAX_SAFE_INTEGER,
                        readTimestamp: new TimeStamp(0)
                    }),
                    lastUpdated: updatedAt,
                    isContentsUpdating: false
                })
            );
        }
        for (const subscription of subscriptions.getAll()) {
            if (subscription.props.sourceId !== source.id || projected.has(subscription.props.id.toValue())) {
                continue;
            }
            // Like a read RSS feed, keep a fully read repository in place as an empty
            // feed so the list does not shift while the reader moves through it. The
            // list shows it only while it is in the recent navigation activity.
            if (
                github &&
                isGitHubRepositorySubscriptionId(subscription.props.id) &&
                !filtered.has(subscription.title)
            ) {
                if (subscription.unread.count > 0 || subscription.contents.hasContent) {
                    subscriptions.save(
                        new Subscription({
                            ...subscription.props,
                            contents: new SubscriptionContents({
                                contents: [],
                                lastUpdatedTimestamp: subscription.contents.lastUpdatedTimestamp
                            }),
                            unread: new SubscriptionUnread({
                                count: 0,
                                maxCount: Number.MAX_SAFE_INTEGER,
                                readTimestamp: new TimeStamp(0)
                            })
                        })
                    );
                }
                continue;
            }
            // Drop the old aggregate feed and repositories hidden by the display filter.
            subscriptions.delete(subscription);
        }
        subscriptions.ensureCategory(category);
    }
}
