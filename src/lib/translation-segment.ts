/**
 * A paragraph to translate as one sentence, with its inline markup (links, emphasis, code) as tagged runs.
 * The translator keeps each tag on the words it belongs to, wherever the word order moves them, so the
 * page can rebuild the markup around the translated words. Used by the local API (docs/local-server.md).
 */
export interface TranslationRun {
    readonly text: string;
    /** Identifies the inline element around this text, chosen by the page. */
    readonly tag?: number;
    /** Keep the text as is, e.g. code. */
    readonly skip?: boolean;
}

export interface TranslationSegment {
    readonly runs: readonly TranslationRun[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function parseRun(value: unknown): TranslationRun | undefined {
    if (!isRecord(value) || typeof value.text !== "string") return undefined;
    if (value.tag !== undefined && !Number.isInteger(value.tag)) return undefined;
    if (value.skip !== undefined && typeof value.skip !== "boolean") return undefined;
    return {
        text: value.text,
        ...(typeof value.tag === "number" ? { tag: value.tag } : {}),
        ...(value.skip === true ? { skip: true } : {})
    };
}

/** Narrows untrusted JSON to segments, or undefined when anything does not fit. */
export function parseSegments(value: unknown): TranslationSegment[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const segments = value.map((segment): TranslationSegment | undefined => {
        if (!isRecord(segment) || !Array.isArray(segment.runs)) return undefined;
        const runs = segment.runs.map(parseRun);
        return runs.every((run) => run !== undefined) ? { runs } : undefined;
    });
    return segments.every((segment) => segment !== undefined) ? segments : undefined;
}

export const segmentText = (segment: TranslationSegment): string => segment.runs.map((run) => run.text).join("");

const sameMarkup = (a: TranslationRun, b: TranslationRun) => a.tag === b.tag && a.skip === b.skip;

/** Joins neighboring runs with the same tag, which a translator may return split. */
export function mergeRuns(runs: readonly TranslationRun[]): TranslationRun[] {
    return runs.flatMap((run, index) => {
        const previous = runs[index - 1];
        // Already joined into the first run of its group.
        if (previous && sameMarkup(previous, run)) return [];
        const following = runs.slice(index + 1);
        const end = following.findIndex((next) => !sameMarkup(next, run));
        const group = end === -1 ? following : following.slice(0, end);
        return [{ ...run, text: [run, ...group].map((member) => member.text).join("") }];
    });
}
