// MIT © 2017 azu
import { UseCase } from "almin";

export class TurnOffContentsFilterUseCasePayload {
    readonly type = "TurnOffContentsFilterUseCase";
}

export class TurnOffContentsFilterUseCase extends UseCase {
    execute() {
        this.dispatch(new TurnOffContentsFilterUseCasePayload());
    }
}

export class TurnOnContentsFilterUseCasePayload {
    readonly type = "TurnOnContentsFilterUseCase";
}

export class TurnOnContentsFilterUseCase extends UseCase {
    execute() {
        this.dispatch(new TurnOnContentsFilterUseCasePayload());
    }
}
