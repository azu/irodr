// MIT © 2017 azu
import { NullableRepository } from "ddd-base";
import { SubscriptionContent } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";

export class ReadContentHistoryRepository extends NullableRepository<SubscriptionContent> {
    save(content: SubscriptionContent) {
        super.save(content);
    }

    saveContents(contents: SubscriptionContent[]) {
        for (const content of contents) {
            this.save(content);
        }
    }

    // delete unused contents from database
    // preserve contents that are used in the last 100 contents
    deleteUnusedSavedContents(limit: number = 100) {
        const contents = this.getAll();
        if (contents.length <= limit) {
            return;
        }
        // LRU - preserve last 100 contents
        const contentsToDelete = contents.slice(0, contents.length - limit);
        for (const content of contentsToDelete) {
            this.delete(content);
        }
    }
}
