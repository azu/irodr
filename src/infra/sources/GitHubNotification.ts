import { SourceItem } from "../../domain/Sources/SourceAdapter";

export function githubRepository(item: SourceItem): string | undefined {
    const name = item.metadata?.repository;
    if (typeof name !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(name)) return undefined;
    if (name.split("/").some((part) => part === "." || part === "..")) return undefined;
    return name;
}

export function isCoveredByRead(item: SourceItem, readThrough: ReadonlyMap<string, number>): boolean {
    const repository = githubRepository(item);
    const cutoff = repository ? readThrough.get(repository) : undefined;
    const updated = Date.parse(item.updatedAt || "");
    return cutoff !== undefined && Number.isFinite(updated) && updated <= cutoff;
}
