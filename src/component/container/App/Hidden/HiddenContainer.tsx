import * as React from "react";
import { ShortcutKeyContainer } from "./ShortcutKeyContainer/ShortcutKeyContainer";
import { UserScriptContainer } from "./UserScript/UserScriptContainer";
import { SubscriptionListState } from "../Subscription/SubscriptionList/SubscriptionListStore";
import { SubscriptionContentsState } from "../Subscription/SubscriptionContents/SubscriptionContentsStore";
import { ObserverContainer } from "./ObserverContainer/ObserverContainer";
import { AppPreferences } from "../../../../domain/App/Preferences/AppPreferences";

export interface HiddenContainerProps {
    appPreferences: AppPreferences;
    subscriptionList: SubscriptionListState;
    subscriptionContents: SubscriptionContentsState;
}

export class HiddenContainer extends React.Component<HiddenContainerProps, {}> {
    shortcutKey: ShortcutKeyContainer | null;

    render() {
        return (
            <div hidden className="HiddenContainer">
                <ObserverContainer appPreferences={this.props.appPreferences} />
                <UserScriptContainer
                    shortcutKey={this.shortcutKey}
                    subscriptionList={this.props.subscriptionList}
                    subscriptionContents={this.props.subscriptionContents}
                />
                <ShortcutKeyContainer
                    ref={c => (this.shortcutKey = c)}
                    subscriptionList={this.props.subscriptionList}
                    subscriptionContents={this.props.subscriptionContents}
                />
            </div>
        );
    }
}
