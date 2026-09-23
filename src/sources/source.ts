/**
 * The contract between the reader and a content provider (Inoreader, GitHub Notifications, ...).
 *
 * The reader and the UI only know these types. Provider specifics such as OAuth,
 * pagination, read-state APIs and settings forms stay inside each Source.
 * To add a provider, implement `Source` and register it in `src/main.tsx`.
 */

/** A feed shown in the sidebar. `id` is unique across all sources. */
export interface Feed {
    readonly id: string;
    readonly sourceId: string;
    readonly title: string;
    readonly category: string;
    readonly htmlUrl: string;
    /** The feed document (RSS/Atom) URL, when there is one. */
    readonly feedUrl?: string;
    readonly iconUrl?: string;
    /** Settings page of this feed on the provider site. */
    readonly editUrl?: string;
    readonly unreadCount: number;
    /** Unread counts above this value are shown as `N+`. */
    readonly unreadCountLimit?: number;
    /** Epoch milliseconds of the latest update known to the source. */
    readonly updatedAt?: number;
    /** Changes whenever the feed has new items. Cached items with another revision are reloaded. */
    readonly revision: string;
}

/** An article. `id` is unique across all sources. */
export interface Item {
    readonly id: string;
    readonly feedId: string;
    readonly title: string;
    readonly url: string;
    readonly author: string;
    /** Untrusted HTML. The UI sanitizes it before display. */
    readonly contentHtml: string;
    /** Epoch milliseconds. */
    readonly publishedAt: number;
    /** Epoch milliseconds. */
    readonly updatedAt: number;
    /** Unread state when the item was loaded. */
    readonly unread: boolean;
}

export interface ItemPage {
    readonly items: readonly Item[];
    /** Pass to `loadItems` to load older items. Absent when there are no more. */
    readonly continuation?: string;
}

export interface SourceCapabilities {
    /** Older items can be loaded page by page (Shift+J, "Read more"). */
    readonly loadMore: boolean;
    /** Read items are loaded too, so the Unread/All toggle is meaningful. */
    readonly unreadFilter: boolean;
    /** Items live in the source and change while syncing. The reader re-reads them on every change. */
    readonly liveItems: boolean;
}

export type SourceStatusPhase = "disconnected" | "idle" | "syncing" | "waiting" | "error";

export interface SourceStatus {
    readonly phase: SourceStatusPhase;
    readonly message: string;
}

/** A settings form described as data, so the UI renders every source the same way. */
export interface SettingField {
    readonly name: string;
    readonly label: string;
    readonly type: "text" | "password" | "checkbox";
    readonly value: string | boolean;
    readonly placeholder?: string;
    /** For checkboxes: run the `setting:<name>` action as soon as the value changes. */
    readonly applyOnChange?: boolean;
    /** Cleared from the form after an action runs, e.g. access tokens. */
    readonly transient?: boolean;
}

export interface SettingAction {
    readonly id: string;
    readonly label: string;
    readonly primary?: boolean;
    /** Field names that must be non-empty to run this action. */
    readonly requires?: readonly string[];
}

export interface SourceSettings {
    readonly description: readonly string[];
    readonly fields: readonly SettingField[];
    readonly actions: readonly SettingAction[];
}

export interface SourceSnapshot {
    readonly connected: boolean;
    readonly status: SourceStatus;
    readonly feeds: readonly Feed[];
    readonly settings: SourceSettings;
}

export type SettingValues = Readonly<Record<string, string | boolean>>;

export interface Source {
    readonly id: string;
    readonly title: string;
    /** The provider's website, offered in the Sources menu. */
    readonly homeUrl?: string;
    readonly capabilities: SourceCapabilities;
    /** Returns the same object until something changes. */
    getSnapshot(): SourceSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Restore credentials and cached data at startup.
     * Returns `consumedUrl: true` when `url` was an authorization callback for this source.
     */
    restore(url: URL): Promise<{ consumedUrl: boolean }>;
    /** Refresh feeds and unread counts from the provider. */
    sync(): Promise<void>;
    loadItems(feedId: string, options: { count: number; continuation?: string }): Promise<ItemPage>;
    /**
     * Mark a feed read on the provider through the newest of `loadedItems`.
     * Items that arrived after they were loaded stay unread.
     */
    markRead(feedId: string, loadedItems: readonly Item[]): Promise<void>;
    /** Run a settings action. Resolves to a message for the user. */
    runAction(actionId: string, values: SettingValues): Promise<string>;
}

/** Format an unread count, e.g. `1000+` when the source stopped counting. */
export function formatUnreadCount(feed: Pick<Feed, "unreadCount" | "unreadCountLimit">): string {
    return feed.unreadCountLimit !== undefined && feed.unreadCount > feed.unreadCountLimit
        ? `${feed.unreadCount}+`
        : String(feed.unreadCount);
}
