// MIT © 2017 azu
import * as React from "react";

export interface ColorBarProps {
    color: string;
    height?: number | string;
    isCompleted: boolean;
}

export interface ColorBarState {
    progress: number;
}

/**
 * This is fake progress color bar component
 * increase progress value, but it is not real value.
 */
export class ProgressColorBar extends React.Component<ColorBarProps, ColorBarState> {
    timeIntervalId: any;

    static defaultProps() {
        return {
            height: "3px"
        };
    }

    constructor() {
        super();

        this.state = {
            progress: 0.1
        };
    }

    stepProgress = () => {
        const addProgress = 0.05 * Math.pow(1 - Math.sqrt(this.state.progress), 2);
        const nextProgress = this.state.progress + addProgress;
        if (nextProgress >= 1.0) {
            this.setState({
                progress: 1.0
            });
        } else {
            this.setState({
                progress: nextProgress
            });
        }
    };

    start = () => {
        this.setState(
            {
                progress: 0.1
            },
            () => {
                if (!this.timeIntervalId) {
                    this.timeIntervalId = setInterval(this.stepProgress, 100);
                }
            }
        );
    };

    stop = () => {
        this.setState({
            progress: 1.0
        });
        clearInterval(this.timeIntervalId);
        this.timeIntervalId = null;
    };

    componentDidMount() {
        this.start();
    }

    componentWillUnmount() {
        this.stop();
    }

    componentWillReceiveProps(nextProps: ColorBarProps) {
        // Finish
        if (nextProps.isCompleted) {
            this.stop();
        } else {
            this.start();
        }
    }

    render() {
        const style = {
            height: this.props.height,
            backgroundColor: this.props.color,
            transform: `scaleX(${this.state.progress})`
        };
        return <div className="ProgressColorBar" style={style} />;
    }
}
