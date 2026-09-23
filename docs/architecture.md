# Architecture

Irodr is a client-side single-page application. There is no irodr server: the browser talks to the
providers' APIs directly (Inoreader through a CORS proxy) and keeps credentials and caches in browser storage.

```text
src/
  sources/        Providers. Each one implements the Source contract.
    source.ts       The contract: Source, Feed, Item, SourceCapabilities, SourceSettings
    inoreader/      OAuth 2.0, subscriptions, stream contents, mark-all-as-read
    github/         Notifications API, repository-wide mark read, IndexedDB cache
  app/            The reader: navigation, auto mark-read, prefetch, filter, preferences (no React)
  ui/             React components and browser glue (keyboard shortcuts, user script API)
  lib/            Small utilities (store, IndexedDB key-value store, sanitizer, key bindings)
  main.tsx        Wires sources, reader and UI together
e2e/
  fake-api/       Fake Inoreader and GitHub APIs used by unit and integration tests
  *.spec.ts       Playwright integration tests
lib/
  oxlint-plugin-immutable/  Lint rules for the immutable style (a pnpm workspace package)
```

Dependencies point downwards only: `ui → app → sources → lib`. The UI and the reader never import a
specific source; `src/main.tsx` is the only place that knows which sources exist.

## Code style: functional and immutable

- **No classes**, except `class … extends Error` (kept for `instanceof` and stack traces).
- **A module with behavior is a factory function**, `createX(options): X`. `X` is an exported type of arrow
  functions and readonly values, so callers can pass its functions around without binding `this`.
- **State is an immutable value.** Data that changes over time lives in a store (`createStore` in
  `src/lib/store.ts`) and is replaced with a new value (`store.update((state) => ({ ...state, field }))`).
  State types use `readonly`, `ReadonlyArray`, `ReadonlyMap` and `ReadonlySet`. Never mutate an object that is part
  of the state; build a new one.
- **Transitions are pure functions**, `(state, input) => state` at module scope, so they are tested without sources,
  timers or the network. The factory applies them and then performs the side effects.
- **Side effects stay inside the factory's closure**: network requests, timers, subscriptions. Runtime handles that are
  not state (in-flight promises, `AbortController`s, timer cancel functions, listener sets) may live in a `const`
  `Map` or `Set` there.
- No `let` or `var`, no reassigned parameters, no `Object.assign`. `lib/oxlint-plugin-immutable` and the lint
  configuration in `vite.config.ts` enforce these.
- **Browser support is [Baseline Widely available](https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility)**:
  features supported by Chrome, Edge, Firefox and Safari for at least 2.5 years. Vite's default build target
  (`baseline-widely-available`) lowers syntax, but nothing polyfills built-ins, so `baseline-js/use-baseline`
  (eslint-plugin-baseline-js, web-features data) reports newer built-ins and Web APIs in `src/`. It cannot see
  instance methods such as `Set.prototype.union()` without type information: check those on
  [web-features](https://web-platform-dx.github.io/web-features/). Optional, feature-detected APIs (the
  Translator API) are exempted where they are used.

## Sources

A `Source` (see `src/sources/source.ts`) adapts one provider to the reader:

| Member                        | Responsibility                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `getSnapshot()`/`subscribe()` | Connection state, status message, feeds and the settings form, as an external store |
| `restore(url)`                | Load credentials and caches at startup; handle an OAuth callback URL                |
| `sync()`                      | Refresh feeds and unread counts                                                     |
| `loadItems(feedId, options)`  | Load a page of items, with a continuation for older items                           |
| `markRead(feedId, items)`     | Mark a feed read through the newest of the items the user has seen                  |
| `runAction(id, values)`       | Settings actions (connect, disconnect, filters)                                     |
| `capabilities`                | `loadMore`, `unreadFilter`, `liveItems`: what the UI offers for its feeds           |

Differences between providers are absorbed inside each source:

- Inoreader loads items lazily per feed and marks a whole stream read with `mark-all-as-read`.
- GitHub loads the whole unread inbox into IndexedDB (`liveItems`), and marks a repository read with one
  `PUT /repos/{owner}/{repo}/notifications`.
- Settings are described as data (`SourceSettings`), so the Sources dialog renders every source the same way.

### Adding a source

1. Create `src/sources/<name>/<name>-source.ts` implementing `Source`.
   - Give feeds and items IDs that are unique across sources, e.g. prefixed with your source ID.
   - Change `Feed.revision` whenever a feed's items change, so cached items are reloaded.
   - Keep credentials out of feeds, items and caches.
2. Register it in `src/main.tsx`.
3. Add a fake of the provider's API to `e2e/fake-api/` and route it in `server.ts`.
4. Add unit tests next to the source and integration tests in `e2e/`.

Nothing in `src/app` or `src/ui` needs to change.

## Reader

The reader implements the LDR behavior on top of any sources, in three files:

| File                      | Role                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `src/app/reader-model.ts` | `ReaderModel`, the immutable reading state, and pure transitions over it                 |
| `src/app/reader-view.ts`  | The pure projection from the model and source snapshots to `ReaderState` for the UI      |
| `src/app/reader.ts`       | `createReader`: stores, source subscriptions, loading, prefetch, mark-read, auto refresh |

Its behavior:

- Feeds with unread items are listed by category. Feeds visited within the last 5 navigations stay listed
  after they are read, so the list does not shift while reading.
- Opening another feed marks the departed one read on its source, with the items loaded at that moment;
  items that arrive later stay unread. Shift+S skips without marking read. Reselecting is not navigation.
- The next feeds are prefetched, so `s` usually switches instantly. Pressing `s` again while a feed is
  loading continues from that feed, and only the latest navigation takes effect.
- A failed mark-read keeps the feed unread and shows the error in the header.

The reader is framework independent. React reads it with `useSyncExternalStore`
(`src/ui/context.tsx`), selecting slices so that, for example, scrolling does not re-render the feed list. The
projection keeps unchanged parts of `ReaderState` as the same objects, which is what makes that selection work.

## UI

- React 19 function components and hooks only. React Compiler memoizes components; the build fails if a
  component cannot be compiled (`panicThreshold: "all_errors"`), and Oxlint runs the React Compiler rules.
- StyleX for styles. Stable class names such as `SubscriptionContentsContainer-content` are kept for user
  scripts (`src/ui/dom.ts`). Article HTML is sanitized with an allowlist (`src/lib/sanitize.ts`) and styled by
  `src/global.css`.
- Keyboard shortcuts are a single `keydown` listener (`src/ui/shortcuts.ts`), ignored while typing in form
  fields and while a dialog is open.

## Tests

- Unit tests (`vp test`): the reader with an in-memory source, and each source against the fake APIs.
- Integration tests (`pnpm run test:e2e`): Playwright drives the production build (`vp build --mode e2e`),
  configured by `.env.e2e` to use the fake APIs from `e2e/fake-api/`. The fake APIs implement the documented
  behavior of the real services (OAuth, pagination, read state), and record requests for assertions.
