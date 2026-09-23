import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import { closeDialog, connectInoreader, expect, focusedArticle, headerMessage, requests, test } from "./fixtures.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
/** 12 paragraphs of 200 characters: translated in parts of up to 1000 characters. */
const LONG_PARAGRAPHS = Array.from({ length: 12 }, (_, index) =>
    `Paragraph ${String(index + 1).padStart(2, "0")} `.padEnd(200, "x")
);

test.beforeEach(async ({ api, page }) => {
    const subscriptions = inoreaderSubscriptions().map((subscription) =>
        subscription.id === ALPHA
            ? {
                  ...subscription,
                  items: subscription.items.map((item, index) =>
                      index === 2
                          ? { ...item, content: LONG_PARAGRAPHS.map((text) => `<p>${text}</p>`).join("") }
                          : item
                  )
              }
            : subscription
    );
    await api.reset({ inoreader: { subscriptions } });
    await connectInoreader(page);
    await closeDialog(page);
    await page.keyboard.press("s");
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
});

function body(page: import("@playwright/test").Page) {
    return focusedArticle(page).locator(".SubscriptionContentsContainer-contentBody");
}

test("Shift+T translates with the local server and restores the original", async ({ page, api }) => {
    await expect(body(page)).toHaveText("Body of alpha article 1.");
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: ON");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");

    // Moving to the next article translates it too.
    // `j` focuses the first article again while the list is scrolled to the top.
    await expect(async () => {
        await page.keyboard.press("j");
        await expect(focusedArticle(page)).toContainText("alpha article 2", { timeout: 500 });
    }).toPass();
    await expect(body(page)).toHaveText("[ja] Body of alpha article 2.");

    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await expect(body(page)).toHaveText("Body of alpha article 2.");

    const translations = requests(await api.log(), "local", "/api/translate");
    expect(translations.map((entry) => JSON.parse(entry.body))).toEqual([
        { texts: ["Body of alpha article 1."], sourceLanguage: "en", targetLanguage: "ja" },
        { texts: ["Body of alpha article 2."], sourceLanguage: "en", targetLanguage: "ja" }
    ]);
});

test("shows the local server's error", async ({ page, api }) => {
    await api.control("POST", "/local/config", { translateError: "language package is not installed: en -> ja" });
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("language package is not installed: en -> ja");
    await expect(body(page)).toHaveText("Body of alpha article 1.");
});

test("translates a long article in parts", async ({ page, api }) => {
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    await expect(async () => {
        await page.keyboard.press("j");
        await expect(focusedArticle(page)).toContainText("alpha article 3", { timeout: 500 });
    }).toPass();
    await expect(body(page).locator("p")).toHaveText(LONG_PARAGRAPHS.map((text) => `[ja] ${text}`));

    const parts = requests(await api.log(), "local", "/api/translate")
        .map((entry) => JSON.parse(entry.body) as { texts: string[] })
        .filter((part) => part.texts.some((text) => text.startsWith("Paragraph")));
    expect(parts.map((part) => part.texts.length)).toEqual([5, 5, 2]);
});
