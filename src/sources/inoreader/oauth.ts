import type { TokenResponse } from "./api-types.ts";

/** Stored in localStorage["inoreader-token"], the format used by irodr 1.x. */
export interface StoredToken {
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly tokenType: string;
    /** ISO date */
    readonly expires: string;
}

export interface OAuthClient {
    readonly clientId: string;
    readonly clientSecret: string;
}

/** The part of the Web Storage API (localStorage, sessionStorage) the OAuth client uses. */
export type WebStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface InoreaderOAuthOptions {
    /** e.g. https://www.inoreader.com */
    readonly baseUrl: string;
    /** Prefix for requests the browser cannot send cross-origin, e.g. "/cors-proxy/" */
    readonly corsProxy: string;
    readonly redirectUri: string;
    readonly defaultClient: OAuthClient;
    readonly fetch: typeof fetch;
    /** localStorage-compatible */
    readonly storage: WebStorage;
    /** sessionStorage-compatible, keeps the CSRF state across the redirect. */
    readonly session: WebStorage;
    readonly now: () => number;
}

/**
 * Authorization-code flow with refresh tokens: https://www.inoreader.com/developers/oauth
 *
 * The token and the custom client are read from `storage` on every call, so each tab sees
 * what another tab saved.
 */
export interface InoreaderOAuth {
    /** The custom client when one is saved, the default client otherwise. */
    readonly client: () => OAuthClient;
    /** The saved custom client, if any. */
    readonly customClient: () => OAuthClient | undefined;
    /** Use your own Inoreader app. Empty values restore the default app. */
    readonly setCustomClient: (client: OAuthClient | undefined) => void;
    readonly token: () => StoredToken | undefined;
    readonly clearToken: () => void;
    /** The authorization page URL. Saves a new CSRF state in `session`. */
    readonly authorizeUrl: () => string;
    readonly isCallback: (url: URL) => boolean;
    /** Exchange the authorization code in the callback URL for tokens. */
    readonly handleCallback: (url: URL) => Promise<StoredToken>;
    /** A valid access token, refreshed when it has expired. */
    readonly accessToken: () => Promise<string>;
    /**
     * Replace `rejectedAccessToken` with a new token. Refreshes once even when several
     * requests notice the expiry together, and reuses a token another tab already refreshed.
     */
    readonly refresh: (rejectedAccessToken: string) => Promise<StoredToken>;
}

const TOKEN_KEY = "inoreader-token";
const CLIENT_KEY = "irodr:inoreader-client";
const STATE_KEY = "irodr:inoreader-oauth-state";

export class InoreaderAuthError extends Error {
    override name = "InoreaderAuthError";
}

function readJSON(storage: Pick<Storage, "getItem">, key: string): unknown {
    try {
        const value = storage.getItem(key);
        return value ? JSON.parse(value) : undefined;
    } catch {
        return undefined;
    }
}

/** A stored token, with the defaults irodr 1.x relied on. Undefined without an access token. */
export function parseToken(value: unknown): StoredToken | undefined {
    const token = value as Partial<StoredToken> | undefined;
    return typeof token?.accessToken === "string" && token.accessToken
        ? {
              accessToken: token.accessToken,
              refreshToken: typeof token.refreshToken === "string" ? token.refreshToken : undefined,
              tokenType: typeof token.tokenType === "string" ? token.tokenType : "Bearer",
              expires: typeof token.expires === "string" ? token.expires : new Date(0).toISOString()
          }
        : undefined;
}

/** A stored custom client. Undefined unless both the ID and the secret are set. */
export function parseCustomClient(value: unknown): OAuthClient | undefined {
    const custom = value as Partial<OAuthClient> | undefined;
    return custom?.clientId && custom.clientSecret
        ? { clientId: custom.clientId, clientSecret: custom.clientSecret }
        : undefined;
}

/**
 * The token to store from a token endpoint response received at `now`, or undefined when it has no
 * access token. A refresh response without a refresh token keeps `previousRefreshToken`.
 */
export function tokenFromResponse(
    json: TokenResponse,
    previousRefreshToken: string | undefined,
    now: number
): StoredToken | undefined {
    if (typeof json.access_token !== "string" || !json.access_token) return undefined;
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? previousRefreshToken,
        tokenType: json.token_type ?? "Bearer",
        expires: new Date(now + (json.expires_in ?? 3600) * 1000).toISOString()
    };
}

export function authorizationUrl(
    baseUrl: string,
    request: { readonly clientId: string; readonly redirectUri: string; readonly state: string }
): string {
    const url = new URL(`${baseUrl}/oauth2/auth`);
    url.searchParams.set("client_id", request.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read write");
    url.searchParams.set("state", request.state);
    return url.toString();
}

/** Whether `url` is the redirect back from the authorization page, granted or denied. */
export function isAuthorizationCallback(url: URL): boolean {
    return url.searchParams.has("code") || (url.searchParams.has("error") && url.searchParams.has("state"));
}

export function createInoreaderOAuth(options: InoreaderOAuthOptions): InoreaderOAuth {
    // Runtime handle: the refresh in flight, shared by every request that notices the expiry meanwhile.
    const inFlight = new Map<"refresh", Promise<StoredToken>>();

    const customClient = (): OAuthClient | undefined => parseCustomClient(readJSON(options.storage, CLIENT_KEY));
    const client = (): OAuthClient => customClient() ?? options.defaultClient;
    const token = (): StoredToken | undefined => parseToken(readJSON(options.storage, TOKEN_KEY));
    const clearToken = (): void => options.storage.removeItem(TOKEN_KEY);

    const postToken = async (body: URLSearchParams): Promise<Response> => {
        try {
            return await options.fetch(`${options.corsProxy}${options.baseUrl}/oauth2/token`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body
            });
        } catch {
            throw new Error("Could not reach Inoreader. Check your connection.");
        }
    };

    const requestToken = async (
        params: Readonly<Record<string, string>>,
        previousRefreshToken?: string
    ): Promise<StoredToken> => {
        const { clientId, clientSecret } = client();
        const response = await postToken(
            new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret })
        );
        if (response.status === 400 || response.status === 401) {
            // The grant was rejected. Another tab may have refreshed with this refresh token
            // already: keep its token instead of deleting it.
            const current = token();
            if (previousRefreshToken && current && current.refreshToken !== previousRefreshToken) return current;
            clearToken();
            throw new InoreaderAuthError(`Inoreader authorization failed (HTTP ${response.status}). Connect again.`);
        }
        if (!response.ok) {
            // Outages and proxy errors are temporary: keep the session and retry later.
            throw new Error(`Inoreader is unavailable (HTTP ${response.status}). Try again later.`);
        }
        const next = tokenFromResponse((await response.json()) as TokenResponse, previousRefreshToken, options.now());
        if (!next) throw new InoreaderAuthError("Inoreader returned an invalid token.");
        options.storage.setItem(TOKEN_KEY, JSON.stringify(next));
        return next;
    };

    const renew = async (rejectedAccessToken: string): Promise<StoredToken> => {
        const current = token();
        if (!current) throw new InoreaderAuthError("Inoreader is not connected.");
        if (current.accessToken !== rejectedAccessToken && Date.parse(current.expires) > options.now()) {
            return current;
        }
        if (!current.refreshToken) throw new InoreaderAuthError("Inoreader session expired. Connect again.");
        return requestToken({ grant_type: "refresh_token", refresh_token: current.refreshToken }, current.refreshToken);
    };

    const refresh = (rejectedAccessToken: string): Promise<StoredToken> => {
        const running = inFlight.get("refresh");
        if (running) return running;
        const next = renew(rejectedAccessToken).finally(() => inFlight.delete("refresh"));
        inFlight.set("refresh", next);
        return next;
    };

    return {
        client,
        customClient,
        setCustomClient: (custom) => {
            if (custom?.clientId.trim() && custom.clientSecret.trim()) {
                options.storage.setItem(
                    CLIENT_KEY,
                    JSON.stringify({ clientId: custom.clientId.trim(), clientSecret: custom.clientSecret.trim() })
                );
            } else {
                options.storage.removeItem(CLIENT_KEY);
            }
        },
        token,
        clearToken,
        authorizeUrl: () => {
            const state = crypto.randomUUID();
            options.session.setItem(STATE_KEY, state);
            return authorizationUrl(options.baseUrl, {
                clientId: client().clientId,
                redirectUri: options.redirectUri,
                state
            });
        },
        isCallback: isAuthorizationCallback,
        handleCallback: async (url) => {
            const expected = options.session.getItem(STATE_KEY);
            options.session.removeItem(STATE_KEY);
            const error = url.searchParams.get("error");
            if (error) throw new InoreaderAuthError(`Inoreader authorization was not granted (${error}).`);
            if (!expected || url.searchParams.get("state") !== expected) {
                throw new InoreaderAuthError("Inoreader authorization failed: the state did not match. Try again.");
            }
            clearToken();
            return requestToken({
                grant_type: "authorization_code",
                code: url.searchParams.get("code") ?? "",
                redirect_uri: options.redirectUri,
                scope: ""
            });
        },
        accessToken: async () => {
            const current = token();
            if (!current) throw new InoreaderAuthError("Inoreader is not connected.");
            if (Date.parse(current.expires) > options.now()) return current.accessToken;
            return (await refresh(current.accessToken)).accessToken;
        },
        refresh
    };
}
