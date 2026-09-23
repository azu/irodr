import type { TokenResponse } from "./api-types.ts";

/** Stored in localStorage["inoreader-token"], the format used by irodr 1.x. */
export interface StoredToken {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    /** ISO date */
    expires: string;
}

export interface OAuthClient {
    clientId: string;
    clientSecret: string;
}

export interface InoreaderOAuthOptions {
    /** e.g. https://www.inoreader.com */
    baseUrl: string;
    /** Prefix for requests the browser cannot send cross-origin, e.g. "/cors-proxy/" */
    corsProxy: string;
    redirectUri: string;
    defaultClient: OAuthClient;
    fetch: typeof fetch;
    /** localStorage-compatible */
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    /** sessionStorage-compatible, keeps the CSRF state across the redirect. */
    session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    now: () => number;
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

/** Authorization-code flow with refresh tokens: https://www.inoreader.com/developers/oauth */
export class InoreaderOAuth {
    #refreshing?: Promise<StoredToken>;
    private readonly options: InoreaderOAuthOptions;

    constructor(options: InoreaderOAuthOptions) {
        this.options = options;
    }

    get client(): OAuthClient {
        const custom = readJSON(this.options.storage, CLIENT_KEY) as Partial<OAuthClient> | undefined;
        return custom?.clientId && custom.clientSecret
            ? { clientId: custom.clientId, clientSecret: custom.clientSecret }
            : this.options.defaultClient;
    }

    get customClient(): OAuthClient | undefined {
        const client = this.client;
        return client === this.options.defaultClient ? undefined : client;
    }

    /** Use your own Inoreader app. Empty values restore the default app. */
    setCustomClient(client: OAuthClient | undefined): void {
        if (client?.clientId.trim() && client.clientSecret.trim()) {
            this.options.storage.setItem(
                CLIENT_KEY,
                JSON.stringify({ clientId: client.clientId.trim(), clientSecret: client.clientSecret.trim() })
            );
        } else {
            this.options.storage.removeItem(CLIENT_KEY);
        }
    }

    get token(): StoredToken | undefined {
        const token = readJSON(this.options.storage, TOKEN_KEY) as Partial<StoredToken> | undefined;
        return typeof token?.accessToken === "string" && token.accessToken
            ? {
                  accessToken: token.accessToken,
                  refreshToken: typeof token.refreshToken === "string" ? token.refreshToken : undefined,
                  tokenType: typeof token.tokenType === "string" ? token.tokenType : "Bearer",
                  expires: typeof token.expires === "string" ? token.expires : new Date(0).toISOString()
              }
            : undefined;
    }

    clearToken(): void {
        this.options.storage.removeItem(TOKEN_KEY);
    }

    authorizeUrl(): string {
        const state = crypto.randomUUID();
        this.options.session.setItem(STATE_KEY, state);
        const url = new URL(`${this.options.baseUrl}/oauth2/auth`);
        url.searchParams.set("client_id", this.client.clientId);
        url.searchParams.set("redirect_uri", this.options.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "read write");
        url.searchParams.set("state", state);
        return url.toString();
    }

    isCallback(url: URL): boolean {
        return url.searchParams.has("code") || (url.searchParams.has("error") && url.searchParams.has("state"));
    }

    /** Exchange the authorization code in the callback URL for tokens. */
    async handleCallback(url: URL): Promise<StoredToken> {
        const expected = this.options.session.getItem(STATE_KEY);
        this.options.session.removeItem(STATE_KEY);
        const error = url.searchParams.get("error");
        if (error) throw new InoreaderAuthError(`Inoreader authorization was not granted (${error}).`);
        if (!expected || url.searchParams.get("state") !== expected) {
            throw new InoreaderAuthError("Inoreader authorization failed: the state did not match. Try again.");
        }
        this.clearToken();
        return this.requestToken({
            grant_type: "authorization_code",
            code: url.searchParams.get("code") ?? "",
            redirect_uri: this.options.redirectUri,
            scope: ""
        });
    }

    /** A valid access token, refreshed when it has expired. */
    async accessToken(): Promise<string> {
        const token = this.token;
        if (!token) throw new InoreaderAuthError("Inoreader is not connected.");
        if (Date.parse(token.expires) > this.options.now()) return token.accessToken;
        return (await this.refresh()).accessToken;
    }

    /** Refresh once even when several requests notice the expiry together. */
    refresh(): Promise<StoredToken> {
        this.#refreshing ??= (async () => {
            const refreshToken = this.token?.refreshToken;
            if (!refreshToken) throw new InoreaderAuthError("Inoreader session expired. Connect again.");
            return this.requestToken({ grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);
        })().finally(() => {
            this.#refreshing = undefined;
        });
        return this.#refreshing;
    }

    private async requestToken(params: Record<string, string>, previousRefreshToken?: string): Promise<StoredToken> {
        const { clientId, clientSecret } = this.client;
        const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });
        let response: Response;
        try {
            response = await this.options.fetch(`${this.options.corsProxy}${this.options.baseUrl}/oauth2/token`, {
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
        if (!response.ok) {
            if (response.status === 400 || response.status === 401) this.clearToken();
            throw new InoreaderAuthError(`Inoreader authorization failed (HTTP ${response.status}). Connect again.`);
        }
        const json = (await response.json()) as TokenResponse;
        if (typeof json.access_token !== "string" || !json.access_token) {
            throw new InoreaderAuthError("Inoreader returned an invalid token.");
        }
        const token: StoredToken = {
            accessToken: json.access_token,
            refreshToken: json.refresh_token ?? previousRefreshToken,
            tokenType: json.token_type ?? "Bearer",
            expires: new Date(this.options.now() + (json.expires_in ?? 3600) * 1000).toISOString()
        };
        this.options.storage.setItem(TOKEN_KEY, JSON.stringify(token));
        return token;
    }
}
