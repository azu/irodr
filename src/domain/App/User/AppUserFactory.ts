// MIT © 2017 azu
import { ulid } from "ulid";
import { AppUser, AppUserArgs, AppUserIdentifier } from "./AppUser";
import { AppSubscriptionActivity } from "./AppSubscriptionActivity";
import { InoreaderAuthority, InoreaderAuthorityIdentifier } from "../Authority/InoreaderAuthority";

const corsProxy = localStorage.getItem("REACT_APP_CORS_PROXY") ?? process.env.REACT_APP_CORS_PROXY;
export const defaultAppUserArgs = (isMachine: boolean): AppUserArgs => {
    return {
        id: new AppUserIdentifier(ulid()),
        isMachine: isMachine,
        subscriptionActivity: new AppSubscriptionActivity({
            items: []
        }),
        authority: new InoreaderAuthority({
            id: new InoreaderAuthorityIdentifier(process.env.REACT_APP_INOREADER_CLIENT_ID!),
            clientId: process.env.REACT_APP_INOREADER_CLIENT_ID!,
            clientSecret: process.env.REACT_APP_INOREADER_CLIENT_KEY!,
            accessTokenUri: corsProxy
                ? `${corsProxy}https://www.inoreader.com/oauth2/token`
                : "https://www.inoreader.com/oauth2/token",
            authorizationUri: "https://www.inoreader.com/oauth2/auth",
            scopes: ["read", "write"],
            state: "inoreader"
        })
    };
};

export const createMachineUser = () => {
    return new AppUser(defaultAppUserArgs(true));
};

export const createAppUser = () => {
    return new AppUser(defaultAppUserArgs(false));
};
