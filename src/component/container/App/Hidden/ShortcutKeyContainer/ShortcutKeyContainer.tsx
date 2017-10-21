// MIT © 2017 azu
import * as React from "react";
import Combokeys from "combokeys";
import { BaseContainer } from "../../../BaseContainer";
import { SubscriptionListState } from "../../Subscription/SubscriptionList/SubscriptionListStore";
import { createShowSubscriptionContentsUseCase } from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";
import debounce from "lodash.debounce";
import { SubscriptionContentsState } from "../../Subscription/SubscriptionContents/SubscriptionContentsStore";
import { ScrollToNextContentUseCase } from "../../Subscription/SubscriptionContents/use-case/ScrollToNextContentUseCase";
import { ScrollToPrevContentUseCase } from "../../Subscription/SubscriptionContents/use-case/ScrollToPrevContentUseCase";
import { createMarkAsReadToServerUseCase } from "../../../../../use-case/subscription/MarkAsReadToServerUseCase";
import { createOpenSubscriptionContentInNewTabUseCase } from "../../../../../use-case/subscription/OpenSubscriptionContentInNewTabUseCase";
import { createUpdateHeaderMessageUseCase } from "../../../../../use-case/app/UpdateHeaderMessageUseCase";
import { SubscriptionIdentifier } from "../../../../../domain/Subscriptions/Subscription";
import {
    TurnOffContentsFilterUseCase,
    TurnOnContentsFilterUseCase
} from "../../Subscription/SubscriptionContents/use-case/ToggleFilterContents";

const MapSigns = require("react-icons/lib/fa/map-signs");

const DEBOUNCE_TIME = 32;
const IGNORE_NODE_NAME_PATTERN = /webview/i;
const isIgnoreNode = (event: Event): boolean => {
    const target = event.target as HTMLElement;
    if (!target) {
        return false;
    }
    if (!target.nodeName) {
        return false;
    }
    return IGNORE_NODE_NAME_PATTERN.test(target.nodeName);
};

/**
 * Scroll by screen size ratio
 * @param {HTMLElement} target
 * @param {number} ratio
 * @param {"up" | "down"} direction
 */
const scrollByScrollSize = (target: HTMLElement, ratio: number, direction: "up" | "down") => {
    const directionOperator = direction === "down" ? 1 : -1;
    ratio = ratio || 1;
    target.scrollBy(0, window.innerHeight / 2 * directionOperator * ratio);
};

export interface ShortcutKeyContainerProps {
    subscriptionContents: SubscriptionContentsState;
    subscriptionList: SubscriptionListState;
}

export class ShortcutKeyContainer extends BaseContainer<ShortcutKeyContainerProps, {}> {
    combokeys: any;

    triggerKey(keys: string, action?: string): void {
        if (this.combokeys) {
            this.combokeys.trigger(keys, action);
        }
    }

    registerKey(key: string, handler: (event?: Event) => void): void {
        if (this.combokeys) {
            this.combokeys.bind(key, handler);
        }
    }

    /**
     * Default keyMap Object by
     */
    defaultActions = (() => {
        const loadNext = async (currentSubscriptionId?: SubscriptionIdentifier) => {
            if (!currentSubscriptionId) {
                const firstItem = this.props.subscriptionList.getFirstItem();
                if (!firstItem) {
                    return console.info("Not found first item");
                }
                await this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase =>
                    useCase.execute(firstItem.id)
                );
                return;
            }
            const nextItem = this.props.subscriptionList.getNextItem(currentSubscriptionId);
            if (!nextItem) {
                return console.info("Not found next item");
            }
            this.useCase(createShowSubscriptionContentsUseCase())
                .executor(useCase => useCase.execute(nextItem.id))
                .catch(error => {
                    return this.useCase(createUpdateHeaderMessageUseCase())
                        .executor(useCase => useCase.execute(`Can't load... Skip ${nextItem.title}.`))
                        .then(() => {
                            return loadNext(nextItem.id);
                        });
                });
        };
        return {
            "move-next-subscription-feed": debounce(async (_event: Event) => {
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                await loadNext(currentSubscriptionId);
            }, DEBOUNCE_TIME),
            "move-prev-subscription-feed": debounce(async (_event: Event) => {
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                if (!currentSubscriptionId) {
                    return;
                }
                const nextItem = this.props.subscriptionList.getPrevItem(currentSubscriptionId);
                if (!nextItem) {
                    return console.info("Not found next item");
                }
                await this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase =>
                    useCase.execute(nextItem.id)
                );
            }, DEBOUNCE_TIME),
            "move-next-content-item": (_event: Event) => {
                const body = document.querySelector(".SubscriptionContentsContainer");
                if (!body) {
                    return;
                }
                if (body.scrollTop === 0) {
                    const firstContent = this.props.subscriptionContents.getFirstContent();
                    if (firstContent) {
                        return this.useCase(new ScrollToNextContentUseCase()).executor(useCase =>
                            useCase.execute(firstContent.id)
                        );
                    }
                }
                const currentContent = this.props.subscriptionContents.focusContentId;
                const nextContent = this.props.subscriptionContents.getNextContent();
                if (currentContent && !nextContent) {
                    // last item and next
                    return this.useCase(createUpdateHeaderMessageUseCase()).executor(useCase =>
                        useCase.execute(
                            <span>
                                <MapSigns /> End of contents
                            </span>
                        )
                    );
                }
                if (!nextContent) {
                    return;
                }
                return this.useCase(new ScrollToNextContentUseCase()).executor(useCase =>
                    useCase.execute(nextContent.id)
                );
            },
            "move-prev-content-item": (_event: Event) => {
                const prevContent = this.props.subscriptionContents.getPrevContent();
                if (!prevContent) {
                    return;
                }
                this.useCase(new ScrollToPrevContentUseCase()).executor(useCase => useCase.execute(prevContent.id));
            },
            "scroll-down-content": (event: Event) => {
                event.preventDefault();
                // TODO: make explicitly
                const contentContainer = document.querySelector(".SubscriptionContentsContainer") as HTMLElement;
                if (contentContainer) {
                    scrollByScrollSize(contentContainer, 0.3, "down");
                }
            },
            "scroll-up-content": (event: Event) => {
                event.preventDefault();
                // TODO: make explicitly
                const contentContainer = document.querySelector(".SubscriptionContentsContainer") as HTMLElement;
                if (contentContainer) {
                    scrollByScrollSize(contentContainer, 0.3, "up");
                }
            },
            "make-subscription-read": (event: Event) => {
                event.preventDefault();
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                if (currentSubscriptionId) {
                    this.useCase(createMarkAsReadToServerUseCase()).executor(useCase =>
                        useCase.execute(currentSubscriptionId)
                    );
                }
            },
            "open-current-content-url": (event: Event) => {
                event.preventDefault();
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                const focusContentId = this.props.subscriptionContents.focusContentId;
                if (!currentSubscriptionId || !focusContentId) {
                    return;
                }
                this.useCase(createOpenSubscriptionContentInNewTabUseCase()).executor(useCase =>
                    useCase.execute(currentSubscriptionId, focusContentId)
                );
            },
            "toggle-content-filter": (_event: Event) => {
                if (this.props.subscriptionContents.enableContentFilter) {
                    this.useCase(new TurnOffContentsFilterUseCase()).executor(useCase => useCase.execute());
                } else {
                    this.useCase(new TurnOnContentsFilterUseCase()).executor(useCase => useCase.execute());
                }
            }
        };
    })();

    componentDidMount() {
        this.combokeys = new Combokeys(document.documentElement);
        const actionMap = this.defaultActions;
        const keyMap: { [index: string]: keyof typeof actionMap } = {
            j: "move-next-content-item",
            t: "toggle-content-filter",
            k: "move-prev-content-item",
            a: "move-prev-subscription-feed",
            s: "move-next-subscription-feed",
            m: "make-subscription-read",
            v: "open-current-content-url",
            space: "scroll-down-content",
            "shift+space": "scroll-up-content"
        };
        Object.keys(keyMap).forEach(key => {
            this.combokeys.bind(key, (event: Event) => {
                if (isIgnoreNode(event)) {
                    return;
                }
                actionMap[keyMap[key]](event);
            });
        });
    }

    componentWillUnmount() {
        this.combokeys.detach();
    }

    render() {
        return null;
    }
}
