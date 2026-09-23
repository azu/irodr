/**
 * Build-time settings (`.env*`, `VITE_*`) with the localStorage overrides that
 * irodr 1.x user scripts rely on (see resources/userScript/irodr-cors.js).
 */
export interface AppConfig {
    inoreader: {
        baseUrl: string;
        corsProxy: string;
        clientId: string;
        clientSecret: string;
    };
    github: {
        apiBaseUrl: string;
        webBaseUrl: string;
    };
    /** The irodr-local server (docs/local-server.md). "" is the page's own origin. */
    localApi: {
        baseUrl: string;
    };
    redirectUri: string;
}

type Env = Partial<Record<string, string | boolean | undefined>>;

function read(storage: Pick<Storage, "getItem">, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");

export function loadConfig(env: Env, storage: Pick<Storage, "getItem">, origin: string): AppConfig {
    const value = (key: string, fallback = "") => {
        const raw = env[key];
        return typeof raw === "string" ? raw : fallback;
    };
    return {
        inoreader: {
            baseUrl: trimSlash(
                read(storage, "REACT_APP_INOREADER_BASE_URL") ??
                    value("VITE_INOREADER_BASE_URL", "https://www.inoreader.com")
            ),
            // An empty string disables the proxy, e.g. with irodr-cors.js.
            corsProxy: read(storage, "REACT_APP_CORS_PROXY") ?? value("VITE_CORS_PROXY"),
            clientId: value("VITE_INOREADER_CLIENT_ID"),
            clientSecret: value("VITE_INOREADER_CLIENT_SECRET")
        },
        github: {
            apiBaseUrl: trimSlash(value("VITE_GITHUB_API_BASE_URL", "https://api.github.com")),
            webBaseUrl: trimSlash(value("VITE_GITHUB_WEB_BASE_URL", "https://github.com"))
        },
        localApi: { baseUrl: trimSlash(value("VITE_LOCAL_API_BASE_URL")) },
        redirectUri: value("VITE_OAUTH_REDIRECT_URI") || `${origin}/`
    };
}
