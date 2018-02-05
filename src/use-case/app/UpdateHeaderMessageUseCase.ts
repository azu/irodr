// MIT © 2017 azu
import { Payload, UseCase } from "almin";

export const createUpdateHeaderMessageUseCase = () => {
    return new UpdateHeaderMessageUseCase();
};

export class UpdateHeaderMessageUseCasePayload implements Payload {
    type = "UpdateHeaderMessageUseCase";

    constructor(public message: string | React.ReactChild) {}
}

export class UpdateHeaderMessageUseCase extends UseCase {
    execute(message: string | React.ReactChild) {
        this.dispatch(new UpdateHeaderMessageUseCasePayload(message));
    }
}
