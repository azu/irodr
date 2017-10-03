import * as React from "react";
import { Modal } from "office-ui-fabric-react/lib-amd/components/Modal";
import { CompoundButton, TextField } from "office-ui-fabric-react";
import { Authority } from "../../../domain/App/Authority/Authority";

export interface AuthorizePanelProps {
    isOpen: boolean;
    onDismiss: () => void;
    onClickConnect: (state: AuthorizeModalState) => void;
    authority: Authority;
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

    onClickConnect = () => {
        this.props.onClickConnect({
            clientId: this.state.clientId,
            clientSecret: this.state.clientSecret
        });
    };

    updateState = (state: AuthorizeModalState) => {
        this.setState({
            clientId: state.clientId,
            clientSecret: state.clientSecret
        });
    };

    componentWillMount() {
        if (this.props.authority) {
            this.updateState(this.props.authority);
        }
    }

    componentWillReceiveProps(nextProps: AuthorizePanelProps) {
        if (nextProps.authority) {
            this.updateState(nextProps.authority);
        }
    }

    render() {
        return (
            <Modal
                isOpen={this.props.isOpen}
                onDismiss={this.props.onDismiss}
                isBlocking={false}
                containerClassName="AuthorizePanel"
            >
                <div className="AuthorizePanel-authorizeArea">
                    <h1 className="AuthorizePanel-panelTitle">Inoreader Authorization</h1>
                    <ol>
                        <li>
                            Click <b>Connect to Inoreader</b>
                        </li>
                        <li>
                            Click <b>Authorize </b>
                        </li>
                        <li>You can read RSS if success!</li>
                    </ol>
                    <CompoundButton
                        className="AuthorizePanel-authorizeButton"
                        description="You can Connect to Inoreader here."
                        onClick={this.onClickConnect}
                    >
                        Connect to Inoreader
                    </CompoundButton>
                </div>
                <p>If you want to use your Client ID/Secret, Please input following.</p>
                <TextField
                    className="AuthorizeModal-clientId"
                    label="Inoreader App Client Id"
                    value={String(this.state.clientId)}
                    onChanged={newValue => {
                        this.setState({
                            clientId: newValue
                        });
                    }}
                />
                <TextField
                    className="AuthorizeModal-clientSecret"
                    label="Inoreader App Client secret"
                    value={String(this.state.clientSecret)}
                    onChanged={newValue => {
                        this.setState({
                            clientSecret: newValue
                        });
                    }}
                />
            </Modal>
        );
    }
}
