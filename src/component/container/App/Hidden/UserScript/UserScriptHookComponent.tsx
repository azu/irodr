// MIT © 2017 azu
import * as React from "react";
import { UserScriptWindow } from "./UserScriptContainer";
import { UserScriptEvent } from "./UserScriptEvent";

export abstract class UserScriptHookComponent<P = {}, S = {}> extends React.PureComponent<P, S> {
    abstract displayName: string;

    private get userScriptEvent(): UserScriptEvent | undefined {
        const userScript = (window as UserScriptWindow).userScript;
        if (userScript && userScript.event) {
            return userScript.event;
        }
        return;
    }

    private createComponentEventName(name: string): string {
        return `${this.displayName}::${name}`;
    }

    componentDidMount() {
        if (this.userScriptEvent) {
            this.userScriptEvent.dispatch(this.createComponentEventName("componentDidMount"), this.props);
        }
    }

    componentDidUpdate() {
        if (this.userScriptEvent) {
            this.userScriptEvent.dispatch(this.createComponentEventName("componentDidMount"), this.props);
        }
    }

    componentWillUnmount() {
        if (this.userScriptEvent) {
            this.userScriptEvent.dispatch(this.createComponentEventName("componentDidMount"), this.props);
        }
    }
}
