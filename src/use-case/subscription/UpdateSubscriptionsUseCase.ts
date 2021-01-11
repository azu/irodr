// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { SubscriptionsResponse } from "../../infra/api/SubscriptionResponse";
import { UnreadCountsResponse } from "../../infra/api/UnreadCountResponse";
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

    execute() {
        const app = this.repo.appRepository.get();
        if (app.user.isMachine) {
            return;
        }
        const client = new InoreaderAPI(app.user.authority);
        const subscriptionsResponsePromise = client.subscriptions().catch(error => {
            debug("client.subscriptions() error", error);
            return Promise.reject(error);
        });
        const unreadCountsResponsePromise = client.unreadCounts().catch(error => {
            debug("client.unreadCounts() error", error);
            return Promise.reject(error);
        });
        return Promise.all([subscriptionsResponsePromise, unreadCountsResponsePromise]).then(
            ([newSubscriptionsResponse, newUnreadCountsResponse]: [SubscriptionsResponse, UnreadCountsResponse]) => {
                const subscriptions = createSubscriptionsFromResponses(
                    newSubscriptionsResponse,
                    newUnreadCountsResponse
                );
                subscriptions.forEach(subscription => {
                    const preSubscription = this.repo.subscriptionRepository.findById(subscription.props.id);
                    const saveSubscription = preSubscription
                        ? preSubscription.refreshSubscription(subscription)
                        : subscription;
                    this.repo.subscriptionRepository.save(saveSubscription);
                });
            }
        );
    }
}
