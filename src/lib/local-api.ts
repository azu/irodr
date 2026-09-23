/**
 * The optional local server (irodr-local, see docs/local-server.md). It serves irodr from
 * http://127.0.0.1 and adds features a browser cannot provide, such as on-device translation.
 * On any other host these endpoints are missing and every feature reports unavailable.
 */
export interface LocalApiInfo {
    readonly name: string;
    readonly version: string;
    readonly features: ReadonlySet<string>;
}

export interface LocalApi {
    /** The server's info, or undefined when there is no local server. Detected once and cached. */
    info: () => Promise<LocalApiInfo | undefined>;
    translate: (texts: readonly string[], sourceLanguage: string, targetLanguage: string) => Promise<string[]>;
}

export interface LocalApiOptions {
    /** "" for the page's own origin, as served by irodr-local. */
    baseUrl: string;
    fetch: typeof fetch;
}

export const LOCAL_SERVER_NAME = "irodr-local";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Narrows a `GET /api/local` body. Anything else, e.g. a static host's HTML 404 page, is no server. */
export function parseLocalApiInfo(body: unknown): LocalApiInfo | undefined {
    if (!isRecord(body) || body.name !== LOCAL_SERVER_NAME || !Array.isArray(body.features)) return undefined;
    return {
        name: body.name,
        version: typeof body.version === "string" ? body.version : "",
        features: new Set(body.features.filter((feature): feature is string => typeof feature === "string"))
    };
}

async function errorMessage(response: Response): Promise<string> {
    const body: unknown = await response.json().catch(() => undefined);
    return isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Local server responded ${response.status} ${response.statusText}`.trim();
}

export function createLocalApi({ baseUrl, fetch }: LocalApiOptions): LocalApi {
    const detected: { info: Promise<LocalApiInfo | undefined> | undefined } = { info: undefined };

    const detect = async (): Promise<LocalApiInfo | undefined> => {
        try {
            const response = await fetch(`${baseUrl}/api/local`, { headers: { Accept: "application/json" } });
            if (!response.ok) return undefined;
            return parseLocalApiInfo(await response.json());
        } catch {
            return undefined;
        }
    };

    const info = (): Promise<LocalApiInfo | undefined> => (detected.info ??= detect());

    const translate = async (
        texts: readonly string[],
        sourceLanguage: string,
        targetLanguage: string
    ): Promise<string[]> => {
        const response = await fetch(`${baseUrl}/api/translate`, {
            method: "POST",
            // JSON makes cross-site requests preflighted, which the local server rejects.
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ texts, sourceLanguage, targetLanguage })
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        const body: unknown = await response.json();
        if (
            !isRecord(body) ||
            !Array.isArray(body.texts) ||
            body.texts.length !== texts.length ||
            !body.texts.every((text) => typeof text === "string")
        ) {
            throw new Error("Local server returned an unexpected translation");
        }
        return body.texts;
    };

    return { info, translate };
}
