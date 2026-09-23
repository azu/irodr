/** The first item for each key, in their original order. */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
    // A local, per-call set: O(n) for the thousands of feeds a sidebar can list.
    const seen = new Set<string>();
    return items.filter((item) => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}
