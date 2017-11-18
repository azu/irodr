// MIT © 2017 azu

import * as ClientOAuth2 from "client-oauth2";
import { Token } from "client-oauth2";

const addLasSlash = (str: string) => {
    if (str[str.length - 1] === "/") return str;
    return `${str}/`;
};

export type GetAuthOptions = {
    clientId: string;
    clientSecret: string;
    accessTokenUri: string;
    authorizationUri: string;
    scopes: string[];
    state: string;
};

export interface TokenJSON {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expires: Date;
}

export class OAuth {
    constructor(public options: GetAuthOptions) {}

    getAuth(): ClientOAuth2 {
        // TODO: use env insteadof magic value
        const DynamicURL =
            process.env.REACT_APP_PUBLIC_URL_IS_DYNAMIC === "true" ? addLasSlash(location.origin) : undefined;
        const PUBLIC_URL = process.env.PUBLIC_URL;
        const redirectUri =
            DynamicURL !== undefined ? DynamicURL : PUBLIC_URL ? addLasSlash(PUBLIC_URL) : `http://localhost:13245/`;
        const { clientId, clientSecret, accessTokenUri, authorizationUri, scopes, state } = this.options;
        return new ClientOAuth2({
            clientId,
            clientSecret,
            accessTokenUri,
            authorizationUri,
            redirectUri: redirectUri,
            scopes,
            state
        });
    }

    getToken = () => {
        const savedTokenJSON = this.loadToken();
        if (!savedTokenJSON) {
            return Promise.reject(new Error("Token is not found"));
        }
        const token = this.getAuth().createToken(
            savedTokenJSON.accessToken,
            savedTokenJSON.refreshToken,
            savedTokenJSON.tokenType,
            {}
        );
        token.expiresIn(savedTokenJSON.expires);
        // Refresh the current users access token.
        if (token.expired()) {
            return token.refresh().then(updatedToken => {
                this.saveToken(updatedToken);
                return updatedToken;
            });
        }
        return Promise.resolve(token);
    };

    saveToken = (token: Token) => {
        const tokenJSON = {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenType: token.tokenType,
            expires: (token as any).expires
        };
        localStorage.setItem("inoreader-token", JSON.stringify(tokenJSON));
    };

    loadToken = (): TokenJSON | undefined => {
        const savedTokenString = localStorage.getItem("inoreader-token");
        if (!savedTokenString) {
            return;
        }
        const parsed = JSON.parse(savedTokenString);
        return {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            tokenType: parsed.tokenType,
            expires: new Date(parsed.expires)
        };
    };

    saveTokenFromCallbackURL = (url: string) => {
        // prune previous cache
        localStorage.removeItem("inoreader-token");
        return this.getAuth()
            .code.getToken(url)
            .then(token => {
                this.saveToken(token);
                return token;
            });
    };

    getNewTokenUrl = () => {
        return this.getAuth().code.getUri();
    };
}
