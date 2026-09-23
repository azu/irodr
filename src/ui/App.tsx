import * as stylex from "@stylexjs/stylex";
import { ArticleView } from "./ArticleView.tsx";
import { FeedList } from "./FeedList.tsx";
import { Header } from "./Header.tsx";
import { PreferencesDialog } from "./PreferencesDialog.tsx";
import { SourcesDialog } from "./SourcesDialog.tsx";
import { colors, sizes } from "./tokens.stylex.ts";

const styles = stylex.create({
    app: {
        height: "100dvh",
        display: "grid",
        gridTemplateRows: `${sizes.header} minmax(0, 1fr)`,
        color: colors.text,
        backgroundColor: colors.background
    },
    body: { display: "grid", gridTemplateColumns: `${sizes.sidebar} minmax(0, 1fr)`, minHeight: 0 }
});

export function App() {
    return (
        <div {...stylex.props(styles.app)}>
            <Header />
            <div {...stylex.props(styles.body)}>
                <FeedList />
                <ArticleView />
            </div>
            <SourcesDialog />
            <PreferencesDialog />
        </div>
    );
}
