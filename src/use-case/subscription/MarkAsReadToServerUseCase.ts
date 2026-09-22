// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { repositoryContainer, RepositoryContainerRepos } from "../../infra/repository/RepositoryContainer";
import { githubSourceSession } from "../../infra/sources/GitHubSourceService";
import { PublishSourceSubscriptionsUseCase } from "../source/PublishSourceSubscriptionsUseCase";
import { createUpdateHeaderMessageUseCase } from "../app/UpdateHeaderMessageUseCase";

export const createMarkAsReadToServerUseCase = () => {
    return new MarkAsReadToServerUseCase(repositoryContainer.get());
};

/**
 *  Mark as read in client and server
 */
export class MarkAsReadToServerUseCase extends UseCase {
    constructor(private repo: RepositoryContainerRepos) {
        super();
    }

    async execute(subscriptionId: SubscriptionIdentifier, loadedItemIds?: string[], readThrough?: string) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            // A departed repository may already have disappeared after a remote refresh.
            if (loadedItemIds !== undefined) return;
            throw new Error(`Not found subscription:${subscriptionId}`);
        }
        if (subscription.props.sourceId) {
            const loaded = loadedItemIds === undefined ? undefined : new Set(loadedItemIds);
            const itemIds = subscription.contents
                .getContentList()
                .map((item) => item.canonicalItemId)
                .filter((id): id is string => id !== undefined)
                .filter((id) => loaded === undefined || loaded.has(id));
            try {
                await githubSourceSession.markRead(
                    itemIds,
                    () =>
                        this.context
                            .useCase(new PublishSourceSubscriptionsUseCase(this.repo.subscriptionRepository))
                            .execute(),
                    readThrough
                );
            } catch {
                await this.context
                    .useCase(createUpdateHeaderMessageUseCase())
                    .execute("Could not mark all notifications read on GitHub. Failed notifications remain unread.");
            }
            return;
        }
        const readSubscription = subscription.readAll();
        this.repo.subscriptionRepository.save(readSubscription);
        // send to server
        const app = this.repo.appRepository.get();
        const client = new InoreaderAPI(app.user.authority);
        await client.markAsRead(subscription).catch((error) => {
            console.error(error);
            // revert
            this.repo.subscriptionRepository.save(subscription);
        });
        // save history
        await this.repo.readContentHistoryRepository.saveContents(readSubscription.contents.getContentList());
        await this.repo.readContentHistoryRepository.deleteUnusedSavedContents();
    }
}
