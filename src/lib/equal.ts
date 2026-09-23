/** Whether two objects have the same own keys with identical values. */
export function shallowEqual<T extends object>(a: T | undefined, b: T | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = Object.keys(a) as (keyof T)[];
    return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}
