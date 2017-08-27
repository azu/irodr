// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export const createToggleListGroupUseCase = () => {
    return new ToggleListGroupUseCase();
};

export class ToggleListGroupUseCasePayload extends Payload {
    constructor(public categoryKey: string) {
        super({ type: "ToggleListGroupUseCasePayload" });
    }
}

export class ToggleListGroupUseCase extends UseCase {
    execute(categoryKey: string) {
        this.dispatch(new ToggleListGroupUseCasePayload(categoryKey));
    }
}
