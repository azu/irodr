import { GitHubNotificationsAdapter, GitHubNotificationsCursor } from "../GitHubNotificationsAdapter";

const config = { sourceId: "github-account", token: "secret-token" };
const now = new Date("2026-01-02T12:00:00.000Z");
const firstURL = "https://api.github.com/notifications?all=false&per_page=100";
const release = {
    id: "notification-1",
    subject: { type: "Release", title: "Version 1", url: "https://api.github.com/repos/owner/project/releases/1" },
    repository: { full_name: "owner/project" },
    updated_at: "2026-01-02T11:59:00Z",
    unread: true
};
const issue = {
    ...release,
    id: "issue-1",
    subject: { type: "Issue", title: "An issue", url: null }
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (key: string) => headers[key] || null },
        json: async () => body
    } as Response;
}

function setup(...responses: Response[]) {
    const fetchMock = jest.fn();
    responses.forEach((value) => fetchMock.mockResolvedValueOnce(value));
    return {
        fetchMock,
        adapter: new GitHubNotificationsAdapter({ fetch: fetchMock, now: () => now })
    };
}

describe("GitHubNotificationsAdapter", () => {
    it("includes Issue, PullRequest and unknown types and resolves their own safe links", async () => {
        const { adapter } = setup(
            response([
                {
                    ...issue,
                    subject: {
                        type: "Issue",
                        title: "Issue",
                        url: "https://api.github.com/repos/owner/project/issues/2"
                    }
                },
                {
                    ...issue,
                    id: "pull-1",
                    subject: {
                        type: "PullRequest",
                        title: "PR",
                        url: "https://api.github.com/repos/owner/project/pulls/3"
                    }
                },
                { ...issue, id: "other-1", subject: { type: "CheckSuite", title: "Checks", url: null } },
                { ...release, unread: false }
            ]),
            response({
                html_url: "https://github.com/owner/project/issues/2",
                body: "Issue notes",
                created_at: "2026-01-01T00:00:00Z"
            }),
            response({ html_url: "https://github.com/owner/project/pull/3", body: "PR notes" })
        );
        const { items } = await adapter.sync({ config });
        expect(items.map((item) => item.metadata?.type)).toEqual(["Issue", "PullRequest", "CheckSuite"]);
        expect(items.map((item) => item.url)).toEqual([
            "https://github.com/owner/project/issues/2",
            "https://github.com/owner/project/pull/3",
            "https://github.com/owner/project"
        ]);
        expect(items[0].content).toBe("<p>Issue notes</p>\n");
    });

    it.each<Record<string, string>>([
        { "Retry-After": "3600" },
        { "Retry-After": "Fri, 02 Jan 2026 13:00:00 GMT" },
        { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Date.parse("2026-01-02T13:00:00Z") / 1000) }
    ])("retains server-requested retry delays in safe errors: %j", async (headers) => {
        const { adapter } = setup(
            response({}, 429, {
                Date: now.toUTCString(),
                ...headers
            })
        );
        await expect(adapter.sync({ config })).rejects.toMatchObject({ retryAfterMs: 3600000 });
    });

    it("requests only unread notifications and resolves safe HTML content", async () => {
        const { adapter, fetchMock } = setup(
            response([release]),
            response({
                html_url: "https://github.com/owner/project/releases/tag/v1",
                body: "# Release\n<script>alert('x')</script>&",
                published_at: "2026-01-01T00:00:00Z"
            })
        );
        const result = await adapter.sync({ config });
        expect(fetchMock.mock.calls[0][0]).toBe(firstURL);
        expect(result.items).toEqual([
            {
                externalId: "notification-1",
                sourceId: config.sourceId,
                title: "Version 1",
                url: "https://github.com/owner/project/releases/tag/v1",
                content: "<h1>Release</h1>\n<p>&lt;script&gt;alert('x')&lt;/script&gt;&amp;</p>\n",
                publishedAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T11:59:00.000Z",
                metadata: {
                    type: "Release",
                    repository: "owner/project",
                    githubUnread: true,
                    detailsResolved: true,
                    contentVersion: 1
                }
            }
        ]);
        expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET" && init.redirect === "error")).toBe(true);
        expect(result.items[0]).not.toHaveProperty("read");
    });

    it("reads the full unread snapshot, deduplicates notifications, and records the poll interval", async () => {
        const next = `${firstURL}&page=2`;
        const { adapter, fetchMock } = setup(
            response([release], 200, { Link: `<${next}>; rel="next"`, "X-Poll-Interval": "120" }),
            response([release, { ...release, id: "notification-2" }]),
            response({}, 403),
            response({}, 404)
        );
        const result = await adapter.sync({ config });
        expect(fetchMock.mock.calls[1][0]).toBe(next);
        expect(result.items.map((item) => item.externalId)).toEqual(["notification-1", "notification-2"]);
        expect(result.items[0].url).toBe("https://github.com/owner/project/releases");
        expect(result.cursor).not.toHaveProperty("since");
        expect(result.cursor.nextPollAt).toBe("2026-01-02T12:02:00.000Z");
    });

    it("reuses unchanged resolved release details without replacing them with a placeholder", async () => {
        const first = setup(
            response([release]),
            response({
                body: "Cached notes",
                html_url: "https://github.com/owner/project/releases/tag/v1"
            })
        );
        const result = await first.adapter.sync({ config });
        const fetchMock = jest.fn().mockResolvedValue(response([release]));
        const checkpoints = jest.fn(async () => undefined);
        const next = new GitHubNotificationsAdapter({
            fetch: fetchMock,
            now: () => now,
            existingItems: result.items,
            onItems: checkpoints
        });
        const repeated = await next.sync({ config });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(repeated.items[0].content).toBe("<p>Cached notes</p>\n");
        expect(checkpoints).toHaveBeenCalledWith([
            expect.objectContaining({
                content: "<p>Cached notes</p>\n",
                url: "https://github.com/owner/project/releases/tag/v1"
            })
        ]);
        // Cache provenance must survive reuse, not only the initial resolution.
        await new GitHubNotificationsAdapter({
            fetch: fetchMock,
            now: () => now,
            existingItems: repeated.items
        }).sync({ config });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(["detailsResolved", "releaseResolved"])("refreshes legacy %s bodies once", async (resolvedFlag) => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(response([release]))
            .mockResolvedValueOnce(response({ body: "# Cached notes" }));
        const adapter = new GitHubNotificationsAdapter({
            fetch: fetchMock,
            now: () => now,
            existingItems: [
                {
                    sourceId: config.sourceId,
                    externalId: release.id,
                    title: release.subject.title,
                    content: "<pre># Cached notes</pre>",
                    updatedAt: "2026-01-02T11:59:00.000Z",
                    metadata: { type: "Release", [resolvedFlag]: true }
                }
            ]
        });
        const result = await adapter.sync({ config });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.items[0].content).toBe("<h1>Cached notes</h1>\n");
    });

    it("keeps commit messages as escaped plain text", async () => {
        const { adapter } = setup(
            response([
                {
                    ...release,
                    subject: {
                        type: "Commit",
                        title: "Commit",
                        url: "https://api.github.com/repos/owner/project/commits/abcdef0"
                    }
                }
            ]),
            response({ commit: { message: "# Not a heading\n<script>alert('x')</script>" } })
        );
        const result = await adapter.sync({ config });
        expect(result.items[0].content).toBe(
            "<pre># Not a heading\n&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</pre>"
        );
    });

    it("keeps successful detail checkpoints on failure and retries only unresolved items", async () => {
        const notifications = [
            release,
            {
                ...release,
                id: "notification-2",
                subject: {
                    ...release.subject,
                    url: "https://api.github.com/repos/owner/project/releases/2"
                }
            }
        ];
        const saved = new Map<string, import("../../../domain/Sources/SourceAdapter").SourceItem>();
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(response(notifications))
            .mockResolvedValueOnce(response({ body: "First notes" }))
            .mockResolvedValueOnce(response({}, 503));
        const adapter = new GitHubNotificationsAdapter({
            fetch: fetchMock,
            now: () => now,
            onItems: async (items) => {
                items.forEach((item) => saved.set(item.externalId, item));
            }
        });
        await expect(adapter.sync({ config })).rejects.toThrow("503");
        expect(saved.get("notification-1")?.metadata?.detailsResolved).toBe(true);
        expect(saved.get("notification-2")?.metadata?.detailsResolved).not.toBe(true);
        const retryFetch = jest
            .fn()
            .mockResolvedValueOnce(response(notifications))
            .mockResolvedValueOnce(response({ body: "Second notes" }));
        const retry = new GitHubNotificationsAdapter({
            fetch: retryFetch,
            now: () => now,
            existingItems: Array.from(saved.values())
        });
        const result = await retry.sync({ config });
        expect(retryFetch).toHaveBeenCalledTimes(2);
        expect(retryFetch.mock.calls[1][0]).toBe("https://api.github.com/repos/owner/project/releases/2");
        expect(result.items.map((item) => item.content)).toEqual(["<p>First notes</p>\n", "<p>Second notes</p>\n"]);
    });

    it("does not poll before nextPollAt", async () => {
        const { adapter, fetchMock } = setup();
        const cursor = { since: now.toISOString(), nextPollAt: "2026-01-02T12:01:00Z" };
        expect(await adapter.sync({ config, cursor })).toEqual({ items: [], cursor });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not restrict the unread snapshot using the browser or server clock", async () => {
        const { adapter } = setup(
            response([release], 200, {
                Date: "Fri, 02 Jan 2026 10:00:00 GMT",
                Link: `<${firstURL}&page=2>; rel="next"`
            }),
            response([{ ...issue, updated_at: "2026-01-02T10:01:00Z" }], 200, {
                Date: "Fri, 02 Jan 2026 10:02:00 GMT"
            }),
            response({}, 404)
        );
        expect((await adapter.sync({ config })).cursor).not.toHaveProperty("since");
    });

    it("does not create a time window from notification timestamps", async () => {
        const { adapter } = setup(
            response([{ ...issue, updated_at: "2026-01-02T10:00:00Z" }], 200, {
                Link: `<${firstURL}&page=2>; rel="next"`
            }),
            response([
                { ...issue, updated_at: "invalid" },
                { ...issue, updated_at: "2026-01-02T10:01:00Z" }
            ])
        );
        expect((await adapter.sync({ config })).cursor).not.toHaveProperty("since");
    });

    it("drops obsolete since cursors from the next snapshot cursor", async () => {
        const cursor = { since: "2026-01-02T10:00:00.000Z" };
        const { adapter } = setup(response([{ ...issue, updated_at: "invalid" }]));
        expect((await adapter.sync({ config, cursor })).cursor).not.toHaveProperty("since");
    });

    it.each([429, 500, 503])("fails the sync on transient release status %s", async (status) => {
        const cursor = { since: "2026-01-02T10:00:00.000Z" };
        const { adapter } = setup(response([release]), response({}, status));
        await expect(adapter.sync({ config, cursor })).rejects.toThrow(
            `GitHub notification details request failed (${status}).`
        );
        expect(cursor).toEqual({ since: "2026-01-02T10:00:00.000Z" });
    });

    it("does not treat rate-limited 403 release responses as inaccessible releases", async () => {
        const { adapter } = setup(response([release]), response({}, 403, { "X-RateLimit-Remaining": "0" }));
        await expect(adapter.sync({ config })).rejects.toThrow("GitHub notification details request failed (403).");
    });

    it("fails safely on release transport failure rather than advancing the cursor", async () => {
        const { adapter, fetchMock } = setup(response([release]));
        fetchMock.mockRejectedValueOnce(new Error(config.token));
        await expect(adapter.sync({ config })).rejects.toThrow(/^GitHub request failed\.$/);
    });

    it("ignores legacy since and validators so remote reads are observed", async () => {
        const { adapter, fetchMock } = setup(response([]));
        await adapter.sync({
            config,
            cursor: {
                since: now.toISOString(),
                lastModified: now.toISOString(),
                lastModifiedQuery: firstURL
            }
        });
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("since")).toBe(false);
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("If-Modified-Since");
    });

    it("does not reuse all=true validators after switching to unread-only collection", async () => {
        const { adapter, fetchMock } = setup(response([]));
        await adapter.sync({
            config,
            cursor: {
                lastModified: now.toISOString(),
                lastModifiedQuery: "https://api.github.com/notifications?all=true&per_page=100"
            }
        });
        expect(fetchMock.mock.calls[0][0]).toBe(firstURL);
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("If-Modified-Since");
    });

    it("accepts unread-only pagination when GitHub omits the default all=false parameter", async () => {
        const next = "https://api.github.com/notifications?per_page=100&page=2";
        const { adapter, fetchMock } = setup(response([], 200, { Link: `<${next}>; rel="next"` }), response([]));
        await adapter.sync({ config });
        expect(fetchMock.mock.calls[1][0]).toBe(next);
    });

    it("treats an unexpected 304 as a failure rather than an empty unread snapshot", async () => {
        const cursor: GitHubNotificationsCursor = {
            since: "2026-01-02T11:00:00.000Z",
            lastModified: "2026-01-02T10:00:00.000Z",
            lastModifiedQuery: `${firstURL}&since=2026-01-02T10%3A55%3A00.000Z`
        };
        const { adapter, fetchMock } = setup(response(null, 304, { "X-Poll-Interval": "90" }));
        await expect(adapter.sync({ config, cursor })).rejects.toThrow("304");
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("If-Modified-Since");
    });

    it("does not persist incremental validators for unread reconciliation", async () => {
        const { adapter } = setup(response([], 200, { "Last-Modified": "Fri, 02 Jan 2026 10:00:00 GMT" }));
        const { cursor } = await adapter.sync({ config });
        expect(cursor).not.toHaveProperty("lastModified");
        expect(cursor).not.toHaveProperty("lastModifiedQuery");
    });

    it("does not mutate the input cursor or return partial results when a later page fails", async () => {
        const cursor = { lastModified: now.toISOString() };
        const original = { ...cursor };
        const { adapter } = setup(response([], 200, { Link: `<${firstURL}&page=2>; rel="next"` }), response({}, 500));
        await expect(adapter.sync({ config, cursor })).rejects.toThrow("GitHub notifications request failed (500).");
        expect(cursor).toEqual(original);
    });

    it.each([
        "https://evil.example/notifications?all=false&per_page=100",
        "https://api.github.com/user?all=false&per_page=100",
        "https://token@api.github.com/notifications?all=false&per_page=100",
        "http://api.github.com/notifications?all=false&per_page=100",
        "https://api.github.com/notifications?all=true&per_page=100",
        "https://api.github.com/notifications?all=false&all=true&per_page=100"
    ])("rejects unsafe or query-changing pagination: %s", async (url) => {
        const { adapter, fetchMock } = setup(response([], 200, { Link: `<${url}>; rel="next"` }));
        await expect(adapter.sync({ config })).rejects.toThrow("Invalid GitHub pagination.");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        "https://evil.example/release/1",
        "https://api.github.com/user",
        "https://api.github.com/repos/other/project/releases/1",
        "https://api.github.com/repos/owner/project/releases/1?redirect=evil"
    ])("never sends credentials to an untrusted subject URL: %s", async (url) => {
        const { adapter, fetchMock } = setup(response([{ ...release, subject: { ...release.subject, url } }]));
        const result = await adapter.sync({ config });
        expect(result.items[0].url).toBe("https://github.com/owner/project/releases");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not expose raw transport errors containing secrets", async () => {
        const { adapter, fetchMock } = setup();
        fetchMock.mockRejectedValue(new Error(`Authorization: ${config.token}`));
        await expect(adapter.sync({ config })).rejects.toThrow(/^GitHub request failed\.$/);
    });

    it("rejects invalid bodies and pagination cycles without advancing a cursor", async () => {
        await expect(setup(response({ error: config.token })).adapter.sync({ config })).rejects.toThrow(
            "Invalid GitHub notifications response."
        );
        await expect(
            setup(response([], 200, { Link: `<${firstURL}>; rel="next"` })).adapter.sync({ config })
        ).rejects.toThrow("Invalid GitHub pagination.");
    });
});
