import * as React from "react";
import { Modal } from "office-ui-fabric-react/lib-amd/components/Modal";
import { TextField } from "office-ui-fabric-react";

export interface AuthorizePanelProps {
    isOpen: boolean;
    onDismiss: () => void;
    onClickAuthorize: () => void;
}

export interface AuthorizeModalState {
    clientId: string;
    clientSecret: string;
}

export class AuthorizeModal extends React.Component<AuthorizePanelProps, AuthorizeModalState> {
    state = {
        clientId: "",
        clientSecret: ""
    };

    render() {
        return (
            <Modal
                isOpen={this.props.isOpen}
                onDismiss={this.props.onDismiss}
                isBlocking={false}
                containerClassName="AuthorizePanel"
            >
                <p>If you want to your Client ID/Secret, Please input following.</p>
                <TextField
                    className="AuthorizeModal-clientId"
                    label="Inoreader App Client Id"
                    value={String(this.state.clientId)}
                    onChanged={newValue => {
                        const autoRefreshSubscriptionSec = Number(newValue);
                        if (Number.isNaN(autoRefreshSubscriptionSec)) {
                            return;
                        }
                        // this.setState({
                        //     autoRefreshSubscriptionSec
                        // });
                    }}
                />
                <TextField
                    className="AuthorizeModal-clientSecret"
                    label="Inoreader Appp Client secreat"
                    value={String(this.state.clientSecret)}
                    onChanged={newValue => {
                        // this.setState({
                        //     prefetchSubscriptionCount: prefetchSubscriptionCount
                        // });
                    }}
                />
            </Modal>
        );
    }
}
