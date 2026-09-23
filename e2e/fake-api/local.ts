import { parseSegments, type TranslationSegment } from "../../src/lib/translation-segment.ts";
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
    /** false: translate texts only, like a helper without formatted translation. Default true. */
    segments?: boolean;
}

export interface FakeLocalServer {
    reset: (scenario?: LocalScenario) => void;
    handle: (request: FakeRequest, path: string) => FakeResponse;
}

export const fakeTranslation = (text: string, targetLanguage: string) => `[${targetLanguage}] ${text}`;

/**
 * Tags the segment and reverses its runs, as word order changes between languages do: the page must
 * rebuild markup from the tags, not from positions.
 */
export const fakeSegmentTranslation = (segment: TranslationSegment, targetLanguage: string): TranslationSegment => ({
    runs: [{ text: `[${targetLanguage}] ` }, ...segment.runs.toReversed()]
});

export function createFakeLocalServer(): FakeLocalServer {
    const state: { scenario: Required<LocalScenario> } = {
        scenario: { enabled: true, translateError: "", segments: true }
    };

    const reset = (scenario: LocalScenario = {}) => {
        state.scenario = {
            enabled: scenario.enabled ?? true,
            translateError: scenario.translateError ?? "",
            segments: scenario.segments ?? true
        };
    };

    const translate = (request: FakeRequest): FakeResponse => {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
            return json({ error: "Content-Type must be application/json" }, 415);
        }
        const body: unknown = JSON.parse(request.body || "null");
        const { texts, segments, sourceLanguage, targetLanguage } = (body ?? {}) as Record<string, unknown>;
        const parsedSegments = segments === undefined ? undefined : parseSegments(segments);
        const validTexts = Array.isArray(texts) && texts.every((text) => typeof text === "string");
        if (
            (!validTexts && !parsedSegments) ||
            typeof sourceLanguage !== "string" ||
            typeof targetLanguage !== "string"
        ) {
            return json({ error: "Expected { texts or segments, sourceLanguage, targetLanguage }" }, 400);
        }
        if (state.scenario.translateError) return json({ error: state.scenario.translateError }, 422);
        return parsedSegments
            ? json({ segments: parsedSegments.map((segment) => fakeSegmentTranslation(segment, targetLanguage)) })
            : json({ texts: (texts as string[]).map((text) => fakeTranslation(text, targetLanguage)) });
    };

    const handle = (request: FakeRequest, path: string): FakeResponse => {
        if (!state.scenario.enabled) return json({ error: "not found" }, 404);
        switch (`${request.method} ${path}`) {
            case "GET /api/local":
                return json({
                    name: "irodr-local",
                    version: "0.0.0-fake",
                    features: ["translate", ...(state.scenario.segments ? ["translate-segments"] : [])]
                });
            case "POST /api/translate":
                return translate(request);
            default:
                return json({ error: "not found" }, 404);
        }
    };

    return { reset, handle };
}
