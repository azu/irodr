// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export const createUpdateHeaderMessageUseCase = () => {
    return new UpdateHeaderMessageUseCase();
};

export class UpdateHeaderMessageUseCasePayload extends Payload {
    constructor(public message: string) {
        super({ type: "UpdateHeaderMessageUseCase" });
    }
}

export class UpdateHeaderMessageUseCase extends UseCase {
    execute(message: string) {
        this.dispatch(new UpdateHeaderMessageUseCasePayload(message));
    }
}
