// Usage: node e2e/fake-api/main.ts [--port 4010]
import { parseArgs } from "node:util";
import { startFakeApi } from "./server.ts";

const { values } = parseArgs({ options: { port: { type: "string", default: "4010" }, host: { type: "string" } } });
const server = await startFakeApi({ port: Number(values.port), host: values.host ?? "127.0.0.1" });
console.info(`Fake Inoreader: ${server.origin}/inoreader`);
console.info(`Fake GitHub API: ${server.origin}/github`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        server.close().then(
            () => process.exit(0),
            () => process.exit(1)
        );
    });
}
