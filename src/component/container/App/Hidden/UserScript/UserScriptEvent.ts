// MIT © 2017 azu
import { EventEmitter } from "events";

export class UserScriptEvent extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(0);
    }

    subscribe(event: string, handler: (...args: any[]) => void) {
        this.addListener(event, handler);
        return () => {
            this.removeListener(event, handler);
        };
    }

    dispatch(event: string, ...args: any[]): void {
        this.emit(event, ...args);
    }
}
