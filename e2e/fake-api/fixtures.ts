import type { GitHubNotificationSeed } from "./github.ts";
import type { InoreaderSubscriptionSeed } from "./inoreader.ts";

/** Epoch seconds `hoursAgo` hours before a fixed point, so data is deterministic. */
export const BASE_TIME = Date.parse("2026-09-01T12:00:00Z") / 1000;
export const at = (hoursAgo: number) => BASE_TIME - hoursAgo * 3600;
export const iso = (hoursAgo: number) => new Date(at(hoursAgo) * 1000).toISOString();

function items(prefix: string, count: number, options: { read?: number; offset?: number } = {}) {
    return Array.from({ length: count }, (_, index) => ({
        id: `tag:google.com,2005:reader/item/${prefix}-${index + 1}`,
        title: `${prefix} article ${index + 1}`,
        content: `<p>Body of ${prefix} article ${index + 1}.</p>`,
        url: `https://${prefix}.example.com/articles/${index + 1}`,
        author: `${prefix} author`,
        published: at((options.offset ?? 0) + index + 1),
        // The oldest `read` items are already read.
        read: index >= count - (options.read ?? 0)
    }));
}

/** `count` feeds with one unread item each, in one category: enough to scroll the sidebar. */
export function manyInoreaderSubscriptions(count: number, category = "Many"): InoreaderSubscriptionSeed[] {
    return Array.from({ length: count }, (_, index) => {
        const name = `feed${String(index + 1).padStart(2, "0")}`;
        return {
            id: `feed/https://${name}.example.com/rss`,
            title: `Feed ${String(index + 1).padStart(2, "0")}`,
            categories: [category],
            htmlUrl: `https://${name}.example.com/`,
            items: items(name, 1)
        };
    });
}

/** Three categories, sorted by name in the sidebar: Blogs, News, Tech. */
export function inoreaderSubscriptions(): InoreaderSubscriptionSeed[] {
    return [
        {
            id: "feed/https://alpha.example.com/rss",
            title: "Alpha Blog",
            categories: ["Blogs"],
            htmlUrl: "https://alpha.example.com/",
            items: items("alpha", 3)
        },
        {
            id: "feed/https://beta.example.com/rss",
            title: "Beta Blog",
            categories: ["Blogs"],
            htmlUrl: "https://beta.example.com/",
            items: items("beta", 2, { read: 1 })
        },
        {
            id: "feed/https://gamma.example.com/rss",
            title: "Gamma News",
            categories: ["News"],
            htmlUrl: "https://gamma.example.com/",
            items: items("gamma", 25, { read: 20 })
        },
        {
            id: "feed/https://read.example.com/rss",
            title: "Already Read",
            categories: ["News"],
            htmlUrl: "https://read.example.com/",
            items: items("read", 2, { read: 2 })
        },
        {
            id: "feed/https://delta.example.com/rss",
            title: "Delta Tech",
            categories: ["Tech"],
            htmlUrl: "https://delta.example.com/",
            items: items("delta", 1)
        }
    ];
}

export function githubNotifications(): GitHubNotificationSeed[] {
    return [
        {
            id: "101",
            repository: "acme/rocket",
            type: "Release",
            title: "v2.0.0",
            number: "2",
            updated_at: iso(1),
            body: "## Highlights\n\n- **Faster** launches\n- See https://example.com/notes\n\n<script>alert(1)</script>"
        },
        {
            id: "102",
            repository: "acme/rocket",
            type: "Issue",
            title: "Launch fails on Mondays",
            number: "7",
            updated_at: iso(2),
            body: "Steps to reproduce: launch on a Monday."
        },
        {
            id: "201",
            repository: "acme/tools",
            type: "PullRequest",
            title: "Add a wrench",
            number: "12",
            updated_at: iso(3),
            body: "This PR adds a wrench."
        },
        {
            id: "301",
            repository: "octo/docs",
            type: "Commit",
            title: "Fix typo",
            number: "abcdef1",
            updated_at: iso(4),
            body: "Fix typo in <README>"
        }
    ];
}
