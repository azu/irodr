# AGENTS.md

Irodr is an LDR-style, keyboard-driven reader for Inoreader and GitHub Notifications.
A client-side React 19 app built with Vite+ (`vp`), StyleX and React Compiler.

## Commands

| Task                                | Command                              |
| ----------------------------------- | ------------------------------------ |
| Install                             | `vp install` (or `pnpm install`)     |
| Dev server (http://localhost:8888/) | `vp dev`                             |
| Format + lint + type check          | `vp check` (`vp check --fix` to fix) |
| Unit tests (Vitest, Node)           | `vp test`                            |
| Integration tests (Playwright)      | `vp run test:e2e`                    |
| Production build                    | `vp build`                           |

Run `vp check` and `vp test` before committing; the pre-commit hook runs `vp staged` and `vp test`.
Run `vp run test:e2e` when changing behavior. If Playwright's Chromium is not installed, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a Chromium binary or run `vp exec playwright install chromium`.

## Structure

See [docs/architecture.md](docs/architecture.md).

- `src/sources/`: one directory per provider, each implementing `Source` from `src/sources/source.ts`.
- `src/app/reader.ts`: navigation and read-state behavior, independent of React and of any provider.
- `src/ui/`: React components. They depend on the reader only, never on a specific source.
- `e2e/fake-api/`: fake Inoreader and GitHub APIs, used by unit tests and Playwright tests.

## Rules

- Never branch on a source ID in `src/app` or `src/ui`. Express differences with `SourceCapabilities`,
  `SourceSettings` or inside the source.
- Components are function components with hooks. They must compile with React Compiler (the build fails otherwise):
  no mutation during render, no `try/finally` in components, no reading refs during render.
- Styles use StyleX `stylex.create` with longhand properties (`borderWidth`, not `border`); `stylex/valid-styles`
  reports what StyleX would silently drop. Keep the stable class names in `src/ui/dom.ts`; user scripts use them.
- Article HTML is untrusted: render it only through `HtmlContent` (`src/lib/sanitize.ts`).
- Keep credentials out of feeds, items, caches and logs.
- TypeScript uses erasable syntax only (no enums, no parameter properties) so Node can run `e2e/fake-api` directly.
- Add or update tests with behavior changes: unit tests next to the code (`*.test.ts`) and Playwright tests in `e2e/`.
  When a test needs a provider behavior, implement it in the fake API following the provider's documentation.
