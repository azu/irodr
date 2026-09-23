// A stand-in for swift/irodr-translate speaking the same line protocol, for tests and development
// on machines without Apple's Translation framework. Usage: node server/fake-translator.ts
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line) as { id: number; texts: string[]; targetLanguage: string };
    const response = request.texts.some((text) => text === "fail")
        ? { id: request.id, error: "language package is not installed" }
        : { id: request.id, texts: request.texts.map((text) => `[${request.targetLanguage}] ${text}`) };
    process.stdout.write(`${JSON.stringify(response)}\n`);
});
