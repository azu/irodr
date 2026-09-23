// irodr-local: serves irodr on http://127.0.0.1 with the local API (docs/local-server.md).
//
// Usage: irodr-local [--port 18888] [--dist dist] [--translator path/to/irodr-translate]
// As a single executable (`vp pack`), the app and the macOS translation helper are embedded.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { getAsset, getAssetKeys, isSea } from "node:sea";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { directoryAssets, EMBEDDED_TRANSLATOR, embeddedAssets, extractExecutable } from "./assets.ts";
import { createLocalServerHandler } from "./handler.ts";
import { createTranslatorProcess } from "./translator-process.ts";
import { createCachedTranslator } from "./cached-translator.ts";

const VERSION = "0.1.0";
const HOST = "127.0.0.1";

const { values } = parseArgs({
    options: {
        port: { type: "string", default: "18888" },
        dist: { type: "string" },
        translator: { type: "string" }
    }
});
const port = Number(values.port);
const sea = isSea();
const assetKeys = sea ? getAssetKeys() : [];

const assets = sea && !values.dist ? embeddedAssets(assetKeys, getAsset) : directoryAssets(values.dist ?? "dist");

/** `--translator` wins; otherwise the helper embedded in the executable, if any. */
function translatorCommand(): { command: string; args: string[] } | undefined {
    const path = values.translator;
    // Scripts such as server/fake-translator.ts run with this Node.
    if (path)
        return /\.[cm]?[jt]s$/.test(path) ? { command: process.execPath, args: [path] } : { command: path, args: [] };
    if (assetKeys.includes(EMBEDDED_TRANSLATOR)) {
        return { command: extractExecutable(EMBEDDED_TRANSLATOR, getAsset(EMBEDDED_TRANSLATOR)), args: [] };
    }
    return undefined;
}

const helper = translatorCommand();
const translator = helper ? createTranslatorProcess(helper.command, helper.args) : undefined;

const handler = createLocalServerHandler({
    origins: [`http://${HOST}:${port}`, `http://localhost:${port}`],
    version: VERSION,
    assets,
    translator: translator ? createCachedTranslator(translator) : undefined,
    fetch
});

function toRequest(incoming: IncomingMessage, signal: AbortSignal): Request {
    const headers = new Headers(
        Object.entries(incoming.headers).flatMap(([name, value]) =>
            value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value] as [string, string]]
        )
    );
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    return new Request(`http://${incoming.headers.host ?? ""}${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers,
        signal,
        body: hasBody ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : undefined,
        // Required by Node's fetch for a streamed body.
        ...(hasBody ? { duplex: "half" } : {})
    });
}

async function writeResponse(outgoing: ServerResponse, response: Response, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.flushHeaders();
    if (!response.body) {
        outgoing.end();
        return;
    }
    for await (const chunk of response.body) {
        signal.throwIfAborted();
        if (!outgoing.write(chunk)) await once(outgoing, "drain", { signal });
    }
    outgoing.end();
}

const server = createServer((incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.on("close", () => abort.abort());
    const respond = async () => {
        // A missing or malformed Host header cannot be ours.
        const request = (() => {
            try {
                return toRequest(incoming, abort.signal);
            } catch {
                return undefined;
            }
        })();
        await writeResponse(
            outgoing,
            request ? await handler(request) : new Response("Bad Request", { status: 400 }),
            abort.signal
        );
    };
    respond().catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.error(error);
        if (!outgoing.headersSent) outgoing.writeHead(500);
        outgoing.end();
    });
});

server.listen(port, HOST, () => {
    console.info(`irodr-local ${VERSION}: http://${HOST}:${port}/`);
    console.info(helper ? `Translation: ${helper.command}` : "Translation: unavailable (no translation helper)");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        translator?.close();
        server.close(() => process.exit(0));
        server.closeAllConnections();
    });
}
