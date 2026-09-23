// A stand-in for swift/irodr-translate speaking the same line protocol, for tests and development
// on machines without Apple's Translation framework. Usage: node server/fake-translator.ts
import { createInterface } from "node:readline";
import { fakeSegmentTranslation, fakeTranslation } from "../e2e/fake-api/local.ts";
import type { TranslationSegment } from "../src/lib/translation-segment.ts";

interface Request {
    id: number;
    texts?: string[];
    segments?: TranslationSegment[];
    targetLanguage: string;
}

createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, texts, segments, targetLanguage } = JSON.parse(line) as Request;
    const response = texts?.includes("fail")
        ? { id, error: "language package is not installed" }
        : segments
          ? { id, segments: segments.map((segment) => fakeSegmentTranslation(segment, targetLanguage)) }
          : { id, texts: (texts ?? []).map((text) => fakeTranslation(text, targetLanguage)) };
    process.stdout.write(`${JSON.stringify(response)}\n`);
});
