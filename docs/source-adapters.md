# Source adapters

## GitHub Notifications

irodr remains a browser-only application. GitHub Notifications is the source of
truth for unread notifications of every type; browser storage is only a cache.
Inoreader continues to work with its existing lazy fetching and remote read
behavior.

### Use

1. Configure repository Watch settings on GitHub. **Custom → Releases** is an
   option for release-only watching, not a requirement.
2. Open irodr's **Sources → GitHub / source settings**.
3. Supply a **classic personal access token** with the `notifications` scope.
   Fine-grained tokens are not supported by the Notifications endpoint.
   Private notification subjects additionally require `repo` access; inaccessible
   subjects still appear with a repository link.
4. Click **Connect GitHub**. The PAT is saved in this browser without encryption
   or a passphrase and restored automatically after reload.
5. Open **GitHub Notifications** in the sidebar. Each repository with visible
   unread notifications appears as a feed (`owner/repository`).
6. Moving to another feed marks the departed repository's notifications read on
   GitHub, through the latest loaded notification timestamp. **Shift+S** skips the
   feed without marking it read; `m` marks the current repository's notifications read
   without moving. There are no per-article or repository read buttons.
   **Issue/PR and other types up to that timestamp are also marked read**, including
   ones hidden by the display filter. Newer updates are not modified.
7. Repositories disappear when they have no visible unread notifications. GitHub
   feeds have no All/Mark unread/Star controls; this is an unread inbox, not an archive.
8. **Show only Release notifications** is an optional display-only setting in
   Sources. The default shows all types; toggling it does not discard cached items.

Refresh and the existing automatic refresh scheduler sync connected sources.
Every sync fetches the **current unread inbox**, without a `since` date or
seven-day cutoff. Old incremental cursors are ignored. After all notification
pages succeed, cached notifications absent from GitHub are removed. Thus a
notification read in another browser disappears on the next successful sync.
GitHub's polling interval and rate limits still apply; this is not real-time push.

The sidebar folder identifies GitHub as the source. The article view deliberately
has no GitHub settings button or sync statistics, matching ordinary feeds.
Errors use the existing header. Titles appear page by page before subject details
finish loading; details are fetched with bounded concurrency.
After reload, stored articles and state are available immediately; the saved
token is restored and collection resumes automatically. No background collection
runs when the app is closed. Notifications no longer returned by GitHub cannot
be recovered; this is not a complete release-history importer.

Only one GitHub account is supported per browser profile. PAT rotation for that
account preserves its cache. Another account is rejected to
avoid mixing private inboxes; use a separate browser profile for it.

### Boundaries

```text
SourceAdapter: fetch + normalize, no reader-state writes
    -> SourceItem: provider ID, source ID, article data and provenance
    -> SourceRepository: sources, items, states (separate collections)
    -> SourceSubscription: projection into the existing Reader UI
```

`SourceAdapter<Config, Cursor>` is shared by GitHub and Inoreader normalization.
The Inoreader factory consumes the canonical normalizer through a compatibility
bridge, preserving historical article IDs, enclosures and pagination. Its
storage/read-state migration is deliberately **not** part of this slice: the
existing Inoreader remote read bridge remains authoritative for RSS. GitHub
read operations live in the GitHub session service, separate from the fetching
adapter. Legacy local read/star flags do not determine GitHub unread state.
Direct RSS ingestion, generic StateBridge APIs, Web Monitor and AI enrichment
are not implemented.

GitHub collection:

- `GET /notifications?all=false&per_page=100`, following unread notification pages;
  all subject types become items. Release filtering is a display preference only.
- Only unread notifications are displayed. GitHub read state is authoritative, not
  local ItemState. A composite `(sourceId, externalId)` identifies each article;
  the notification thread ID is the external ID.
- Notification pages are checkpointed and displayed before release details are
  fetched. Only a complete notification snapshot can remove absent notifications.
  A failed later page does not erase the previous cache. Read-state reconciliation
  completes before optional body enrichment, so an unavailable release body does
  not prevent remote reads from being reflected.
- `X-Poll-Interval` sets the minimum next poll time. Incremental `since` and
  conditional `Last-Modified` requests are not used for unread reconciliation.
- Known Release, Issue, PullRequest, Discussion and Commit subjects are resolved
  individually for a browser URL and body. Unknown types still appear with their
  title and repository link. Bodies display as escaped plain text, not rendered Markdown.
- Read acknowledgements use **one `PUT /repos/{owner}/{repo}/notifications` per
  repository**, with `last_read_at` frozen from the loaded notifications' update
  timestamps at departure. All types through that timestamp are included.
- A `205` response removes covered cached items; a `202` leaves them visible until
  a subsequent unread snapshot confirms GitHub's asynchronous operation finished.
  Failures retain unread items. Cache removal checks the latest stored timestamps
  so an update arriving while the write is in flight is not accidentally removed.
  The same timestamp boundary prevents stale in-flight syncs from reintroducing read items.
- Each source can fail independently. A failed sync retains its prior cursor;
  the service backs off before retrying, honoring `Retry-After` and rate-limit
  reset headers when available.

The public GraphQL schema has no notification-read mutation. Repository-wide REST
acknowledgements intentionally trade per-type selection for far fewer write requests.

### Storage and security

The proposed four logical collections are represented in existing localforage
storage, not a new SQL database:

- `irodr-sources` has a single atomic snapshot containing source configuration and
  cached items. Its generic item-state collection is not authoritative for GitHub.
  Completing the unread list atomically replaces that source's cached inbox.
- `irodr-source-credentials` stores the unencrypted token separately.
- Web Locks serialize source snapshot mutations across tabs, with a fresh
  persisted snapshot loaded under the lock. Without Web Locks, use one tab.
  Other browsers and tabs observe GitHub read changes on their next sync.

Use **Disconnect and forget token** in Sources to stop syncing and remove the
saved token; the cached inbox is preserved until a later sync. Previously encrypted
credentials cannot be auto-restored; enter the PAT once more to replace them.
No PAT is stored in source config, reader state, or Almin execution arguments.

**Cached articles and metadata are not encrypted.** This includes private release
notes. Browser data deletion removes the cache, not GitHub's read state.
Read state is shared through GitHub; credentials and caches are per browser.
Storage remains subject to browser quota.
**The token is also unencrypted.** Scripts running on the same origin, including
user scripts or XSS, can access it even before the next sync. Only use this
feature in a trusted browser profile.

### Verification

```sh
pnpm exec tsc --noEmit
CI=true pnpm exec react-scripts test --watchAll=false --runInBand
pnpm run build
pnpm run test:proxy
```

Tests use mocked GitHub responses and in-memory storage. For a live smoke test,
connect a PAT in two browser profiles (never in a committed file), check repository
grouping for Releases, Issues and PRs, then leave a repository feed in one profile.
Its notifications through the loaded timestamp should become read on GitHub and
disappear from the other profile on its next sync. Verify that other repositories
and newer updates remain unread.

References:

- [GitHub notification API](https://docs.github.com/en/rest/activity/notifications)
- [GitHub repository bulk-read API](https://docs.github.com/en/rest/activity/notifications#mark-repository-notifications-as-read)
- [GitHub public GraphQL schema](https://docs.github.com/en/graphql/overview/public-schema)
- [GitHub repository subscriptions](https://docs.github.com/en/rest/activity/watching)
