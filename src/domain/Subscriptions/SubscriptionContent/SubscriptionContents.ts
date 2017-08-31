// MIT © 2017 azu
import {
    SubscriptionContent,
    SubscriptionContentIdentifier,
    SubscriptionContentJSON,
    SubscriptionContentSerializer
} from "./SubscriptionContent";
import { splice } from "@immutable-array/prototype";
import { Serializer } from "ddd-base";

export const SubscriptionContentsSerializer: Serializer<SubscriptionContents, SubscriptionContentsJSON> = {
    fromJSON(json) {
        return new SubscriptionContents({
            contents: json.contents.map(content => SubscriptionContentSerializer.fromJSON(content)),
            lastUpdatedTimestampMs: json.lastUpdatedTimestampMs
        });
    },
    toJSON(entity) {
        return {
            contents: entity.contents.map(content => SubscriptionContentSerializer.toJSON(content)),
            lastUpdatedTimestampMs: entity.lastUpdatedTimestampMs
        };
    }
};

export interface SubscriptionContentsJSON {
    contents: SubscriptionContentJSON[];
    lastUpdatedTimestampMs: number;
}

export interface SubscriptionContentsArgs {
    contents: SubscriptionContent[];
    lastUpdatedTimestampMs: number;
}

export class SubscriptionContents {
    contents: SubscriptionContent[];
    lastUpdatedTimestampMs: number;

    constructor(args: SubscriptionContentsArgs) {
        this.contents = args.contents;
        this.lastUpdatedTimestampMs = args.lastUpdatedTimestampMs;
    }

    get hasContent(): boolean {
        return this.contents.length > 0;
    }

    get debounceDelayTimeMs() {
        return 60 * 1000;
    }

    isNeededToUpdate(currentTimeStamp: number) {
        if (!this.hasContent) {
            return true;
        }
        return currentTimeStamp > this.lastUpdatedTimestampMs + this.debounceDelayTimeMs;
    }

    updateContents(contents: SubscriptionContent[]) {
        return new SubscriptionContents({
            ...this as SubscriptionContentsArgs,
            contents
        });
    }

    getContents() {
        return this.contents;
    }

    getContentsWithPredicate(predicate: ((content: SubscriptionContent) => boolean)) {
        return this.contents.filter(predicate);
    }

    findContentById(id: SubscriptionContentIdentifier) {
        return this.contents.find(content => content.id.equals(id));
    }

    prevContentOf(aContent: SubscriptionContent) {
        const index = this.contents.findIndex(content => content.equals(aContent));
        if (index === -1) {
            return;
        }
        return this.contents[index - 1];
    }

    nextContentOf(aContent: SubscriptionContent) {
        const index = this.contents.findIndex(content => content.equals(aContent));
        if (index === -1) {
            return;
        }
        return this.contents[index + 1];
    }

    add(aContent: SubscriptionContent) {
        return this.updateContents(this.contents.concat(aContent));
    }

    remove(aContent: SubscriptionContent) {
        const index = this.contents.findIndex(content => content.id.equals(aContent.id));
        if (index === -1) {
            return;
        }
        return this.updateContents(splice(this.contents, index, 1));
    }
}
