// Browser Translator API (Chrome 138+): https://developer.chrome.com/docs/ai/translator-api
interface TranslatorInstance {
    translate(input: string): Promise<string>;
    destroy(): void;
}

interface TranslatorLanguages {
    sourceLanguage: string;
    targetLanguage: string;
}

declare const Translator:
    | {
          availability(
              options: TranslatorLanguages
          ): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
          create(options: TranslatorLanguages): Promise<TranslatorInstance>;
      }
    | undefined;

interface Window {
    /** The earlier experimental API (Chrome 131). */
    translation?: {
        canTranslate(options: TranslatorLanguages): Promise<"no" | "readily" | "after-download">;
        createTranslator(options: TranslatorLanguages): Promise<TranslatorInstance>;
    };
    /** Provided by a user script, e.g. with GM_xmlhttpRequest to bypass CORS. */
    irodrTranslator?: {
        translateBatch(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
    };
}
