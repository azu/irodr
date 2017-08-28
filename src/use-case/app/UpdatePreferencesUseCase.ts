// MIT © 2017 azu
import { UseCase } from "almin";
import { appRepository, AppRepository } from "../../infra/repository/AppRepository";
import { AppPreferences } from "../../domain/App/Preferences/AppPreferences";

export const createUpdatePreferencesUseCase = () => {
    return new UpdatePreferencesUseCase({
        appRepository
    });
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
