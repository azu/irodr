// MIT © 2017 azu
interface RequestIdleCallback {
    didTimeout: boolean;
    timeRemaining: () => number;
}

declare global {
    interface Window {
        requestIdleCallback(
            cb: (deadline: RequestIdleCallback) => void,
            options?: {
                timeout: number;
            }
        ): NodeJS.Timer;

        cancelIdleCallback(id: NodeJS.Timer): void;
    }
}

export class TimeScheduler {
    private timerId?: any;
    private idleId?: any;

    constructor(private callback: () => void, private interval: number) {}

    private intervalCallback = (deadline: RequestIdleCallback) => {
        if (deadline.timeRemaining() > 0) {
            this.callback();
        }
    };

    private idleWork = () => {
        if (this.idleId) {
            window.cancelIdleCallback(this.idleId);
            this.idleId = undefined;
        }
        this.idleId = window.requestIdleCallback(this.intervalCallback, {
            timeout: 1000
        });
    };

    start(): void {
        this.timerId = setInterval(this.idleWork, this.interval);
    }

    stop(): void {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = undefined;
        }
        if (this.idleId) {
            window.cancelIdleCallback(this.idleId);
            this.idleId = undefined;
        }
    }
}
