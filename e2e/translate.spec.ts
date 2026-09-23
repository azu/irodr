import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import { closeDialog, connectInoreader, expect, focusedArticle, headerMessage, requests, test } from "./fixtures.ts";

test.beforeEach(async ({ api, page }) => {
    await api.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } });
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
