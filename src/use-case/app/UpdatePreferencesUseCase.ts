// MIT © 2017 azu
import { UseCase } from "almin";
import { AppRepository } from "../../infra/repository/AppRepository";
import { AppPreferences } from "../../domain/App/Preferences/AppPreferences";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";

export const createUpdatePreferencesUseCase = () => {
    return new UpdatePreferencesUseCase(repositoryContainer.get());
};

export class UpdatePreferencesUseCase extends UseCase {
    constructor(private repo: { appRepository: AppRepository }) {
        super();
    }

    execute(preferences: Partial<AppPreferences>) {
        const app = this.repo.appRepository.get();
        const newApp = app.updatePreferences(preferences);
        this.repo.appRepository.save(newApp);
    }
}
