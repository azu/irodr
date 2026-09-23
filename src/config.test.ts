import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./config.ts";

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });

describe("loadConfig", () => {
    const env = {
        VITE_INOREADER_BASE_URL: "https://www.inoreader.com/",
        VITE_CORS_PROXY: "/cors-proxy/",
        VITE_INOREADER_CLIENT_ID: "id",
        VITE_INOREADER_CLIENT_SECRET: "secret",
        VITE_GITHUB_API_BASE_URL: "https://api.github.com"
    };

    it("reads build settings", () => {
        expect(loadConfig(env, storage({}), "https://irodr.netlify.app")).toEqual({
            inoreader: {
                baseUrl: "https://www.inoreader.com",
                corsProxy: "/cors-proxy/",
                clientId: "id",
                clientSecret: "secret"
            },
            github: { apiBaseUrl: "https://api.github.com", webBaseUrl: "https://github.com" },
            redirectUri: "https://irodr.netlify.app/"
        });
    });

    it("honors the localStorage overrides used by irodr 1.x user scripts", () => {
        const config = loadConfig(
            env,
            storage({ REACT_APP_CORS_PROXY: "", REACT_APP_INOREADER_BASE_URL: "https://jp.inoreader.com" }),
            "https://x.test"
        );
        expect(config.inoreader.corsProxy).toBe("");
        expect(config.inoreader.baseUrl).toBe("https://jp.inoreader.com");
    });
});
