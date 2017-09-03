// MIT © 2017 azu

import { Serializer, ValueObject } from "ddd-base";

export const TimeStampSerializer: Serializer<TimeStamp, TimeStampJSON> = {
    fromJSON(json) {
        return TimeStamp.createTimeStampFromMillisecond(json);
    },
    toJSON(entity) {
        return entity.millSecond;
    }
};
// unix-time
export type TimeStampJSON = number;

export class TimeStamp extends ValueObject {
    // millsecond
    value: number;

    static createTimeStampFromSecond(second: number) {
        return new TimeStamp(second * 1000);
    }

    static createTimeStampFromMillisecond(millisecond: number) {
        return new TimeStamp(millisecond);
    }

    static createTimeStampFromMicrosecond(microsecond: number) {
        return new TimeStamp(microsecond / 1000);
    }

    static now() {
        return new TimeStamp(Date.now());
    }

    constructor(millisecond: number) {
        super();
        this.value = millisecond;
    }

    get date(): Date {
        return new Date(this.value);
    }

    get isoString(): string {
        return this.date.toISOString();
    }

    get second() {
        return this.value / 1000;
    }

    get millSecond() {
        return this.value;
    }
}
