/**
 * Groups items in order so each group's total size stays within `limit`. An item larger than the limit
 * gets a group of its own.
 */
export function chunkBySize<T>(items: readonly T[], size: (item: T) => number, limit: number): T[][] {
    return items.reduce<{ groups: T[][]; total: number }>(
        ({ groups, total }, item) => {
            const itemSize = size(item);
            const last = groups.at(-1);
            return last && total + itemSize <= limit
                ? { groups: [...groups.slice(0, -1), [...last, item]], total: total + itemSize }
                : { groups: [...groups, [item]], total: itemSize };
        },
        { groups: [], total: 0 }
    ).groups;
}
