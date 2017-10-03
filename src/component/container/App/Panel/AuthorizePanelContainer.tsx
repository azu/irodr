// MIT © 2017 azu
import * as React from "react";
import { AuthorizeModal } from "../../../project/AuthorizeModal/AuthorizeModal";
import { AuthorizePanelState } from "./AuthorizePanelStore";

export interface AuthorizePanelContainerProps {
    authorizePanel: AuthorizePanelState;
}

export class AuthorizePanelContainer extends React.Component<AuthorizePanelContainerProps, {}> {
    render() {
        return (
            <AuthorizeModal
                isOpen={this.props.authorizePanel.isShown}
                onClickAuthorize={() => {}}
                onDismiss={() => {}}
            />
        );
    }
}
