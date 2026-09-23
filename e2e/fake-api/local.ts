import { type FakeRequest, type FakeResponse, json } from "./http.ts";

/**
 * A fake irodr-local server (docs/local-server.md). The real one translates with Apple's
 * Translation framework; this one tags each text with the target language.
 */
export interface LocalScenario {
    /** false: behave like a host without a local server (404). Default true. */
    enabled?: boolean;
    /** Error message returned by `POST /api/translate`, e.g. a missing language package. */
    translateError?: string;
}

export interface FakeLocalServer {
    reset: (scenario?: LocalScenario) => void;
    handle: (request: FakeRequest, path: string) => FakeResponse;
}

export const fakeTranslation = (text: string, targetLanguage: string) => `[${targetLanguage}] ${text}`;

export function createFakeLocalServer(): FakeLocalServer {
    const state: { scenario: Required<LocalScenario> } = { scenario: { enabled: true, translateError: "" } };

    const reset = (scenario: LocalScenario = {}) => {
        state.scenario = { enabled: scenario.enabled ?? true, translateError: scenario.translateError ?? "" };
    };

    const translate = (request: FakeRequest): FakeResponse => {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
            return json({ error: "Content-Type must be application/json" }, 415);
        }
        const body: unknown = JSON.parse(request.body || "null");
        const { texts, sourceLanguage, targetLanguage } = (body ?? {}) as Record<string, unknown>;
        if (
            !Array.isArray(texts) ||
            !texts.every((text) => typeof text === "string") ||
            typeof sourceLanguage !== "string" ||
            typeof targetLanguage !== "string"
        ) {
            return json({ error: "Expected { texts: string[], sourceLanguage, targetLanguage }" }, 400);
        }
        if (state.scenario.translateError) return json({ error: state.scenario.translateError }, 422);
        return json({ texts: texts.map((text: string) => fakeTranslation(text, targetLanguage)) });
    };

    const handle = (request: FakeRequest, path: string): FakeResponse => {
        if (!state.scenario.enabled) return json({ error: "not found" }, 404);
        switch (`${request.method} ${path}`) {
            case "GET /api/local":
                return json({ name: "irodr-local", version: "0.0.0-fake", features: ["translate"] });
            case "POST /api/translate":
                return translate(request);
            default:
                return json({ error: "not found" }, 404);
        }
    };

    return { reset, handle };
}
