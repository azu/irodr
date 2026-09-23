// irodr-local: serves irodr on http://127.0.0.1 with the local API (docs/local-server.md).
//
// Usage: irodr-local [--port 18888] [--dist dist] [--translator path/to/irodr-translate]
// As a single executable (`vp pack`), the app and the macOS translation helper are embedded.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAsset, getAssetKeys, isSea } from "node:sea";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { directoryAssets, EMBEDDED_TRANSLATOR, embeddedAssets, extractExecutable } from "./assets.ts";
import { createLocalServerHandler } from "./handler.ts";
import { createTranslatorProcess } from "./translator-process.ts";

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
    translator,
    fetch
});

function toRequest(incoming: IncomingMessage): Request {
    const headers = new Headers(
        Object.entries(incoming.headers).flatMap(([name, value]) =>
            value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value] as [string, string]]
        )
    );
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    return new Request(`http://${incoming.headers.host ?? ""}${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers,
        body: hasBody ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : undefined,
        // Required by Node's fetch for a streamed body.
        ...(hasBody ? { duplex: "half" } : {})
    });
}

async function writeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
        outgoing.end();
        return;
    }
    for await (const chunk of response.body) outgoing.write(chunk);
    outgoing.end();
}

const server = createServer((incoming, outgoing) => {
    const respond = async () => {
        // A missing or malformed Host header cannot be ours.
        const request = (() => {
            try {
                return toRequest(incoming);
            } catch {
                return undefined;
            }
        })();
        await writeResponse(outgoing, request ? await handler(request) : new Response("Bad Request", { status: 400 }));
    };
    respond().catch((error: unknown) => {
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
