// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export class ToggleAllListGroupUseCasePayload extends Payload {
    readonly type = "ToggleAllListGroupUseCase";
}

export class ToggleAllListGroupUseCase extends UseCase {
    execute() {
        this.dispatch(new ToggleAllListGroupUseCasePayload());
    }
}
