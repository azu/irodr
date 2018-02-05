// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export const createToggleListGroupUseCase = () => {
    return new ToggleListGroupUseCase();
};

export class ToggleListGroupUseCasePayload implements Payload {
    type = "ToggleListGroupUseCasePayload";

    constructor(public categoryKey: string) {}
}

export class ToggleListGroupUseCase extends UseCase {
    execute(categoryKey: string) {
        this.dispatch(new ToggleListGroupUseCasePayload(categoryKey));
    }
}
