import { githubNotifications, iso } from "./fake-api/fixtures.ts";
import {
    articles,
    closeDialog,
    connectGitHub,
    currentFeed,
    expect,
    type FakeApi,
    feedRow,
    headerMessage,
    requests,
    test
} from "./fixtures.ts";

const unreadOnServer = (api: FakeApi) => api.control<string[]>("GET", "/github/unread");

test.beforeEach(async ({ api, page }) => {
    // Two notifications per page, to exercise Link pagination.
    await api.reset({ github: { notifications: githubNotifications(), pageSize: 2 } });
    await page.goto("/");
    // Nothing is connected yet, so Sources opens by itself.
    await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible();
});

async function connect(page: import("@playwright/test").Page): Promise<void> {
    await connectGitHub(page);
    await closeDialog(page);
    await expect(feedRow(page, "octo/docs")).toBeVisible();
}

test("groups unread notifications of every type by repository", async ({ page, api }) => {
    await connect(page);
    const nav = page.getByRole("navigation", { name: "Subscriptions" });
    await expect(nav.getByRole("button", { expanded: true })).toHaveText(["GitHub Notifications"]);
    await expect(nav.locator(".SubscriptionListContainer-item")).toHaveText([
        "acme/rocket (2)",
        "acme/tools (1)",
        "octo/docs (1)"
    ]);
    const pages = requests(await api.log(), "github", "/notifications");
    expect(pages.map((entry) => entry.query.page ?? "1")).toEqual(["1", "2"]);
    expect(pages.every((entry) => entry.query.all === "false" && entry.query.per_page === "100")).toBe(true);
});

test("renders notification details safely", async ({ page }) => {
    await connect(page);
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("acme/rocket (2)");
    await expect(articles(page)).toHaveCount(2);
    const release = articles(page).filter({ hasText: "v2.0.0" });
    const body = release.locator(".SubscriptionContentsContainer-contentBody");
    await expect(body.getByRole("heading", { name: "Highlights" })).toBeVisible();
    await expect(body.locator("strong")).toHaveText("Faster");
    await expect(body.getByRole("link", { name: "https://example.com/notes" })).toHaveAttribute(
        "href",
        "https://example.com/notes"
    );
    // Raw HTML in Markdown stays text.
    await expect(body).toContainText("<script>alert(1)</script>");
    await expect(body.locator("script")).toHaveCount(0);
    await expect(release.getByRole("link", { name: "v2.0.0" })).toHaveAttribute(
        "href",
        "https://github.com/acme/rocket/releases/tag/v2"
    );
    // Commit messages are shown as escaped plain text.
    await feedRow(page, "octo/docs").click();
    await expect(articles(page).locator("pre")).toHaveText("Fix typo in <README>");
});

test("leaving a repository marks it read on GitHub through the loaded timestamp", async ({ page, api }) => {
    await connect(page);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(2);
    // A notification that arrives after the repository was loaded must stay unread.
    await api.control("POST", "/github/notifications", {
        notifications: [
            {
                id: "103",
                repository: "acme/rocket",
                type: "Issue",
                title: "New issue",
                number: "8",
                updated_at: iso(0.5)
            }
        ]
    });
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("acme/tools (1)");
    await expect.poll(async () => (await unreadOnServer(api)).sort()).toEqual(["103", "201", "301"]);
    const put = requests(await api.log(), "github", "/repos/acme/rocket/notifications");
    expect(put).toHaveLength(1);
    expect(JSON.parse(put[0]?.body ?? "{}")).toEqual({ last_read_at: iso(1) });
    // Like a read RSS feed, the repository stays in place so the list does not shift.
    await expect(feedRow(page, "acme/rocket")).toHaveText("acme/rocket (0)");
    await page.keyboard.press("a");
    await expect(page.getByText("No unread items in this feed.")).toBeVisible();
});

test("Shift+S skips a repository and m marks the current one read", async ({ page, api }) => {
    await connect(page);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(2);
    await page.keyboard.press("Shift+S");
    await expect(currentFeed(page)).toHaveText("acme/tools (1)");
    await expect(headerMessage(page)).toContainText(/Skip current subscription|Complete prefetch/);
    expect(
        requests(await api.log(), "github", /\/notifications$/).filter((entry) => entry.method === "PUT")
    ).toHaveLength(0);

    await page.keyboard.press("m");
    await expect.poll(() => unreadOnServer(api)).toEqual(["101", "102", "301"]);
    await expect(currentFeed(page)).toHaveText("acme/tools (0)");
    await expect(page.getByText("No unread items in this feed.")).toBeVisible();
});

test("a failed mark-read keeps the notifications unread", async ({ page, api }) => {
    await api.control("POST", "/github/config", { markReadStatus: { "acme/rocket": 403 } });
    await connect(page);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(2);
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("acme/tools (1)");
    await expect(headerMessage(page)).toContainText("Failed notifications remain unread.");
    await expect(feedRow(page, "acme/rocket")).toHaveText("acme/rocket (2)");
    expect(await unreadOnServer(api)).toEqual(["101", "102", "201", "301"]);
});

test("notifications read in another browser disappear on the next sync", async ({ page, api }) => {
    // GitHub asks clients to wait at least X-Poll-Interval (60s) between syncs.
    await page.clock.install();
    await page.goto("/");
    await connect(page);
    await api.control("POST", "/github/read", { ids: ["201"] });
    await page.clock.fastForward("01:05");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(feedRow(page, "acme/tools")).toHaveCount(0);
    await expect(page.getByTestId("total-unread")).toHaveText("Unread: 3");
});

test("restores the saved token and cached inbox after reload", async ({ page, api }) => {
    await connect(page);
    await api.control("POST", "/github/config", { notificationsStatus: 500 });
    await page.reload();
    // The cached inbox shows immediately, even though GitHub now fails.
    await expect(feedRow(page, "acme/rocket")).toHaveText("acme/rocket (2)");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Sources" }).click();
    await expect(page.getByTestId("source-status-github-notifications")).toContainText("Connected");
});

test("release-only display filter hides other notification types", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "Sources" }).click();
    const filter = page.getByLabel("Show only Release notifications", { exact: false });
    await filter.check();
    await expect(page.getByTestId("source-result-github-notifications")).toHaveText("Display filter saved.");
    await closeDialog(page);
    await expect(
        page.getByRole("navigation", { name: "Subscriptions" }).locator(".SubscriptionListContainer-item")
    ).toHaveText(["acme/rocket (1)"]);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveText([/v2\.0\.0/]);

    await page.getByRole("button", { name: "Sources" }).click();
    await filter.uncheck();
    await closeDialog(page);
    await expect(feedRow(page, "acme/tools")).toBeVisible();
});

test("disconnecting forgets the token but keeps the cached inbox", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "Sources" }).click();
    await page.getByRole("button", { name: "Disconnect and forget token" }).click();
    await expect(page.getByTestId("source-result-github-notifications")).toHaveText(
        "GitHub disconnected and saved token removed."
    );
    await expect(page.getByTestId("source-status-github-notifications")).toContainText("Not connected");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible();
    await expect(feedRow(page, "acme/rocket")).toBeAttached();
});

test("rejects an invalid token and another account's inbox", async ({ page, api }) => {
    await api.control("POST", "/github/config", {
        accounts: { ghp_valid: { id: 1, login: "octocat" }, ghp_other: { id: 2, login: "hubot" } }
    });
    const dialog = page.getByRole("dialog", { name: "Sources" });
    await dialog.getByLabel("Classic personal access token").fill("ghp_wrong");
    await dialog.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(page.getByTestId("source-result-github-notifications")).toHaveText(
        "GitHub authentication failed (HTTP 401). Check your classic PAT."
    );

    await connectGitHub(page);
    await dialog.getByRole("button", { name: "Disconnect and forget token" }).click();
    await dialog.getByLabel("Classic personal access token").fill("ghp_other");
    await dialog.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(page.getByTestId("source-result-github-notifications")).toHaveText(
        "This browser inbox belongs to another GitHub account. Use a separate browser profile."
    );
});
