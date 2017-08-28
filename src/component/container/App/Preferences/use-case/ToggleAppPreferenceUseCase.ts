// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export class ShowAppPreferenceUseCasePayload extends Payload {
    constructor() {
        super({ type: "ShowAppPreferenceUseCasePayload" });
    }
}

export class DismissAppPreferenceUseCasePayload extends Payload {
    constructor() {
        super({ type: "DismissAppPreferenceUseCasePayload" });
    }
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
