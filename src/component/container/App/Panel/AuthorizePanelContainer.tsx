// MIT © 2017 azu
import * as React from "react";
import { AuthorizeModal, AuthorizeModalState } from "../../../project/AuthorizeModal/AuthorizeModal";
import { AuthorizePanelState } from "./AuthorizePanelStore";
import { BaseContainer } from "../../BaseContainer";
import { createAuthInoreaderUseCase } from "../../../../use-case/inoreader/AuthInoreaderUseCase";
import { DismissAppPreferenceUseCase } from "../Preferences/use-case/ToggleAppPreferenceUseCase";
import { createUpdateAuthorizeUseCase } from "../../../../use-case/app/UpdateAuthorityUseCase";

export interface AuthorizePanelContainerProps {
    authorizePanel: AuthorizePanelState;
}

export class AuthorizePanelContainer extends BaseContainer<AuthorizePanelContainerProps, {}> {
    private onClickConnect = async (state: AuthorizeModalState) => {
        await this.useCase(createUpdateAuthorizeUseCase()).execute({
            ...state
        });
        await this.useCase(createAuthInoreaderUseCase()).execute();
    };

    private onDismiss = () => {
        this.useCase(new DismissAppPreferenceUseCase()).execute();
    };

    render() {
        return (
            <AuthorizeModal
                isOpen={this.props.authorizePanel.isShown}
                onClickConnect={this.onClickConnect}
                authority={this.props.authorizePanel.authority}
                onDismiss={this.onDismiss}
            />
        );
    }
}
