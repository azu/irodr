import { UseCase } from "almin";
import { sourceRepository } from "../../infra/repository/SourceRepository";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { projectSourceSubscriptions } from "../../infra/sources/SourceSubscription";

/** Publish intermediate checkpoints while a parent sync use case is still running. */
export class PublishSourceSubscriptionsUseCase extends UseCase {
    constructor(private subscriptions = repositoryContainer.get().subscriptionRepository) {
        super();
    }

    execute() {
        projectSourceSubscriptions(sourceRepository, this.subscriptions);
    }
}
