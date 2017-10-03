// MIT © 2017 azu
import { StoreGroup } from "almin";
import { SubscriptionListStore } from "./Subscription/SubscriptionList/SubscriptionListStore";
import { SubscriptionContentsStore } from "./Subscription/SubscriptionContents/SubscriptionContentsStore";
import { AppHeaderStore } from "./AppHeader/AppHeaderStore";
import { AppPreferencesStore } from "./Preferences/AppPreferencesStore";
import { repositoryContainer } from "../../../infra/repository/RepositoryContainer";
import { AuthorizePanelStore } from "./Panel/AuthorizePanelStore";

export const appStoreGroup = new StoreGroup({
    subscriptionList: new SubscriptionListStore(repositoryContainer.get()),
    subscriptionContents: new SubscriptionContentsStore(repositoryContainer.get()),
    appHeader: new AppHeaderStore(repositoryContainer.get()),
    appPreferences: new AppPreferencesStore(repositoryContainer.get()),
    authorizePanel: new AuthorizePanelStore()
});
