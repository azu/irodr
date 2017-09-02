// MIT © 2017 azu

import * as ClientOAuth2 from "client-oauth2";
import { Token } from "client-oauth2";

const inoreaderAuth = new ClientOAuth2({
    clientId: process.env.REACT_APP_INOREADER_CLIENT_ID,
    clientSecret: process.env.REACT_APP_INOREADER_CLIENT_KEY,
    accessTokenUri: process.env.REACT_APP_INOREADER_ACCESS_TOKEN_URL,
    authorizationUri: "https://www.inoreader.com/oauth2/auth",
    redirectUri: `${process.env.PUBLIC_URL}/`,
    scopes: ["read", "write"],
    state: "inoreader"
});

export interface TokenJSON {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expires: Date;
}

export const saveToken = (token: Token) => {
    let tokenJSOn = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        expires: (token as any).expires
    };
    localStorage.setItem("inoreader-token", JSON.stringify(tokenJSOn));
};
export const loadToken = (): TokenJSON | undefined => {
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
export const saveTokenFromCallbackURL = (url: string) => {
    return inoreaderAuth.code.getToken(url).then(token => {
        saveToken(token);
        return token;
    });
};
export const getToken = () => {
    const savedTokenJSON = loadToken();
    if (!savedTokenJSON) {
        return Promise.reject(new Error("Token is not found"));
    }
    const token = inoreaderAuth.createToken(
        savedTokenJSON.accessToken,
        savedTokenJSON.refreshToken,
        savedTokenJSON.tokenType,
        {}
    );
    token.expiresIn(savedTokenJSON.expires);
    // Refresh the current users access token.
    if (token.expired()) {
        return token.refresh().then(function(updatedToken) {
            saveToken(updatedToken);
            return updatedToken;
        });
    }
    return Promise.resolve(token);
};

export const getNewTokenUrl = () => {
    return inoreaderAuth.code.getUri();
};
