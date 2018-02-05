// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export class ShowAppPreferenceUseCasePayload implements Payload {
    type = "ShowAppPreferenceUseCasePayload";
}

export class DismissAppPreferenceUseCasePayload implements Payload {
    type = "DismissAppPreferenceUseCasePayload";
}

export class ShowAppPreferenceUseCase extends UseCase {
    execute() {
        this.dispatch(new ShowAppPreferenceUseCasePayload());
    }
}

export class DismissAppPreferenceUseCase extends UseCase {
    execute() {
        this.dispatch(new DismissAppPreferenceUseCasePayload());
    }
}
