// MIT © 2017 azu
import { DispatchedPayload, Store } from "almin";
import {
    DismissAuthorizePanelUseCasePayload,
    ShowAuthorizePanelUseCasePayload
} from "./use-case/ToggleAuthorizePanelUseCase";

export interface AuthorizePanelStateProps {
    isShown: boolean;
}

export class AuthorizePanelState {
    isShown: boolean;

    constructor(args: AuthorizePanelStateProps) {
        this.isShown = args.isShown;
    }

    reduce(payload: ShowAuthorizePanelUseCasePayload | DismissAuthorizePanelUseCasePayload) {
        if (payload instanceof ShowAuthorizePanelUseCasePayload) {
            return new AuthorizePanelState({
                ...(this as AuthorizePanelStateProps),
                isShown: true
            });
        } else if (payload instanceof DismissAuthorizePanelUseCasePayload) {
            return new AuthorizePanelState({
                ...(this as AuthorizePanelStateProps),
                isShown: false
            });
        } else {
            return this;
        }
    }
}

export class AuthorizePanelStore extends Store<AuthorizePanelState> {
    state: AuthorizePanelState;

    constructor() {
        super();
        this.state = new AuthorizePanelState({
            isShown: false
        });
    }

    receivePayload(payload: DispatchedPayload) {
        this.setState(this.state.reduce(payload));
    }

    getState() {
        return this.state;
    }
}
