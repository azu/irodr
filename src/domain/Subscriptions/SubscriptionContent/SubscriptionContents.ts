// MIT © 2017 azu
import {
    SubscriptionContent,
    SubscriptionContentIdentifier,
    SubscriptionContentJSON,
    SubscriptionContentSerializer
} from "./SubscriptionContent";
import { splice } from "@immutable-array/prototype";
import { Serializer } from "ddd-base";
import { TimeStamp } from "../TimeStamp";

export const SubscriptionContentsSerializer: Serializer<SubscriptionContents, SubscriptionContentsJSON> = {
    fromJSON(json) {
        return new SubscriptionContents({
            contents: json.contents.map(content => SubscriptionContentSerializer.fromJSON(content)),
            lastUpdatedTimestamp: TimeStamp.createTimeStampFromMillisecond(json.lastUpdatedTimestampMs)
        });
    },
    toJSON(entity) {
        return {
            contents: entity.contents.map(content => SubscriptionContentSerializer.toJSON(content)),
            lastUpdatedTimestampMs: entity.lastUpdatedTimestamp.millSecond
        };
    }
};

export interface SubscriptionContentsJSON {
    contents: SubscriptionContentJSON[];
    lastUpdatedTimestampMs: number;
}

export interface SubscriptionContentsArgs {
    contents: SubscriptionContent[];
    lastUpdatedTimestamp: TimeStamp;
}

export class SubscriptionContents {
    contents: SubscriptionContent[];
    lastUpdatedTimestamp: TimeStamp;

    constructor(args: SubscriptionContentsArgs) {
        this.contents = args.contents;
        this.lastUpdatedTimestamp = args.lastUpdatedTimestamp;
    }

    get hasContent(): boolean {
        return this.contents.length > 0;
    }

    get debounceDelayTimeMs() {
        return 60 * 1000;
    }

    isNeededToUpdate(currentTimeStampMs: number) {
        if (!this.hasContent) {
            return true;
        }
        return currentTimeStampMs > this.lastUpdatedTimestamp.millSecond + this.debounceDelayTimeMs;
    }

    updateContents(contents: SubscriptionContent[]) {
        return new SubscriptionContents({
            ...(this as SubscriptionContentsArgs),
            contents
        });
    }

    getContentList() {
        return this.contents;
    }

    /**
     * 1. oldest content that are newer than `timeStamp`
     * 2. slice (0, oldest content index)
     *
     * @param {TimeStamp} timeStamp
     * @returns {SubscriptionContents}
     */
    getContentsNewerThanTheTime(timeStamp: TimeStamp) {
        let lastContentIndex: number = -1;
        for (let i = this.contents.length - 1; i >= 0; i--) {
            const content = this.contents[i];
            if (content.updatedDate.millSecond >= timeStamp.millSecond) {
                lastContentIndex = i + 1;
                break;
            }
        }
        if (lastContentIndex === -1) {
            return new SubscriptionContents({
                ...(this as SubscriptionContentsArgs),
                contents: []
            });
        }
        const newerContents = this.contents.slice(0, lastContentIndex);
        return new SubscriptionContents({
            ...(this as SubscriptionContentsArgs),
            contents: newerContents
        });
    }

    getContentsWithPredicate(predicate: ((content: SubscriptionContent) => boolean)) {
        const filteredContents = this.contents.filter(predicate);
        return new SubscriptionContents({
            ...(this as SubscriptionContentsArgs),
            contents: filteredContents
        });
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
