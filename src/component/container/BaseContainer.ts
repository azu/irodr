// MIT © 2017 azu
import * as React from "react";
import { UseCase, UseCaseExecutor } from "almin";
import { appLocator } from "../../AppLocator";

/**
 * Extends React.Component for Container.
 * It has executor feature for almin UseCase.
 */
export class BaseContainer<T, P> extends React.Component<T, P> {
    useCase<T extends UseCase>(useCase: T): UseCaseExecutor<T> {
        return appLocator.context.useCase(useCase);
    }
}
