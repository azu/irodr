import * as React from "react";
import { appLocator } from "../../../AppLocator";
import { sourceCredentialsRepository } from "../../../infra/repository/SourceCredentialsRepository";
import { githubSourceSession } from "../../../infra/sources/GitHubSourceService";
import { sourceRepository } from "../../../infra/repository/SourceRepository";
import {
    ConnectGitHubSourceUseCase,
    ForgetGitHubCredentialsUseCase,
    SetGitHubReleaseFilterUseCase
} from "../../../use-case/source/GitHubSourceUseCases";

interface GitHubSourcePanelState {
    token: string;
    saved: boolean;
    unlocked: boolean;
    busy: boolean;
    status: string;
    releaseOnly: boolean;
}

export class GitHubSourcePanel extends React.Component<{}, GitHubSourcePanelState> {
    state: GitHubSourcePanelState = {
        token: "",
        saved: false,
        unlocked: githubSourceSession.isUnlocked,
        busy: true,
        status: "",
        releaseOnly:
            sourceRepository.getSources().find((source) => source.id === "github-notifications")?.config.releaseOnly ===
            true
    };
    private mounted = false;

    async componentDidMount() {
        this.mounted = true;
        try {
            const saved = await sourceCredentialsRepository.has("github-notifications");
            if (this.mounted) {
                this.setState({ saved, busy: false });
            }
        } catch {
            if (this.mounted) {
                this.setState({ busy: false, status: "Could not check saved GitHub credentials. Please try again." });
            }
        }
    }

    componentWillUnmount() {
        this.mounted = false;
    }

    private run = async (action: () => Promise<unknown>, success: string) => {
        if (this.state.busy) {
            return;
        }
        this.setState({ busy: true, status: "" });
        try {
            await action();
            // Clear secrets immediately, even if checking browser storage subsequently fails.
            if (this.mounted) {
                this.setState({ token: "", unlocked: githubSourceSession.isUnlocked });
            }
            const saved = await sourceCredentialsRepository.has("github-notifications");
            if (this.mounted) {
                this.setState({
                    saved,
                    status: success,
                    releaseOnly:
                        sourceRepository.getSources().find((source) => source.id === "github-notifications")?.config
                            .releaseOnly === true
                });
            }
        } catch {
            if (this.mounted) {
                this.setState({
                    unlocked: githubSourceSession.isUnlocked,
                    status:
                        githubSourceSession.status.phase === "error"
                            ? githubSourceSession.status.message
                            : "GitHub action failed. Check your token, connection and browser storage."
                });
            }
        } finally {
            if (this.mounted) {
                this.setState({ busy: false });
            }
        }
    };

    private connect = (event: React.FormEvent) => {
        event.preventDefault();
        const { token } = this.state;
        if (!token.trim()) {
            return;
        }
        // Secrets belong in private constructor fields, never Almin execute arguments.
        void this.run(
            () => appLocator.context.useCase(new ConnectGitHubSourceUseCase(token.trim())).execute(),
            "GitHub connected."
        );
    };

    render() {
        const { token, saved, unlocked, busy, status, releaseOnly } = this.state;
        return (
            <section aria-labelledby="github-source-title">
                <h2 id="github-source-title">GitHub Notifications</h2>
                <p>
                    Use a classic personal access token with the notifications scope. The repo scope is also needed for
                    private repository release bodies. On GitHub, use Watch → Custom → Releases for repositories whose
                    release notifications you want to follow.
                </p>
                <p>
                    Unread notifications of all types are grouped by repository under GitHub Notifications. Moving to
                    another feed marks that repository's notifications read on GitHub up to the loaded timestamp,
                    including Issue and Pull Request notifications. Shift+S skips without marking read. Other browsers
                    see the change on their next refresh.
                </p>
                <p>
                    Your token is saved unencrypted in this browser and restored automatically after reload. Scripts
                    running on this origin, including user scripts, can access it. Previously encrypted tokens must be
                    entered once more.
                </p>
                <p>
                    Each sync reloads the current unread inbox without a date cutoff. Repositories with no visible
                    unread notifications disappear. Cached article bodies, including private content, are not encrypted.
                    GitHub read articles and local Star controls are not shown.
                </p>
                <p role="status">{unlocked ? "GitHub is connected." : "GitHub is disconnected."}</p>
                {sourceRepository.getSources().some((source) => source.id === "github-notifications") && (
                    <label>
                        <input
                            type="checkbox"
                            checked={releaseOnly}
                            disabled={busy}
                            onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                void this.run(
                                    () =>
                                        appLocator.context
                                            .useCase(new SetGitHubReleaseFilterUseCase())
                                            .execute(checked),
                                    "Display filter saved."
                                );
                            }}
                        />
                        Show only Release notifications (display only; repository read still includes all types)
                    </label>
                )}
                <form onSubmit={this.connect}>
                    <fieldset disabled={busy}>
                        <legend>Connect GitHub</legend>
                        <label>
                            Classic personal access token
                            <input
                                type="password"
                                autoComplete="off"
                                value={token}
                                required
                                onChange={(event) => this.setState({ token: event.currentTarget.value })}
                            />
                        </label>
                        <button type="submit" disabled={!token.trim()}>
                            Connect GitHub
                        </button>
                        {(saved || unlocked) && (
                            <button
                                type="button"
                                onClick={() =>
                                    this.run(
                                        () =>
                                            appLocator.context.useCase(new ForgetGitHubCredentialsUseCase()).execute(),
                                        "GitHub disconnected and saved token removed."
                                    )
                                }
                            >
                                Disconnect and forget token
                            </button>
                        )}
                    </fieldset>
                </form>
                <p role="status" aria-live="polite">
                    {busy ? "Working…" : status}
                </p>
            </section>
        );
    }
}
