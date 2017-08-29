// MIT © 2017 azu
import Combokeys from "combokeys";
import { BaseContainer } from "../../BaseContainer";
import { SubscriptionListState } from "../Subscription/SubscriptionList/SubscriptionListStore";
import { createShowSubscriptionContentsUseCase } from "../../../../use-case/subscription/ShowSubscriptionContentsUseCase";
import debounce from "lodash.debounce";
import { SubscriptionContentsState } from "../Subscription/SubscriptionContents/SubscriptionContentsStore";
import { ScrollToNextContentUseCase } from "../Subscription/SubscriptionContents/use-case/ScrollToNextContentUseCase";
import { ScrollToPrevContentUseCase } from "../Subscription/SubscriptionContents/use-case/ScrollToPrevContentUseCase";

const DEBOUNCE_TIME = 32;
const IGNORE_NODE_NAME_PATTERN = /webview/i;
const isIgnoreNode = (event: Event): boolean => {
    const target = event.target as HTMLElement;
    if (!target.nodeName) {
        return false;
    }
    return IGNORE_NODE_NAME_PATTERN.test(target.nodeName);
};

export interface ShortcutKeyContainerProps {
    subscriptionContents: SubscriptionContentsState;
    subscriptionList: SubscriptionListState;
}

export class ShortcutKeyContainer extends BaseContainer<ShortcutKeyContainerProps, {}> {
    combokeys: any;

    componentDidMount() {
        this.combokeys = new Combokeys(document.documentElement);
        const actionMap = {
            "move-next-subscription-feed": debounce((_event: Event) => {
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                if (!currentSubscriptionId) {
                    const firstItem = this.props.subscriptionList.getFirstItem();
                    if (!firstItem) {
                        return console.info("Not found first item");
                    }
                    this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase =>
                        useCase.execute(firstItem.id)
                    );
                    return;
                }
                const nextItem = this.props.subscriptionList.getNextItem(currentSubscriptionId);
                if (!nextItem) {
                    return console.info("Not found next item");
                }
                this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase => useCase.execute(nextItem.id));
            }, DEBOUNCE_TIME),
            "move-prev-subscription-feed": debounce((_event: Event) => {
                const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
                if (!currentSubscriptionId) {
                    return;
                }
                const nextItem = this.props.subscriptionList.getPrevItem(currentSubscriptionId);
                if (!nextItem) {
                    return console.info("Not found next item");
                }
                this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase => useCase.execute(nextItem.id));
            }, DEBOUNCE_TIME),
            "move-next-content-item": (_event: Event) => {
                const nextContent = this.props.subscriptionContents.getNextContent();
                if (!nextContent) {
                    return;
                }
                this.useCase(new ScrollToNextContentUseCase()).executor(useCase => useCase.execute(nextContent.id));
            },
            "move-prev-content-item": (_event: Event) => {
                const prevContent = this.props.subscriptionContents.getPrevContent();
                if (!prevContent) {
                    return;
                }
                this.useCase(new ScrollToPrevContentUseCase()).executor(useCase => useCase.execute(prevContent.id));
            }
        };
        const keyMap: { [index: string]: keyof typeof actionMap } = {
            j: "move-next-content-item",
            k: "move-prev-content-item",
            a: "move-prev-subscription-feed",
            s: "move-next-subscription-feed"
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
