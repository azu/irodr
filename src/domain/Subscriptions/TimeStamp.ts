// MIT © 2017 azu

import { Serializer } from "ddd-base";

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

export class TimeStamp {
    value: number;

    static createTimeStampFromSecond(second: number) {
        return new TimeStamp(second * 1000);
    }

    static createTimeStampFromMillisecond(millisecond: number) {
        return new TimeStamp(millisecond);
    }

    static now() {
        return new TimeStamp(Date.now());
    }

    constructor(millisecond: number) {
        this.value = millisecond;
    }

    get date(): Date {
        return new Date(this.value / 1000);
    }

    get isoString(): string {
        return new Date(this.value / 1000).toISOString();
    }

    get second() {
        return this.value / 1000;
    }

    get millSecond() {
        return this.value;
    }
}
