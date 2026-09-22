/** Source data is independent of the reader's local read/star state. Dates are ISO strings. */
export interface SourceItem {
    externalId: string;
    sourceId: string;
    title: string;
    url?: string;
    content?: string;
    publishedAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
}

export interface ItemState {
    itemId: string;
    read: boolean;
    readStateUpdatedAt: string;
    starred: boolean;
    starStateUpdatedAt: string;
}

export interface SourceAdapter<Config, Cursor> {
    sync(options: { config: Config; cursor?: Cursor }): Promise<{ items: SourceItem[]; cursor: Cursor }>;
}
