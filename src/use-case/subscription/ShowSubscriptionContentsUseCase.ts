// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactoryh";
import { isSatisfiedSubscriptionContentsFetchSpec } from "./spec/SubscriptionContentsFetchSpec";
import { AppRepository } from "../../infra/repository/AppRepository";
import { createUpdateHeaderMessageUseCase } from "../app/UpdateHeaderMessageUseCase";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";

export class StartLoadingPayload implements Payload {
    type = "StartLoadingPayload";
}
export class FinishLoadingPayload implements Payload {
    type = "FinishLoadingPayload";
}

export const createShowSubscriptionContentsUseCase = () => {
    return new ShowSubscriptionContentsUseCase(repositoryContainer.get());
};

export class ShowSubscriptionContentsUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    async execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription: ${subscriptionId}`);
        }
        if (subscription.isContentsUpdating) {
            console.info(`This subscription is updating. No more update at once. ${subscription.id}`);
            return;
        }
        this.dispatch(new StartLoadingPayload());
        await this.context
            .useCase(createUpdateHeaderMessageUseCase())
            .executor(useCase => useCase.execute("Start loading contents..."));
        const specResult = isSatisfiedSubscriptionContentsFetchSpec(subscription);
        const app = this.repo.appRepository.get();
        if (!specResult.ok) {
            console.info(specResult.reason);
            app.user.openNewSubscription(subscription);
            this.dispatch(new FinishLoadingPayload());
            return;
        }
        subscription.mutableBeginContentUpdating();
        const client = new InoreaderAPI(app.user.authority);
        return client
            .streamContents(subscription, app.preferences.fetchContentsCount)
            .then(response => {
                const subscriptionContents = createSubscriptionContentsFromResponse(response);
                const newSubscription = subscription.updateContents(subscriptionContents);
                newSubscription.mutableEndContentUpdating();
                this.repo.subscriptionRepository.save(newSubscription);
                app.user.openNewSubscription(newSubscription);
                this.repo.appRepository.save(app);
            })
            .then(() => {
                this.dispatch(new FinishLoadingPayload());
                return this.context
                    .useCase(createUpdateHeaderMessageUseCase())
                    .executor(useCase => useCase.execute("Finish loading contents"));
            });
    }
}
