import { githubNotifications, inoreaderSubscriptions, manyInoreaderSubscriptions } from "./fake-api/fixtures.ts";
import {
    articles,
    closeDialog,
    connectGitHub,
    connectInoreader,
    currentFeed,
    expect,
    feedRow,
    focusedArticle,
    requests,
    test
} from "./fixtures.ts";

test.beforeEach(async ({ api }) => {
    await api.reset({
        inoreader: { subscriptions: inoreaderSubscriptions() },
        github: { notifications: githubNotifications() }
    });
});

test("Inoreader and GitHub feeds are read in one sequence", async ({ page, api }) => {
    await connectInoreader(page);
    await connectGitHub(page);
    await closeDialog(page);
    const nav = page.getByRole("navigation", { name: "Subscriptions" });
    await expect(nav.getByRole("button", { expanded: true })).toHaveText([
        "Blogs",
        "GitHub Notifications",
        "News",
        "Tech"
    ]);
    await expect(page.getByTestId("total-unread")).toHaveText("Unread: 14");
    await expect(page.getByTestId("total-feeds")).toHaveText("Subscriptions: 8");

    const visited: string[] = [];
    for (const _ of Array.from({ length: 7 })) {
        await page.keyboard.press("s");
        await expect(currentFeed(page)).not.toHaveText(visited.at(-1) ?? "none");
        visited.push((await currentFeed(page).textContent()) ?? "");
    }
    expect(visited).toEqual([
        "Alpha Blog (3)",
        "Beta Blog (1)",
        "acme/rocket (2)",
        "acme/tools (1)",
        "octo/docs (1)",
        "Gamma News (5)",
        "Delta Tech (1)"
    ]);
    // Every departed feed was marked read on its own service.
    await expect
        .poll(async () => requests(await api.log(), "inoreader", "/reader/api/0/mark-all-as-read").length)
        .toBe(3);
    await expect
        .poll(async () =>
            requests(await api.log(), "github", /^\/notifications\/threads\/\w+$/)
                .map((entry) => entry.path)
                .sort()
        )
        .toEqual([
            "/notifications/threads/101",
            "/notifications/threads/102",
            "/notifications/threads/201",
            "/notifications/threads/301"
        ]);
    await expect(page.getByTestId("total-unread")).toHaveText("Unread: 1");
});

test("opens Sources until a source is connected, and reports a denied login", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Sources" });
    await expect(dialog.getByTestId("source-status-inoreader")).toContainText("Not connected");
    await expect(dialog.getByTestId("source-status-github-notifications")).toContainText("Not connected");
    await dialog.getByRole("button", { name: "Connect to Inoreader" }).click();
    await page.locator("#deny").click();
    await expect(page).toHaveURL("http://127.0.0.1:4173/");
    await expect(page.getByTestId("source-status-inoreader")).toContainText(
        "Inoreader authorization was not granted (access_denied)."
    );
});

test("preferences are saved and applied", async ({ page, api }) => {
    await connectInoreader(page);
    await closeDialog(page);
    await page.getByRole("button", { name: "Preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "App Preference" });
    await dialog.getByLabel("Prefetch Subscription Count").fill("0");
    // Typing into a cleared field: the field must accept the empty state in between.
    const fetchCount = dialog.getByLabel("Fetch subscription contents Count");
    await fetchCount.fill("");
    await expect(fetchCount).toHaveValue("");
    await fetchCount.pressSequentially("2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Preferences" }).click();
    await expect(dialog.getByLabel("Prefetch Subscription Count")).toHaveValue("0");
    await closeDialog(page);

    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    await expect(articles(page)).toHaveCount(2);
    const streams = requests(await api.log(), "inoreader", /^\/reader\/api\/0\/stream\/contents\//);
    expect(streams.map((entry) => entry.query.n)).toEqual(["2"]);
});

test("carries over irodr 1.x preferences", async ({ page, api }) => {
    await connectInoreader(page);
    await closeDialog(page);
    // irodr 1.x saved preferences with localforage in IndexedDB "AppRepository".
    await page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open("AppRepository", 2);
                request.onupgradeneeded = () => request.result.createObjectStore("keyvaluepairs");
                request.onsuccess = () => {
                    const transaction = request.result.transaction("keyvaluepairs", "readwrite");
                    transaction.objectStore("keyvaluepairs").put(
                        {
                            id: "01HLEGACY",
                            user: { id: "user" },
                            preferences: {
                                prefetchSubscriptionCount: 0,
                                fetchContentsCount: 2,
                                enableAutoRefreshSubscription: false,
                                autoRefreshSubscriptionSec: 300
                            }
                        },
                        "01HLEGACY"
                    );
                    transaction.oncomplete = () => {
                        request.result.close();
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error);
                };
                request.onerror = () => reject(request.error);
            })
    );
    await page.reload();
    await page.getByRole("button", { name: "Preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "App Preference" });
    await expect(dialog.getByLabel("Fetch subscription contents Count")).toHaveValue("2");
    await expect(dialog.getByLabel("Enable Auto Refresh Subscription")).not.toBeChecked();
    await closeDialog(page);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(2);
    expect(requests(await api.log(), "inoreader", /^\/reader\/api\/0\/stream\/contents\//)).toHaveLength(1);
});

test("auto refresh picks up new unread items", async ({ page, api }) => {
    await connectInoreader(page);
    await closeDialog(page);
    await page.getByRole("button", { name: "Preferences" }).click();
    await page.getByLabel("Auto Refresh Subscription Seconds").fill("1");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(feedRow(page, "Already Read")).toHaveCount(0);
    await api.control("POST", "/inoreader/items", {
        streamId: "feed/https://read.example.com/rss",
        items: [{ id: "fresh", title: "Fresh article", published: Math.floor(Date.now() / 1000) }]
    });
    await expect(feedRow(page, "Already Read")).toHaveText("Already Read (1)", { timeout: 10_000 });
});

// `window.userScript` is typed by src/ui/userscript.ts, the public API (docs/userscript.md).
type TestWindow = Window & { userScriptState: { init: number; mounted: string[]; custom: number } };

test("user script API", async ({ page }) => {
    await page.addInitScript(() => {
        const target = window as unknown as TestWindow;
        target.userScriptState = { init: 0, mounted: [], custom: 0 };
        window.addEventListener("userscript-init", () => {
            target.userScriptState.init++;
            target.userScript?.event.subscribe("SubscriptionContent::componentDidMount", (content) => {
                target.userScriptState.mounted.push((content as { title: string }).title);
            });
            target.userScript?.registerKey("n", () => {
                target.userScriptState.custom++;
            });
        });
    });
    await connectInoreader(page);
    await closeDialog(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).userScriptState.init)).toBe(1);

    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    const active = await page.evaluate(() => {
        const { userScript } = window;
        return { content: userScript?.getActiveContent()?.title, subscription: userScript?.getActiveSubscription() };
    });
    expect(active.content).toBe("alpha article 1");
    expect(active.subscription).toEqual({
        title: "Alpha Blog",
        url: "https://alpha.example.com/rss",
        iconUrl: "",
        htmlUrl: "https://alpha.example.com/"
    });
    await page.evaluate(() => window.userScript?.triggerKey("j"));
    await expect(focusedArticle(page)).toContainText("alpha article 2");
    await page.keyboard.press("n");
    const state = await page.evaluate(() => (window as unknown as TestWindow).userScriptState);
    expect(state.custom).toBe(1);
    expect(state.mounted).toEqual(["alpha article 1", "alpha article 2", "alpha article 3"]);
});

test("the current feed is not hidden behind the sticky category header", async ({ page, api }) => {
    // A folder name too long for one line must not make the header taller.
    const folder = "A folder name long enough to wrap onto a second line in the sidebar";
    await api.reset({ inoreader: { subscriptions: manyInoreaderSubscriptions(30, folder) } });
    // A short window, so moving through the feeds scrolls the sidebar.
    await page.setViewportSize({ width: 1280, height: 400 });
    await connectInoreader(page);
    await closeDialog(page);
    /** How many of the current feed's top and bottom edges something else covers. */
    const coveredEdges = () =>
        currentFeed(page).evaluate((row) => {
            const rect = row.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            return [rect.top + 1, rect.bottom - 1].filter((y) => !row.contains(document.elementFromPoint(x, y))).length;
        });
    for (const index of Array.from({ length: 12 }, (_, offset) => offset + 1)) {
        await page.keyboard.press("s");
        await expect(currentFeed(page)).toHaveText(`Feed ${String(index).padStart(2, "0")} (1)`);
        await expect.poll(coveredEdges, { message: `Feed ${index} after s` }).toBe(0);
    }
    await page.keyboard.press("a");
    await expect(currentFeed(page)).toHaveText("Feed 11 (0)");
    await expect.poll(coveredEdges, { message: "Feed 11 after a" }).toBe(0);
});

test("the optional Inoreader app fields stay collapsed until used", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Sources" });
    const clientId = dialog.getByLabel("Inoreader App Client Id");
    // Empty fields for the default app must not look like missing input.
    await expect(clientId).toBeHidden();
    await dialog.getByText("Use your own Inoreader app").click();
    await clientId.fill("e2e-client");
    await dialog.getByLabel("Inoreader App Client secret").fill("e2e-secret");
    await dialog.getByRole("button", { name: "Connect to Inoreader" }).click();
    await page.locator("#authorize").click();
    await expect(page).toHaveURL("http://127.0.0.1:4173/");
    await expect(page.locator(".SubscriptionListContainer-item").first()).toBeVisible();
    // A saved app is shown expanded.
    await page.getByRole("button", { name: "Sources" }).click();
    await expect(dialog.getByLabel("Inoreader App Client Id")).toHaveValue("e2e-client");
});
