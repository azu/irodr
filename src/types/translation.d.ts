// Type definitions for the browser Translation API (Chrome 131+)
// https://developer.chrome.com/docs/ai/translator-api

type TranslationAvailability = "readily" | "after-download" | "no";

type TranslationLanguageOptions = {
    sourceLanguage: string;
    targetLanguage: string;
};

type AITranslator = {
    translate(text: string): Promise<string>;
    destroy(): void;
};

type Translation = {
    canTranslate(options: TranslationLanguageOptions): Promise<TranslationAvailability>;
    createTranslator(options: TranslationLanguageOptions): Promise<AITranslator>;
};

interface Window {
    translation?: Translation;
}
