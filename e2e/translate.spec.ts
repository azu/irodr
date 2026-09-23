import { readFileSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import {
    articles,
    closeDialog,
    connectInoreader,
    expect,
    FAKE_API,
    focusedArticle,
    headerMessage,
    requests,
    test
} from "./fixtures.ts";

const USER_SCRIPT = readFileSync(new URL("../resources/userScript/irodr-translate.user.js", import.meta.url), "utf8");

const body = (article: Locator) => article.locator(".SubscriptionContentsContainer-contentBody");

interface GMRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    data: string;
}

test.beforeEach(async ({ api }) => {
    await api.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } });
});

test("translate mode uses irodr-translate.user.js without the Translator API", async ({ page, api }) => {
    // GM_xmlhttpRequest runs outside the page, so CORS does not apply. Google Translate is the fake API.
    await page.exposeFunction("__gmRequest", async ({ method, url, headers, data }: GMRequest) => {
        const target = url.replace("https://translate.googleapis.com/", `${FAKE_API}/google-translate/`);
        const response = await fetch(target, { method, headers, body: data });
        return { status: response.status, response: await response.text() };
    });
    await page.addInitScript(`(() => {
        // A browser without the Translator API, e.g. Firefox.
        Object.defineProperty(window, "Translator", { value: undefined, configurable: true });
        const GM_xmlhttpRequest = (details) => {
            window.__gmRequest({ method: details.method, url: details.url, headers: details.headers, data: details.data })
                .then((response) => details.onload(response), () => details.onerror());
        };
        ((GM_xmlhttpRequest, unsafeWindow) => {\n${USER_SCRIPT}\n})(GM_xmlhttpRequest, window);
    })();`);
    await connectInoreader(page);
    await closeDialog(page);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("j");

    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: ON");
    await expect(body(focusedArticle(page))).toHaveText("[ja] Body of alpha article 1.");
    const [request] = requests(await api.log(), "google-translate", "/translate_a/single");
    expect(request?.query).toMatchObject({ sl: "en", tl: "ja", dt: "t" });

    // Moving to the next article while translate mode is on translates it too.
    await page.keyboard.press("j");
    await expect(body(focusedArticle(page))).toHaveText("[ja] Body of alpha article 2.");

    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await expect(body(articles(page).first())).toHaveText("Body of alpha article 1.");
});
