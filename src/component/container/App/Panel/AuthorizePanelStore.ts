// MIT © 2017 azu
import { DispatchedPayload, Store } from "almin";
import {
    DismissAuthorizePanelUseCasePayload,
    ShowAuthorizePanelUseCasePayload
} from "./use-case/ToggleAuthorizePanelUseCase";
import { AppRepository } from "../../../../infra/repository/AppRepository";
import { App } from "../../../../domain/App/App";
import { Authority } from "../../../../domain/App/Authority/Authority";

export interface AuthorizePanelStateProps {
    isShown: boolean;
    authority: Authority;
}

export class AuthorizePanelState {
    isShown: boolean;
    authority: Authority;

    constructor(args: AuthorizePanelStateProps) {
        this.isShown = args.isShown;
        this.authority = args.authority;
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

    update(app: App) {
        if (app.user.authority !== this.authority) {
            return new AuthorizePanelState({
                ...(this as AuthorizePanelStateProps),
                authority: app.user.authority
            });
        }
        return this;
    }
}

export class AuthorizePanelStore extends Store<AuthorizePanelState> {
    state: AuthorizePanelState;

    constructor(
        private repo: {
            appRepository: AppRepository;
        }
    ) {
        super();
        const app = this.repo.appRepository.get();
        this.state = new AuthorizePanelState({
            isShown: false,
            authority: app.user.authority
        });
    }

    receivePayload(payload: DispatchedPayload) {
        const app = this.repo.appRepository.get();
        this.setState(this.state.update(app).reduce(payload));
    }

    getState() {
        return this.state;
    }
}
