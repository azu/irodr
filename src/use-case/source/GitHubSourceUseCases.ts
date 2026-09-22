import { UseCase } from "almin";
import { GITHUB_SOURCE_ID, githubSourceSession } from "../../infra/sources/GitHubSourceService";
import { sourceCredentialsRepository } from "../../infra/repository/SourceCredentialsRepository";
import { sourceRepository } from "../../infra/repository/SourceRepository";
import { projectSourceSubscriptions } from "../../infra/sources/SourceSubscription";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { PublishSourceSubscriptionsUseCase } from "./PublishSourceSubscriptionsUseCase";

const project = () => projectSourceSubscriptions(sourceRepository, repositoryContainer.get().subscriptionRepository);

export class ConnectGitHubSourceUseCase extends UseCase {
    #token: string;
    constructor(token: string) {
        super();
        this.#token = token;
    }

    async execute() {
        try {
            await githubSourceSession.connect(this.#token.trim());
            await this.context.useCase(new PublishSourceSubscriptionsUseCase()).execute();
            await sourceCredentialsRepository.save(GITHUB_SOURCE_ID, this.#token.trim());
            await githubSourceSession.sync(() =>
                this.context.useCase(new PublishSourceSubscriptionsUseCase()).execute()
            );
        } finally {
            this.#token = "";
            project();
        }
    }
}

export class LockGitHubSourceUseCase extends UseCase {
    execute() {
        githubSourceSession.lock();
    }
}

export class ForgetGitHubCredentialsUseCase extends UseCase {
    async execute() {
        githubSourceSession.lock();
        await sourceCredentialsRepository.remove(GITHUB_SOURCE_ID);
    }
}

export class SetGitHubReleaseFilterUseCase extends UseCase {
    async execute(releaseOnly: boolean) {
        await sourceRepository.updateSourceConfig(GITHUB_SOURCE_ID, { releaseOnly });
        project();
    }
}
