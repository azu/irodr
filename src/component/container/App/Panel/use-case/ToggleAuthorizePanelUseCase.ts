// MIT © 2017 azu
import { UseCase } from "almin";

export class ShowAuthorizePanelUseCasePayload {
    type = "ShowAuthorizePanelUseCase";
}

export class ShowAuthorizePanelUseCase extends UseCase {
    execute() {
        this.dispatch(new ShowAuthorizePanelUseCasePayload());
    }
}

export class DismissAuthorizePanelUseCasePayload {
    type = "DismissAuthorizePanelUseCase";
}

export class DismissAuthorizePanelUseCase extends UseCase {
    execute() {
        this.dispatch(new DismissAuthorizePanelUseCasePayload());
    }
}
