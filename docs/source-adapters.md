# Source adapters

Irodr reads from sources that implement `Source` (`src/sources/source.ts`); see [Architecture](./architecture.md).
This document describes the behavior of each source.

## Inoreader

`src/sources/inoreader/`. Uses the [Inoreader API](https://www.inoreader.com/developers/).

- **Login**: OAuth 2.0 authorization code flow with a random `state`. The token is stored in
  `localStorage["inoreader-token"]` (the irodr 1.x format, so existing logins keep working) and refreshed
  with the refresh token when it expires or a request returns 401. A token refreshed by another tab is reused.
  Only a rejected grant (HTTP 400/401) disconnects; outages of the token endpoint keep the session.
- **Custom app**: optional. A Client ID and secret entered under **Use your own Inoreader app** in Sources (collapsed
  while unused) are stored in `localStorage["irodr:inoreader-client"]`.
- **Feeds**: `subscription/list` and `unread-count`. A feed is listed under its first category.
- **Items**: `stream/contents` with `n` = "Fetch subscription contents Count" (default 20). `Shift+J` and
  **Read More** load older items with the continuation. The Unread/All toggle (`t`) switches between items that
  were unread when loaded and all loaded items.
- **Mark read**: leaving a feed (or `m`) calls `mark-all-as-read` with `ts` just after the newest loaded item,
  so items that arrived afterwards stay unread. Nothing is marked when no item was loaded. Until Inoreader's unread
  count reflects it, the feed shows 0, for at most 5 minutes.
- **CORS**: requests go through `VITE_CORS_PROXY` (`/cors-proxy/`), unless `localStorage["REACT_APP_CORS_PROXY"]`
  overrides it (see `resources/userScript/irodr-cors.js`).

## GitHub Notifications

`src/sources/github/`. GitHub Notifications is the source of truth for unread notifications of every type;
browser storage is only a cache.

### Use

1. Configure repository Watch settings on GitHub. **Custom → Releases** is an option for release-only watching,
   not a requirement.
2. Open irodr's **Sources**.
3. Supply a **classic personal access token** with the `notifications` scope. Fine-grained tokens are not
   supported by the Notifications endpoint. Private notification subjects additionally require `repo` access;
   inaccessible subjects still appear with a repository link.
4. Click **Connect GitHub**. The token is saved in this browser without encryption and restored after reload.
5. Each repository with unread notifications appears as a feed (`owner/repository`) under **GitHub Notifications**.
6. Moving to another feed marks the departed repository's notifications read on GitHub, through the latest loaded
   notification timestamp. **Shift+S** skips the feed without marking it read; `m` marks the current repository
   read without moving. **Issue/PR and other types up to that timestamp are also marked read**, including ones hidden
   by the display filter. Newer updates are not modified.
7. A read repository stays in the list with 0 unread while it is among the recently visited feeds, like a read RSS
   feed, and disappears after that. GitHub feeds have no Unread/All toggle and no Read More.
8. **Show only Release notifications** is an optional display-only setting in Sources.

Refresh and the automatic refresh sync connected sources. Every sync fetches the **current unread inbox**, without
a `since` date. After all notification pages succeed, cached notifications absent from GitHub are removed, so a
notification read in another browser disappears on the next successful sync. GitHub's `X-Poll-Interval` (at least
60 seconds) and rate limits apply; this is not real-time push.

Only one GitHub account is supported per browser profile. Rotating the token of that account preserves its cache.
Another account is rejected to avoid mixing private inboxes; use a separate browser profile for it.

### API usage

- `GET /notifications?all=false&per_page=100`, following `Link: rel="next"` pages that keep the same query on the
  same host. All subject types become items. Pages are saved and displayed as they arrive.
- Release, Issue, PullRequest, Discussion and Commit subjects are resolved (4 at a time) for a browser URL and body.
  Unknown types still appear with their title and a repository link. Markdown is rendered with raw HTML disabled and
  sanitized again at display time; commit messages are escaped plain text. Only explicit HTTP(S) links and images
  are kept.
- Read acknowledgements use **one `PUT /repos/{owner}/{repo}/notifications` per repository**, with `last_read_at`
  frozen at the newest loaded notification when you leave the feed.
- A `205` response removes the covered cached items; a `202` leaves them until a later sync confirms GitHub's
  asynchronous operation. Failures keep them unread. Removal compares with the latest stored timestamps, so an update
  that arrives meanwhile is kept, and a sync already in flight cannot bring read items back.
- A failed sync keeps the cache and backs off before retrying (at least 5 minutes, honoring `Retry-After` and
  rate-limit reset headers).

The public GraphQL schema has no notification-read mutation. Repository-wide REST acknowledgements intentionally
trade per-type selection for far fewer write requests.

### Storage and security

Two IndexedDB databases, in the layout used by irodr 1.x (localforage), so an upgrade keeps the data:

| IndexedDB database         | Object store    | Key                               | Value                                           |
| -------------------------- | --------------- | --------------------------------- | ----------------------------------------------- |
| `irodr-sources`            | `keyvaluepairs` | `snapshot`                        | `{ sources, items, states }` (the cached inbox) |
| `irodr-source-credentials` | `keyvaluepairs` | `credential:github-notifications` | `{ version: 2, token }`                         |

- Web Locks serialize snapshot writes across tabs; each write reloads the stored snapshot under the lock.
- **Disconnect and forget token** in Sources stops syncing and removes the token. The cached inbox stays readable.
- **Cached articles and the token are not encrypted.** Scripts running on the same origin, including user scripts,
  can read them. Only use this feature in a trusted browser profile. Deleting browser data removes the cache, not
  GitHub's read state.

References:

- [GitHub notifications API](https://docs.github.com/en/rest/activity/notifications)
- [Mark repository notifications as read](https://docs.github.com/en/rest/activity/notifications#mark-repository-notifications-as-read)
- [GitHub public GraphQL schema](https://docs.github.com/en/graphql/overview/public-schema)
- [GitHub repository subscriptions](https://docs.github.com/en/rest/activity/watching)
