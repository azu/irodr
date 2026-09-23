import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, relative, sep } from "node:path";
import type { Asset, Assets } from "./handler.ts";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8"
};

export const contentType = (path: string): string =>
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/** Prefix of the built app's files among the executable's embedded assets. */
export const EMBEDDED_DIST = "dist/";
/** The embedded translation helper (macOS only). */
export const EMBEDDED_TRANSLATOR = "irodr-translate";

function listFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [path] : [];
    });
}

/** Files under `directory` as "/relative/path" → file path. Used for the executable's asset table too. */
export function assetPaths(directory: string): ReadonlyMap<string, string> {
    return new Map(listFiles(directory).map((path) => [`/${relative(directory, path).split(sep).join("/")}`, path]));
}

const toAsset = (path: string, body: Uint8Array<ArrayBuffer>): Asset => ({ body, contentType: contentType(path) });

/** Serves a built app from disk, read once at startup. */
export function directoryAssets(directory: string): Assets {
    const files = new Map(
        [...assetPaths(directory)].map(([path, file]) => [path, toAsset(path, new Uint8Array(readFileSync(file)))])
    );
    return { get: (path) => files.get(path) };
}

/** Serves the app embedded in a single executable, from `node:sea` assets named "dist/…". */
export function embeddedAssets(keys: readonly string[], getAsset: (key: string) => ArrayBuffer): Assets {
    const files = new Map(
        keys
            .filter((key) => key.startsWith(EMBEDDED_DIST))
            .map((key) => {
                const path = `/${key.slice(EMBEDDED_DIST.length)}`;
                return [path, toAsset(path, new Uint8Array(getAsset(key)))];
            })
    );
    return { get: (path) => files.get(path) };
}

function cacheDirectory(): string {
    if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "irodr-local");
    return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "irodr-local");
}

/**
 * Writes an embedded executable to the cache directory once per content, since a process can only be
 * spawned from a real file. Returns its path.
 */
export function extractExecutable(name: string, content: ArrayBuffer): string {
    const bytes = new Uint8Array(content);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const directory = cacheDirectory();
    const path = join(directory, `${name}-${hash}`);
    if (existsSync(path)) return path;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o755 });
    renameSync(temporary, path);
    return path;
}
