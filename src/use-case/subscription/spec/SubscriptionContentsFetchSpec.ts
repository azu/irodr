// MIT © 2017 azu
import { Subscription } from "../../../domain/Subscriptions/Subscription";

export const isSatisfiedSubscriptionContentsFetchSpec = (
    subscription: Subscription
): {
    ok: boolean;
    reason?: string;
} => {
    if (subscription.contents.hasContent) {
        return {
            ok: false,
            reason: `No need to update. This ${subscription.name} has content.`
        };
    }
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
