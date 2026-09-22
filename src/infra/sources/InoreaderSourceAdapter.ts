import type { SourceAdapter, SourceItem } from "../../domain/Sources/SourceAdapter";
import type {
    Canonical,
    Enclosure,
    StreamContentResponse,
    StreamContentsResponse
} from "../api/StreamContentsResponse";

const he = require("he");

export interface InoreaderSourceItem extends SourceItem {
    url: string;
    content: string;
    publishedAt: string;
    updatedAt: string;
    metadata: {
        legacyId: string;
        author: string;
        canonical: Canonical[];
        enclosures: Enclosure[];
    };
}

/** Keep provider normalization shared by canonical storage and the legacy RSS view. */
export function toInoreaderSourceItem(streamId: string, response: StreamContentResponse): InoreaderSourceItem {
    const canonicalHref = response.canonical.map((canonical) => canonical.href).join(",");
    const updated = response.updated !== undefined && response.updated !== 0 ? response.updated : response.published;
    return {
        externalId: response.id,
        sourceId: streamId,
        title: he.decode(response.title) as string,
        url: response.canonical[0].href,
        content: response.summary.content,
        publishedAt: new Date(response.published * 1000).toISOString(),
        updatedAt: new Date(updated * 1000).toISOString(),
        metadata: {
            // Deliberately remove only the first whitespace run, just as the original RSS ID did.
            legacyId: `${streamId}--${response.id}--${canonicalHref}`.replace(/\s+/, ""),
            author: response.author,
            canonical: response.canonical,
            enclosures: response.enclosure ?? []
        }
    };
}

export interface InoreaderSourceConfig {
    sourceId: string;
    /** Defaults to sourceId when the source represents a single feed. */
    streamId?: string;
    fetchCount?: number;
}

export interface InoreaderSourceCursor {
    continuation?: string;
}

export type InoreaderStreamFetch = (options: {
    streamId: string;
    fetchCount: number;
    continuation?: string;
}) => Promise<StreamContentsResponse>;

/** Fetch exactly one page; callers retain control of per-feed lazy pagination. */
export class InoreaderSourceAdapter implements SourceAdapter<InoreaderSourceConfig, InoreaderSourceCursor> {
    constructor(private readonly fetchStream: InoreaderStreamFetch) {}

    async sync({
        config,
        cursor
    }: {
        config: InoreaderSourceConfig;
        cursor?: InoreaderSourceCursor;
    }): Promise<{ items: InoreaderSourceItem[]; cursor: InoreaderSourceCursor }> {
        const response = await this.fetchStream({
            streamId: config.streamId ?? config.sourceId,
            fetchCount: config.fetchCount ?? 20,
            continuation: cursor?.continuation
        });
        return {
            items: response.items.map((item) => ({
                ...toInoreaderSourceItem(response.id, item),
                sourceId: config.sourceId
            })),
            cursor: { continuation: response.continuation }
        };
    }
}
