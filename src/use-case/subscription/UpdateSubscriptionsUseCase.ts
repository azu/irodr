// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { SubscriptionsResponse } from "../../infra/api/SubscriptionResponse";
import { UnreadCountsResponse } from "../../infra/api/UnreadCountResponse";
import { createSubscriptionsFromResponses } from "../../domain/Subscriptions/SubscriptionFactory";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";
import { OAuth } from "../../infra/api/OAuth";
import { githubSourceSession } from "../../infra/sources/GitHubSourceService";
import { sourceRepository } from "../../infra/repository/SourceRepository";
import { projectSourceSubscriptions } from "../../infra/sources/SourceSubscription";
import { createUpdateHeaderMessageUseCase } from "../app/UpdateHeaderMessageUseCase";
import { PublishSourceSubscriptionsUseCase } from "../source/PublishSourceSubscriptionsUseCase";

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
        // Sources fail independently: an expired Inoreader login must not block GitHub.
        const results = await Promise.allSettled([
            this.updateInoreader(),
            githubSourceSession
                .sync(() =>
                    this.context
                        .useCase(new PublishSourceSubscriptionsUseCase(this.repo.subscriptionRepository))
                        .execute()
                )
                .then(() => projectSourceSubscriptions(sourceRepository, this.repo.subscriptionRepository))
        ]);
        if (results.some((result) => result.status === "rejected")) {
            await this.context
                .useCase(createUpdateHeaderMessageUseCase())
                .execute(
                    githubSourceSession.status.phase === "error"
                        ? githubSourceSession.status.message
                        : "Some sources could not sync. Check Sources authorization or retry later."
                );
        } else if (sourceRepository.getSources().some((source) => source.adapterType === "github-notifications")) {
            const status = githubSourceSession.status;
            if (status.phase === "error" || status.phase === "locked") {
                await this.context.useCase(createUpdateHeaderMessageUseCase()).execute(status.message);
            } else if (status.phase === "idle") {
                await this.context.useCase(createUpdateHeaderMessageUseCase()).execute("Updated feeds");
            }
        }
    }

    private updateInoreader() {
        const app = this.repo.appRepository.get();
        if (!new OAuth(app.user.authority).loadToken()) {
            return Promise.resolve();
        }
        const client = new InoreaderAPI(app.user.authority);
        const subscriptionsResponsePromise = client.subscriptions().catch((error) => {
            debug("client.subscriptions() error", error);
            return Promise.reject(error);
        });
        const unreadCountsResponsePromise = client.unreadCounts().catch((error) => {
            debug("client.unreadCounts() error", error);
            return Promise.reject(error);
        });
        return Promise.all([subscriptionsResponsePromise, unreadCountsResponsePromise]).then(
            ([newSubscriptionsResponse, newUnreadCountsResponse]: [SubscriptionsResponse, UnreadCountsResponse]) => {
                const subscriptions = createSubscriptionsFromResponses(
                    newSubscriptionsResponse,
                    newUnreadCountsResponse
                );
                subscriptions.forEach((subscription) => {
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
