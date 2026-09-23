# irodr-local

irodr-local is an optional single executable that serves irodr on `http://127.0.0.1:18888/` and adds features a
browser cannot provide by itself. Any browser (Firefox, Safari, Chrome) can use them, since the page and the API
share one origin. The first feature is on-device translation with Apple's
[Translation framework](https://developer.apple.com/documentation/translation) on macOS. Local LLMs are planned.

irodr on Netlify keeps working without it: the local API is detected at runtime, and a missing API means the feature
falls back to what the browser offers.

```text
Browser ── http://127.0.0.1:18888 ──> irodr-local (Node single executable)
                                        ├─ /            the built app (dist/, embedded)
                                        ├─ /api/*       local API
                                        ├─ /cors-proxy/ Inoreader proxy (same as the Netlify edge function)
                                        └─ stdin/stdout ──> irodr-translate (Swift, embedded, macOS)
                                                              └─ Translation framework (on device)
```

## Build and run

```sh
# macOS: the translation helper (Swift 6, macOS 26+). vp pack embeds it when it exists.
swift build -c release --package-path swift/irodr-translate
# The app and the executable. Node's Single Executable Applications need Node.js 25.7+ to build,
# e.g. without switching the Node.js of your shell:
npx -p node@26 -- pnpm run build:local
./build/irodr-local            # http://127.0.0.1:18888/
./build/irodr-local --port 18889
```

During development, run the server from source against `dist/`, with the fake translator on any OS:

```sh
vp build && node server/main.ts --translator server/fake-translator.ts
```

Options: `--port` (default 18888), `--dist` (serve a directory instead of the embedded app) and `--translator` (the
translation helper to run instead of the embedded one).

### Inoreader

The page's origin is `http://127.0.0.1:<port>`, so:

- Inoreader redirects back to `http://127.0.0.1:<port>/` after login. Register that redirect URI in your own
  [Inoreader app](https://www.inoreader.com/developers/) and enter its client ID and secret in Sources.
- Browser storage (credentials, caches, preferences) belongs to the origin. Keep the same port, and log in once for
  irodr-local separately from irodr.netlify.app.

## Local API

The web app uses it through `src/lib/local-api.ts`. `e2e/fake-api/local.ts` implements it for tests under `/local`.

| Request                                               | Response                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/local`                                      | `{ "name": "irodr-local", "version": "…", "features": [...] }`   |
| `POST /api/translate` with `texts`                    | `{ "texts": ["…"] }`                                             |
| `POST /api/translate` with `segments`                 | `{ "segments": [...] }` (needs the `translate-segments` feature) |
| `POST /api/translate` with `texts` and `stream: true` | NDJSON results (needs the `translate-stream` feature)            |

A translate request is `{ "texts": ["…"], "sourceLanguage": "en", "targetLanguage": "ja" }`, or `segments` instead of
`texts`. Errors are `{ "error": "…" }` with a 4xx/5xx status.

A segment is a paragraph with its inline markup: `{ "runs": [{ "text": "Read " }, { "text": "the docs", "tag": 0 }] }`.
A run's `tag` names the inline element around it (`<a>`, `<strong>`, ...) and `skip` marks code. The segments API
asks the framework to preserve those attributes; their preservation is not guaranteed.

`features` lists what the server can do, e.g. `"translate"` when a translation helper is available.

`Shift+T` uses the local server first, then the browser Translator API, then a user script translator
(docs/userscript.md). It sends only plain `texts`, even when the server supports segments. Link labels are
translated in the same batches as surrounding text, while the link elements, destinations and nested formatting
stay intact. A translated link's `title` contains its entire original label, for hover access to the English.
Turning translation off restores its previous `title` exactly (including absent or empty titles). Code stays
unchanged. Text nodes are replaced in place (`src/ui/translate-dom.ts`), with no second translation to recover
lost markup. Link labels and surrounding text are separate translation inputs, so context is limited across
those boundaries. Including labels adds translation work, but no link-specific request or retry.

## Security

The server runs on the user's machine, and any web page can send requests to localhost. So it:

- listens on `127.0.0.1` only;
- accepts only its own `Host` (`127.0.0.1:<port>` or `localhost:<port>`), against DNS rebinding;
- rejects requests whose `Origin` is another site, and requires `Content-Type: application/json` for the API, so
  cross-site requests need a CORS preflight that it never answers;
- proxies to Inoreader's origins only, forwarding only the headers the API needs (no cookies).

## Translation helper

`swift/irodr-translate` is a small Swift executable that speaks JSON lines over stdin/stdout
(`server/translator-process.ts` documents the protocol). It uses `TranslationSession(installedSource:target:)`, which
translates without UI on macOS 26 and later, like [hotchpotch/trn](https://github.com/hotchpotch/trn). Language
packages must be installed in System Settings > General > Language & Region > Translation Languages; otherwise the
helper returns an error that irodr shows in the header.

Segments are translated as `AttributedString`s: the framework keeps formatting on the translated words
([`translate(_:)`](<https://developer.apple.com/documentation/translation/translationsession/translate(_:)-59zi2>)).
Tags travel as `irodr-tag:<n>` links and code as
[`skipsTranslation`](https://developer.apple.com/documentation/foundation/attributescopes/translationattributes/skipstranslation)
(macOS 26.4+). On older macOS, each segment is translated as plain text without its markup.

For speed, the helper asks for the `lowLatency` strategy (traditional models, macOS 26.4+) and translates requests
with [`translate(batch:)`](<https://developer.apple.com/documentation/translation/translationsession/translate(batch:)>).
Each completed input text is sent immediately through stdout and HTTP to the browser, without waiting for the
rest of its batch. The response is newline-delimited JSON: `{ "index": 0, "text": "…" }` for each input,
then `{ "done": true }`, or `{ "error": "…" }` on failure. Indices refer to the request's `texts` array;
results may arrive out of order. A closed connection without the terminal message is an error, not success.

The page sends one batch of about 1,000 characters at a time, prioritizing text currently visible in the article
scroller. It re-measures the viewport between batches, prefetches at most the next screen, and resumes on scroll
or resize. Paragraphs are not cut to meet the character budget. Inline text pieces in the same paragraph are
displayed together once that paragraph is ready, without waiting for the other paragraphs in the batch. This
changes display granularity, not translation context: links still separate input texts. The visible paragraph
is kept anchored when earlier text changes height. Scrolling or keyboard navigation into a
different article cancels the previous request and translates the new article. Turning translation off restores
the original text and cancels the HTTP request and native translation session.

Older servers and userscripts without streaming still work, using smaller, approximately 300-character batches.
The browser's own Translator API also updates each text as it finishes. The one-batch limit controls submitted
work, not the undocumented number of model operations the system runs in parallel.

`irodr-local` keeps completed text translations in a process-local cache keyed by the exact original text and
source/target languages. Repeated texts in a batch are translated once. Cache hits are streamed immediately;
only misses go to the helper. The cache holds at most 1,000 entries and 500,000 characters of keys and results,
evicting least recently used entries. Turning translation off or reloading the page does not discard it, but
restarting the server does. It never writes article text or translations to disk, and failures are not cached.

The helper is a separate process because the Translation framework is only available from Swift. The executable
embeds it and writes it to `~/Library/Caches/irodr-local/` on first use, since a process can only be started from a
file.
