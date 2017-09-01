import * as React from "react";
import { SubscriptionListState } from "../../Subscription/SubscriptionList/SubscriptionListStore";
import { SubscriptionContentsState } from "../../Subscription/SubscriptionContents/SubscriptionContentsStore";
import { getActiveContentIdString } from "../../Subscription/SubscriptionContents/SubscriptionContentsContainer";
import { SubscriptionContentSerializer } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { SubscriptionSerializer } from "../../../../../domain/Subscriptions/Subscription";
import { ShortcutKeyContainer } from "../ShortcutKeyContainer/ShortcutKeyContainer";

export interface UserScriptActiveContent {
    id: string;
    author: string;
    publishedDate: Date;
    // if is not update, same with publishedDate
    updatedDate: Date;
    title: string;
    body: string;
    url: string;
}

export interface UserScriptActiveSubscription {
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
}

export interface UserScriptWindow extends Window {
    userScript: {
        getActiveContent(): UserScriptActiveContent | undefined;
        getActiveSubscription(): UserScriptActiveSubscription | undefined;
        trigger(keys: string, action?: string): void;
    };
}

export interface UserScriptContainerProps {
    shortcutKey: ShortcutKeyContainer | null;
    subscriptionContents: SubscriptionContentsState;
    subscriptionList: SubscriptionListState;
}

export class UserScriptContainer extends React.Component<UserScriptContainerProps, {}> {
    getActiveContent = () => {
        const activeContentIdString = getActiveContentIdString();
        if (!activeContentIdString) {
            return;
        }
        const activeContentId = this.props.subscriptionContents.getContentId(activeContentIdString);
        const activeContent = this.props.subscriptionContents.getNextContent(activeContentId);
        if (!activeContent) {
            return;
        }
        const subscriptionContentJSON = SubscriptionContentSerializer.toJSON(activeContent);
        return {
            id: subscriptionContentJSON.id,
            author: subscriptionContentJSON.author,
            publishedDate: new Date(subscriptionContentJSON.publishedDate),
            updatedDate: new Date(subscriptionContentJSON.updatedDate),
            title: subscriptionContentJSON.title,
            body: subscriptionContentJSON.body,
            url: subscriptionContentJSON.url
        };
    };

    getActiveSubscription = () => {
        const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
        if (!currentSubscriptionId) {
            return;
        }
        const currentSubscription = this.props.subscriptionList.getItem(currentSubscriptionId);
        if (!currentSubscription) {
            return;
        }
        const subscriptionJSON = SubscriptionSerializer.toJSON(currentSubscription);
        return {
            title: subscriptionJSON.title,
            url: subscriptionJSON.url,
            iconUrl: subscriptionJSON.iconUrl,
            htmlUrl: subscriptionJSON.htmlUrl
        };
    };

    trigger = (keys: string, action?: string) => {
        const shortcutKey = this.props.shortcutKey;
        if (shortcutKey) {
            shortcutKey.trigger(keys, action);
        }
    };

    componentDidMount() {
        (window as UserScriptWindow).userScript = {
            getActiveContent: this.getActiveContent,
            getActiveSubscription: this.getActiveSubscription,
            trigger: this.trigger
        };
    }

    componentWillUnmount() {
        delete (window as UserScriptWindow).userScript;
    }

    render() {
        return null;
    }
}
