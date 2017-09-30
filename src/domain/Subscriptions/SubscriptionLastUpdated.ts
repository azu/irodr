import { Serializer, ValueObject } from "ddd-base";

export const SubscriptionLastUpdatedSerializer: Serializer<SubscriptionLastUpdated, SubscriptionLastUpdatedJSON> = {
    toJSON(entity) {
        return entity.date.toISOString();
    },
    fromJSON(json) {
        return new SubscriptionLastUpdated(new Date(json));
    }
};

export type SubscriptionLastUpdatedJSON = string;

export class SubscriptionLastUpdated extends ValueObject {
    date: Date;

    constructor(date: Date) {
        super();
        this.date = date;
    }
}
