// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionsFromResponses } from "../../domain/Subscriptions/SubscriptionFactory";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";

const debug = require("debug")("irodr:UpdateSubscriptionsUseCase");
export const createUpdateSubscriptionsUseCase = () => {
    return new UpdateSubscriptionsUseCase(repositoryContainer.get());
};

export class UpdateSubscriptionsUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    async execute() {
        const app = this.repo.appRepository.get();
        if (app.user.isMachine) {
            return;
        }
        const client = new InoreaderAPI(app.user.authority);
        const newSubscriptionsResponse = await client.subscriptions().catch(error => {
            debug("client.subscriptions() error", error);
            return Promise.reject(error);
        });
        const newUnreadCountsResponse = await client.unreadCounts().catch(error => {
            debug("client.unreadCounts() error", error);
            return Promise.reject(error);
        });
        const subscriptions = createSubscriptionsFromResponses(newSubscriptionsResponse, newUnreadCountsResponse);
        subscriptions.forEach(subscription => {
            const preSubscription = this.repo.subscriptionRepository.findById(subscription.id);
            const saveSubscription = preSubscription ? preSubscription.refreshSubscription(subscription) : subscription;
            this.repo.subscriptionRepository.save(saveSubscription);
        });
    }
}
