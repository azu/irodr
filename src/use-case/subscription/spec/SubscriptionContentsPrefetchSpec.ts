// MIT © 2017 azu
import { Subscription } from "../../../domain/Subscriptions/Subscription";

export const isSatisfiedSubscriptionContentsPrefetchSpec = (
    subscription: Subscription
): {
    ok: boolean;
    reason?: string;
} => {
    const currentTimeStampMs = Date.now();
    if (!subscription.contents.isNeededToUpdate(currentTimeStampMs)) {
        return {
            ok: false,
            reason: `No need update.
Now : ${currentTimeStampMs}
Wait: ${subscription.contents.debounceDelayTimeMs / 1000} seconds
`
        };
    }
    return {
        ok: true
    };
};
