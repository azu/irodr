import { chunkBySize } from "../lib/batch.ts";

export interface PositionedText<T> {
    readonly value: T;
    readonly top: number;
    readonly bottom: number;
    readonly size: number;
}

/** Visible text first, then at most one screen ahead. Far-away text waits until the reader scrolls. */
export function planTranslationBatch<T>(
    texts: readonly PositionedText<T>[],
    view: { readonly top: number; readonly bottom: number },
    limit: number
): T[] {
    const displayed = texts.filter((text) => text.bottom > text.top);
    const visible = displayed.filter((text) => text.bottom > view.top && text.top < view.bottom);
    const ahead = displayed.filter(
        (text) => text.top >= view.bottom && text.top < view.bottom + (view.bottom - view.top)
    );
    const candidates = visible.length > 0 ? visible : ahead;
    return (chunkBySize(candidates, (text) => text.size, limit)[0] ?? []).map((text) => text.value);
}
