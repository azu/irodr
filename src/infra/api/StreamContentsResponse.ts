// MIT © 2017 azu
// Refs: http://www.inoreader.com/developers/stream-contents
export interface Alternate {
    href: string;
    type: string;
}

export interface Canonical {
    href: string;
}

export interface Enclosure {
    href: string;
    type: "image/jpeg";
    length: string;
}

export interface StreamContentResponse {
    crawlTimeMsec: string;
    canonical: Canonical[];
    annotations: any[];
    enclosure?: Enclosure[];
    author: string;
    comments: any[];
    categories: string[];
    commentsNum: number;
    published: number;
    likingUsers: any[];
    id: string;
    origin: Origin;
    timestampUsec: string;
    summary: Summary;
    title: string;
    updated: number;
}

export interface Origin {
    streamId: string;
    htmlUrl: string;
    title: string;
}

export interface StreamContentsResponse {
    id: string;
    description: string;
    continuation: string;
    direction: string;
    self: Canonical;
    updated: number;
    items: StreamContentResponse[];
    title: string;
    updatedUsec: string;
}

export interface Summary {
    content: string;
    direction: string;
}
