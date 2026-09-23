import { describe, expect, it } from "vite-plus/test";
import { createMemoryStorage } from "./memory-storage.ts";
import {
    authorizationUrl,
    createInoreaderOAuth,
    InoreaderAuthError,
    isAuthorizationCallback,
    parseCustomClient,
    parseToken,
    type StoredToken,
    tokenFromResponse,
    type WebStorage
} from "./oauth.ts";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const DEFAULT_CLIENT = { clientId: "default-id", clientSecret: "default-secret" };

interface TokenRequest {
    readonly url: string;
    readonly body: URLSearchParams;
}

/**
 * An OAuth client whose token endpoint answers with `respond`, called with the request and the storage.
 * Requests are recorded in `requests`.
 */
function createOAuth(
    respond: (request: TokenRequest, storage: WebStorage) => Response | Promise<Response>,
    setup: { readonly token?: StoredToken; readonly corsProxy?: string } = {}
) {
    const storage = createMemoryStorage();
    if (setup.token) storage.setItem("inoreader-token", JSON.stringify(setup.token));
    const requests: TokenRequest[] = [];
    const oauth = createInoreaderOAuth({
        baseUrl: "https://www.inoreader.com",
        corsProxy: setup.corsProxy ?? "",
        redirectUri: "https://irodr.test/",
        defaultClient: DEFAULT_CLIENT,
        fetch: async (input, init) => {
            const request = {
                url: input instanceof Request ? input.url : input.toString(),
                body: init?.body instanceof URLSearchParams ? init.body : new URLSearchParams()
            };
            requests.push(request);
            return respond(request, storage);
        },
        storage,
        session: createMemoryStorage(),
        now: () => NOW
    });
    return { oauth, storage, requests };
}

function granted(accessToken: string, fields: Record<string, unknown> = {}): Response {
    return Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, ...fields });
}

const expired: StoredToken = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    tokenType: "Bearer",
    expires: new Date(NOW - 1000).toISOString()
};

function stored(storage: WebStorage): unknown {
    return JSON.parse(storage.getItem("inoreader-token") ?? "null");
}

describe("parseToken", () => {
    it("reads an irodr 1.x token", () => {
        const expires = new Date(NOW);
        const saved = JSON.parse(
            JSON.stringify({ accessToken: "a", refreshToken: "r", tokenType: "bearer", expires })
        ) as unknown;
        expect(parseToken(saved)).toEqual({
            accessToken: "a",
            refreshToken: "r",
            tokenType: "bearer",
            expires: expires.toISOString()
        });
    });

    it("fills in missing fields", () => {
        expect(parseToken({ accessToken: "a", refreshToken: 1 })).toEqual({
            accessToken: "a",
            refreshToken: undefined,
            tokenType: "Bearer",
            expires: new Date(0).toISOString()
        });
    });

    it("needs an access token", () => {
        expect(parseToken(undefined)).toBeUndefined();
        expect(parseToken(null)).toBeUndefined();
        expect(parseToken({ accessToken: "" })).toBeUndefined();
        expect(parseToken({ accessToken: 1 })).toBeUndefined();
    });
});

describe("parseCustomClient", () => {
    it("needs both the client ID and the secret", () => {
        expect(parseCustomClient({ clientId: "id", clientSecret: "secret" })).toEqual({
            clientId: "id",
            clientSecret: "secret"
        });
        expect(parseCustomClient({ clientId: "id", clientSecret: "" })).toBeUndefined();
        expect(parseCustomClient({ clientSecret: "secret" })).toBeUndefined();
        expect(parseCustomClient(undefined)).toBeUndefined();
    });
});

describe("tokenFromResponse", () => {
    it("computes the expiry and keeps the previous refresh token when none is returned", () => {
        expect(tokenFromResponse({ access_token: "a", expires_in: 60 }, "r", NOW)).toEqual({
            accessToken: "a",
            refreshToken: "r",
            tokenType: "Bearer",
            expires: new Date(NOW + 60_000).toISOString()
        });
        expect(tokenFromResponse({ access_token: "a", refresh_token: "r2", token_type: "bearer" }, "r", NOW)).toEqual({
            accessToken: "a",
            refreshToken: "r2",
            tokenType: "bearer",
            expires: new Date(NOW + 3_600_000).toISOString()
        });
    });

    it("is undefined without an access token", () => {
        expect(tokenFromResponse({ access_token: "" }, undefined, NOW)).toBeUndefined();
    });
});

describe("authorizationUrl", () => {
    it("requests read and write access with the CSRF state", () => {
        const url = new URL(
            authorizationUrl("https://www.inoreader.com", {
                clientId: "id",
                redirectUri: "https://irodr.test/",
                state: "s"
            })
        );
        expect(url.origin + url.pathname).toBe("https://www.inoreader.com/oauth2/auth");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: "id",
            redirect_uri: "https://irodr.test/",
            response_type: "code",
            scope: "read write",
            state: "s"
        });
    });
});

describe("isAuthorizationCallback", () => {
    it("recognizes granted and denied authorizations", () => {
        expect(isAuthorizationCallback(new URL("https://irodr.test/?code=c&state=s"))).toBe(true);
        expect(isAuthorizationCallback(new URL("https://irodr.test/?error=access_denied&state=s"))).toBe(true);
        expect(isAuthorizationCallback(new URL("https://irodr.test/?error=other"))).toBe(false);
        expect(isAuthorizationCallback(new URL("https://irodr.test/"))).toBe(false);
    });
});

describe("createInoreaderOAuth", () => {
    it("saves a trimmed custom client and restores the default one", () => {
        const { oauth, storage } = createOAuth(() => granted("unused"));
        expect(oauth.client()).toBe(DEFAULT_CLIENT);
        oauth.setCustomClient({ clientId: " mine ", clientSecret: " secret " });
        expect(JSON.parse(storage.getItem("irodr:inoreader-client") ?? "null")).toEqual({
            clientId: "mine",
            clientSecret: "secret"
        });
        expect(oauth.client()).toEqual({ clientId: "mine", clientSecret: "secret" });
        expect(oauth.customClient()).toEqual({ clientId: "mine", clientSecret: "secret" });
        oauth.setCustomClient({ clientId: "mine", clientSecret: " " });
        expect(storage.getItem("irodr:inoreader-client")).toBeNull();
        expect(oauth.client()).toBe(DEFAULT_CLIENT);
        expect(oauth.customClient()).toBeUndefined();
    });

    it("rejects a denied authorization and a callback without the saved state", async () => {
        const { oauth, requests } = createOAuth(() => granted("unused"));
        await expect(oauth.handleCallback(new URL("https://irodr.test/?error=access_denied&state=s"))).rejects.toThrow(
            "Inoreader authorization was not granted (access_denied)."
        );
        const state = new URL(oauth.authorizeUrl()).searchParams.get("state");
        await expect(oauth.handleCallback(new URL(`https://irodr.test/?code=c&state=${state}x`))).rejects.toThrow(
            InoreaderAuthError
        );
        // The state is used once.
        await expect(oauth.handleCallback(new URL(`https://irodr.test/?code=c&state=${state}`))).rejects.toThrow(
            "the state did not match"
        );
        expect(requests).toEqual([]);
    });

    it("exchanges the code through the CORS proxy with the client credentials", async () => {
        const { oauth, storage, requests } = createOAuth(() => granted("access-2", { refresh_token: "refresh-2" }), {
            corsProxy: "/cors-proxy/"
        });
        const state = new URL(oauth.authorizeUrl()).searchParams.get("state");
        await oauth.handleCallback(new URL(`https://irodr.test/?code=c&state=${state}`));
        expect(requests.map((request) => request.url)).toEqual(["/cors-proxy/https://www.inoreader.com/oauth2/token"]);
        expect(Object.fromEntries(requests[0]?.body ?? [])).toEqual({
            grant_type: "authorization_code",
            code: "c",
            redirect_uri: "https://irodr.test/",
            scope: "",
            client_id: "default-id",
            client_secret: "default-secret"
        });
        expect(stored(storage)).toEqual({
            accessToken: "access-2",
            refreshToken: "refresh-2",
            tokenType: "Bearer",
            expires: new Date(NOW + 3_600_000).toISOString()
        });
        expect(await oauth.accessToken()).toBe("access-2");
    });

    it("refreshes once when several requests notice the expiry together", async () => {
        const { oauth, storage, requests } = createOAuth(() => granted("access-2"), { token: expired });
        const tokens = await Promise.all([oauth.accessToken(), oauth.accessToken(), oauth.refresh("access-1")]);
        expect(tokens).toEqual(["access-2", "access-2", expect.objectContaining({ accessToken: "access-2" })]);
        expect(requests.map((request) => request.body.get("grant_type"))).toEqual(["refresh_token"]);
        expect(requests[0]?.body.get("refresh_token")).toBe("refresh-1");
        // Inoreader did not rotate the refresh token: it is kept.
        expect(stored(storage)).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-1" });
        // The next rejection refreshes again.
        await oauth.refresh("access-2");
        expect(requests).toHaveLength(2);
    });

    it("reuses a token another tab already refreshed", async () => {
        const { oauth, storage, requests } = createOAuth(() => granted("unused"), { token: expired });
        const refreshed = { ...expired, accessToken: "access-2", expires: new Date(NOW + 60_000).toISOString() };
        storage.setItem("inoreader-token", JSON.stringify(refreshed));
        expect(await oauth.refresh("access-1")).toEqual(refreshed);
        expect(requests).toEqual([]);
    });

    it("keeps the token of another tab when the refresh token was rotated meanwhile", async () => {
        const rotated = {
            accessToken: "access-2",
            refreshToken: "refresh-2",
            tokenType: "Bearer",
            expires: new Date(NOW + 3_600_000).toISOString()
        };
        const { oauth, storage } = createOAuth(
            (_request, tokens) => {
                tokens.setItem("inoreader-token", JSON.stringify(rotated));
                return Response.json({ error: "invalid_grant" }, { status: 400 });
            },
            { token: expired }
        );
        expect(await oauth.refresh("access-1")).toEqual(rotated);
        expect(stored(storage)).toEqual(rotated);
    });

    it("disconnects when the grant is rejected", async () => {
        const { oauth, storage } = createOAuth(() => Response.json({ error: "invalid_grant" }, { status: 401 }), {
            token: expired
        });
        const rejected = oauth.accessToken();
        await expect(rejected).rejects.toBeInstanceOf(InoreaderAuthError);
        await expect(rejected).rejects.toThrow("Inoreader authorization failed (HTTP 401). Connect again.");
        expect(storage.getItem("inoreader-token")).toBeNull();
        await expect(oauth.accessToken()).rejects.toThrow("Inoreader is not connected.");
    });

    it("keeps the session when the token endpoint is unavailable or unreachable", async () => {
        const unavailable = createOAuth(() => new Response("Bad Gateway", { status: 502 }), { token: expired });
        await expect(unavailable.oauth.refresh("access-1")).rejects.toThrow(
            "Inoreader is unavailable (HTTP 502). Try again later."
        );
        expect(stored(unavailable.storage)).toEqual(expired);
        const offline = createOAuth(
            () => {
                throw new TypeError("fetch failed");
            },
            { token: expired }
        );
        await expect(offline.oauth.refresh("access-1")).rejects.toThrow(
            "Could not reach Inoreader. Check your connection."
        );
        expect(stored(offline.storage)).toEqual(expired);
    });

    it("needs a refresh token to refresh", async () => {
        const { oauth, requests } = createOAuth(() => granted("unused"), {
            token: { ...expired, refreshToken: undefined }
        });
        await expect(oauth.accessToken()).rejects.toThrow("Inoreader session expired. Connect again.");
        expect(requests).toEqual([]);
    });

    it("rejects a response without an access token", async () => {
        const { oauth, storage } = createOAuth(() => Response.json({ token_type: "Bearer" }), { token: expired });
        const invalid = oauth.refresh("access-1");
        await expect(invalid).rejects.toBeInstanceOf(InoreaderAuthError);
        await expect(invalid).rejects.toThrow("Inoreader returned an invalid token.");
        expect(stored(storage)).toEqual(expired);
    });
});
