// MIT © 2017 azu
import { UseCase } from "almin";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";
import { InoreaderAuthorityIdentifier } from "../../domain/App/Authority/InoreaderAuthority";

export const createUpdateAuthorizeUseCase = () => {
    return new UpdateAuthorizeUseCase(repositoryContainer.get());
};

export class UpdateAuthorizeUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
        }
    ) {
        super();
    }

    execute({ clientId, clientSecret }: { clientId: string; clientSecret: string }) {
        const app = this.repo.appRepository.get();
        const newAuthority = app.user.authority.update({
            id: new InoreaderAuthorityIdentifier(clientId),
            clientId,
            clientSecret
        });
        app.user.updateAuthority(newAuthority);
        this.repo.appRepository.save(app);
    }
}
