// MIT © 2017 azu
import { SubscriptionContent, SubscriptionContentIdentifier } from "./SubscriptionContent";
import { splice } from "@immutable-array/prototype";

export class SubscriptionContents {
    contents: SubscriptionContent[];

    constructor(contents: SubscriptionContent[]) {
        this.contents = contents;
    }

    update(contents: SubscriptionContent[]) {
        return new SubscriptionContents(contents);
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

    add(aContent: SubscriptionContent) {
        return new SubscriptionContents(this.contents.concat(aContent));
    }

    remove(aContent: SubscriptionContent) {
        const index = this.contents.findIndex(content => content.id.equals(aContent.id));
        if (index === -1) {
            return;
        }
        return new SubscriptionContents(splice(this.contents, index, 1));
    }
}
