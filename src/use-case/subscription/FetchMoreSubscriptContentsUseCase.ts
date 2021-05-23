import { UseCase } from "almin";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactory";

export const createFetchMoreSubscriptContentsUseCase = () => {
    return new FetchMoreSubscriptContentsUseCase(repositoryContainer.get());
};

export class FetchMoreSubscriptContentsUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription: ${subscription}`);
        }
        const app = this.repo.appRepository.get();
        if (app.user.isMachine) {
            return;
        }
        const client = new InoreaderAPI(app.user.authority);
        return client.streamContents(subscription, app.preferences.fetchContentsCount, true).then((response) => {
            // get again, because async
            const oldSubscription = this.repo.subscriptionRepository.findById(subscriptionId);
            if (!oldSubscription) {
                return;
            }
            const subscriptionContents = createSubscriptionContentsFromResponse(response);
            const newSubscription = oldSubscription.appendContents(subscriptionContents);
            this.repo.subscriptionRepository.save(newSubscription);
        });
    }
}
