/**
 * Built-ins newer than ES2022. Browsers that otherwise run Irodr (Safari 15.4) lack them, and `build.target` lowers
 * syntax only, without polyfills.
 */
const NEWER_BUILT_INS: readonly (readonly [target: object, name: string])[] = [
    // ES2023
    ...["findLast", "findLastIndex", "toReversed", "toSorted", "toSpliced", "with"].map(
        (name) => [Array.prototype, name] as const
    ),
    // ES2024
    [Map, "groupBy"],
    [Object, "groupBy"],
    [Promise, "withResolvers"],
    [String.prototype, "isWellFormed"],
    [String.prototype, "toWellFormed"]
];

/**
 * For tests: run `run` synchronously without the built-ins newer than ES2022, as the oldest supported browsers do.
 * Call only the code under test inside `run`; the test runner may use these built-ins.
 */
export function withoutNewerBuiltIns<T>(run: () => T): T {
    const removed = NEWER_BUILT_INS.flatMap(([target, name]) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        return descriptor ? [{ target, name, descriptor }] : [];
    });
    removed.forEach(({ target, name }) => Reflect.deleteProperty(target, name));
    try {
        return run();
    } finally {
        removed.forEach(({ target, name, descriptor }) => Object.defineProperty(target, name, descriptor));
    }
}
