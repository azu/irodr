import * as React from "react";
import { SubscriptionListState } from "../../Subscription/SubscriptionList/SubscriptionListStore";
import { SubscriptionContentsState } from "../../Subscription/SubscriptionContents/SubscriptionContentsStore";
import { SubscriptionContentSerializer } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { SubscriptionSerializer } from "../../../../../domain/Subscriptions/Subscription";
import { ShortcutKeyContainer } from "../ShortcutKeyContainer/ShortcutKeyContainer";
import { UserScriptEvent } from "./UserScriptEvent";

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

export type UserScriptWindow = typeof globalThis &
    Window & {
        userScript: {
            getActiveContent(): UserScriptActiveContent | undefined;
            getActiveSubscription(): UserScriptActiveSubscription | undefined;
            triggerKey(keys: string, action?: string): void;
            registerKey(keys: string, handler: (event?: Event) => void): void;
            getDefaultActions: () => any;
            // Replace implementation
            mock?: {
                fetch: (input: RequestInfo, init?: RequestInit) => Promise<any>;
            };
            event: UserScriptEvent;
        };
    };

export interface UserScriptContainerProps {
    shortcutKey: ShortcutKeyContainer | null;
    subscriptionContents: SubscriptionContentsState;
    subscriptionList: SubscriptionListState;
}

export class UserScriptContainer extends React.Component<UserScriptContainerProps, {}> {
    getActiveContent = () => {
        const activeContentId = this.props.subscriptionContents.focusContentId;
        if (!activeContentId) {
            return;
        }
        const activeContent = this.props.subscriptionContents.getContent(activeContentId);
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

    triggerKey = (key: string, action?: string) => {
        const shortcutKey = this.props.shortcutKey;
        if (shortcutKey) {
            shortcutKey.triggerKey(key, action);
        }
    };

    registerKey = (key: string, handler: (event?: Event) => void) => {
        const shortcutKey = this.props.shortcutKey;
        if (shortcutKey) {
            shortcutKey.registerKey(key, handler);
        }
    };

    componentDidMount() {
        const userScriptEvent = new UserScriptEvent();
        (window as UserScriptWindow).userScript = {
            getActiveContent: this.getActiveContent,
            getActiveSubscription: this.getActiveSubscription,
            triggerKey: this.triggerKey,
            registerKey: this.registerKey,
            getDefaultActions: () => {
                return this.props.shortcutKey!.defaultActions;
            },
            event: userScriptEvent
        };
        // You can listen the "userscript-init" event by `window.addEventListener("userscript-init", (event) => {})`
        const UserScriptInit = new CustomEvent("userscript-init", {
            detail: {
                userScript: (window as UserScriptWindow).userScript
            }
        });
        window.dispatchEvent(UserScriptInit);
    }

    componentWillUnmount() {
        delete (window as UserScriptWindow).userScript;
        const UserScriptInit = new CustomEvent("userscript-uninit");
        window.dispatchEvent(UserScriptInit);
    }

    render() {
        return null;
    }
}
