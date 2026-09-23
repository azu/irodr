import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import {
    articles,
    closeDialog,
    connectInoreader,
    currentFeed,
    expect,
    feedRow,
    focusedArticle,
    headerMessage,
    requests,
    test
} from "./fixtures.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
const BETA = "feed/https://beta.example.com/rss";
const GAMMA = "feed/https://gamma.example.com/rss";

test.beforeEach(async ({ api, page }) => {
    await api.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } });
    await connectInoreader(page);
    await closeDialog(page);
});

async function unreadOnServer(api: import("./fixtures.ts").FakeApi): Promise<Record<string, number>> {
    return api.control<Record<string, number>>("GET", "/inoreader/unread");
}

test("connects with OAuth and lists unread feeds by category", async ({ page }) => {
    const categories = page.getByRole("navigation", { name: "Subscriptions" }).getByRole("button", { expanded: true });
    await expect(categories).toHaveText(["Blogs", "News", "Tech"]);
    await expect(feedRow(page, "Alpha Blog")).toHaveText("Alpha Blog (3)");
    await expect(feedRow(page, "Gamma News")).toHaveText("Gamma News (5)");
    // Fully read feeds are hidden, like LDR.
    await expect(feedRow(page, "Already Read")).toHaveCount(0);
    await expect(page.getByTestId("total-unread")).toHaveText("Unread: 10");
    await expect(page.getByTestId("total-feeds")).toHaveText("Subscriptions: 5");
    await expect(headerMessage(page)).toHaveText("Updated feeds");
});

test("keeps the session after reload", async ({ page }) => {
    await page.reload();
    await expect(feedRow(page, "Alpha Blog")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("s opens the next feed and j/k move between items", async ({ page }) => {
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    await expect(articles(page)).toHaveCount(3);
    await expect(page.getByTestId("feed-unread-count")).toHaveText("(3)");

    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 2");
    await page.keyboard.press("k");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 3");
    await page.keyboard.press("j");
    await expect(headerMessage(page)).toHaveText("End of contents");
});

test("leaving a feed marks it read through the newest loaded item", async ({ page, api }) => {
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    // Arrives after the feed was loaded: must stay unread.
    await api.control("POST", "/inoreader/items", {
        streamId: ALPHA,
        items: [{ id: "alpha-late", title: "alpha late article", published: Math.floor(Date.now() / 1000) }]
    });
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    await expect.poll(async () => (await unreadOnServer(api))[ALPHA]).toBe(1);
    const markRead = requests(await api.log(), "inoreader", "/reader/api/0/mark-all-as-read");
    expect(markRead.map((entry) => entry.query.s)).toEqual([ALPHA]);
    // The read feed stays in place (dimmed) while it is in the recent history.
    await expect(feedRow(page, "Alpha Blog")).toHaveText("Alpha Blog (0)");
    await expect(page.getByTestId("total-unread")).toHaveText("Unread: 7");
});

test("a returns to the previous feed with its items already loaded", async ({ page, api }) => {
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    const before = requests(await api.log(), "inoreader", `/reader/api/0/stream/contents/${encodeURIComponent(ALPHA)}`);

    await page.keyboard.press("a");
    await expect(currentFeed(page)).toHaveText("Alpha Blog (0)");
    await expect(articles(page)).toHaveCount(3);
    const after = requests(await api.log(), "inoreader", `/reader/api/0/stream/contents/${encodeURIComponent(ALPHA)}`);
    expect(after).toHaveLength(before.length);
    // Leaving Beta with `a` marks it read too.
    await expect.poll(async () => (await unreadOnServer(api))[BETA]).toBe(0);
});

test("Shift+S skips a feed without marking it read", async ({ page, api }) => {
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("Shift+S");
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Gamma News (5)");
    await expect.poll(async () => (await unreadOnServer(api))[BETA]).toBe(0);
    expect((await unreadOnServer(api))[ALPHA]).toBe(3);
    expect(
        requests(await api.log(), "inoreader", "/reader/api/0/mark-all-as-read").map((entry) => entry.query.s)
    ).toEqual([BETA]);
});

test("m marks the current feed read without moving", async ({ page, api }) => {
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("m");
    await expect.poll(async () => (await unreadOnServer(api))[ALPHA]).toBe(0);
    await expect(currentFeed(page)).toHaveText("Alpha Blog (0)");
    await expect(articles(page)).toHaveCount(3);
});

test("t toggles unread and all items; Shift+J loads older items", async ({ page, api }) => {
    await feedRow(page, "Gamma News").click();
    await expect(currentFeed(page)).toHaveText("Gamma News (5)");
    await expect(articles(page)).toHaveCount(5);
    await expect(page.getByTestId("feed-unread-count")).toHaveText("(5 + 15)");
    const toggle = page.getByRole("checkbox", { name: "Show only unread contents" });
    await expect(toggle).toBeChecked();

    await page.keyboard.press("t");
    await expect(articles(page)).toHaveCount(20);
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press("t");
    await expect(articles(page)).toHaveCount(5);

    await page.keyboard.press("Shift+J");
    await expect(articles(page)).toHaveCount(25);
    const pages = requests(await api.log(), "inoreader", `/reader/api/0/stream/contents/${encodeURIComponent(GAMMA)}`);
    expect(pages.map((entry) => entry.query.c)).toEqual([undefined, "20"]);
    await expect(page.getByRole("button", { name: "Read More" })).toBeVisible();
});

test("v opens the focused item in a new tab", async ({ page, context }) => {
    await context.route("https://alpha.example.com/**", (route) => route.fulfill({ body: "alpha" }));
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    const [popup] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("v")]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://alpha.example.com/articles/1");
});

test("z collapses and expands every category", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Subscriptions" });
    await page.keyboard.press("z");
    await expect(nav.getByRole("button", { expanded: false })).toHaveCount(3);
    await expect(feedRow(page, "Alpha Blog")).toHaveCount(0);
    // Navigation still works through collapsed categories.
    await page.keyboard.press("s");
    await expect(page.getByRole("feed", { name: "Alpha Blog" })).toBeVisible();
    await page.keyboard.press("z");
    await expect(nav.getByRole("button", { expanded: true })).toHaveCount(3);
});

test("space and Shift+Space scroll the article view", async ({ page }) => {
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    const view = page.getByTestId("article-view");
    await page.keyboard.press("Space");
    await expect.poll(() => view.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const scrolled = await view.evaluate((element) => element.scrollTop);
    await page.keyboard.press("Shift+Space");
    await expect.poll(() => view.evaluate((element) => element.scrollTop)).toBeLessThan(scrolled);
});

test("prefetches the following feeds so they open instantly", async ({ page, api }) => {
    await page.keyboard.press("s");
    await expect(headerMessage(page)).toHaveText("Complete prefetch 5 items");
    const streams = requests(await api.log(), "inoreader", /^\/reader\/api\/0\/stream\/contents\//).map((entry) =>
        decodeURIComponent(entry.path.split("/").at(-1) ?? "")
    );
    expect(streams).toEqual([ALPHA, BETA, GAMMA, "feed/https://delta.example.com/rss"]);
    const count = streams.length;
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    await expect(articles(page)).toHaveCount(1);
    expect(requests(await api.log(), "inoreader", /^\/reader\/api\/0\/stream\/contents\//)).toHaveLength(count);
});

test("skips a feed whose items cannot be loaded", async ({ page, api }) => {
    await api.control("POST", "/inoreader/config", { failingStreams: [BETA] });
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Gamma News (5)");
    await expect.poll(async () => (await unreadOnServer(api))[ALPHA]).toBe(0);
    expect((await unreadOnServer(api))[BETA]).toBe(1);
});

test("keeps a feed unread when marking it read fails", async ({ page, api }) => {
    await api.control("POST", "/inoreader/config", { failingMarkRead: [ALPHA] });
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    // Errors are not replaced by routine messages such as prefetch completion.
    await expect(headerMessage(page)).toContainText("Could not mark Alpha Blog as read");
    await expect(feedRow(page, "Alpha Blog")).toHaveText("Alpha Blog (3)");
    expect((await unreadOnServer(api))[ALPHA]).toBe(3);
});

test("refreshes an expired access token", async ({ page, api }) => {
    await api.control("POST", "/inoreader/expire-tokens");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(headerMessage(page)).toHaveText("Updated feeds");
    const tokenRequests = requests(await api.log(), "inoreader", "/oauth2/token");
    expect(tokenRequests.map((entry) => new URLSearchParams(entry.body).get("grant_type"))).toEqual([
        "authorization_code",
        "refresh_token"
    ]);
    await expect(feedRow(page, "Alpha Blog")).toBeVisible();
});

test("sanitizes article HTML", async ({ page, api }) => {
    await api.control("POST", "/inoreader/items", {
        streamId: "feed/https://delta.example.com/rss",
        items: [
            {
                id: "evil",
                title: "Evil &amp; tricky",
                published: Math.floor(Date.now() / 1000),
                content:
                    '<p>Safe text</p><script>window.xssProbe = 1</script><img src="/favicon.png" onerror="window.xssProbe = 2"><a href="javascript:window.xssProbe = 3">bad link</a><iframe src="https://evil.example/"></iframe><a href="https://ok.example/">good link</a>'
            }
        ]
    });
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(feedRow(page, "Delta Tech")).toHaveText("Delta Tech (2)");
    await feedRow(page, "Delta Tech").click();
    const article = articles(page).first();
    await expect(article).toContainText("Evil & tricky");
    const body = article.locator(".SubscriptionContentsContainer-contentBody");
    await expect(body).toContainText("Safe text");
    await expect(body.locator("script, iframe")).toHaveCount(0);
    await expect(body.locator("img")).not.toHaveAttribute("onerror", /.*/);
    await expect(body.getByText("bad link")).not.toHaveAttribute("href", /.*/);
    await expect(body.getByText("good link")).toHaveAttribute("href", "https://ok.example/");
    expect(await page.evaluate(() => (window as Window & { xssProbe?: number }).xssProbe)).toBeUndefined();
});
