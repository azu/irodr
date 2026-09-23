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

| Request               | Body                                                                 | Response                                                       |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /api/local`      |                                                                      | `{ "name": "irodr-local", "version": "…", "features": [...] }` |
| `POST /api/translate` | `{ "texts": ["…"], "sourceLanguage": "en", "targetLanguage": "ja" }` | `{ "texts": ["…"] }`, or `{ "error": "…" }` with 4xx/5xx       |

`features` lists what the server can do, e.g. `"translate"` when a translation helper is available.

`Shift+T` uses the local server first, then the browser Translator API, then a user script translator
(docs/userscript.md).

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

For speed, the helper asks for the `lowLatency` strategy (traditional models, macOS 26.4+) and translates requests
concurrently. The page sends a long article in parts of about 1,000 characters, up to 4 at a time from the top, and
shows each part as soon as it is translated.

The helper is a separate process because the Translation framework is only available from Swift. The executable
embeds it and writes it to `~/Library/Caches/irodr-local/` on first use, since a process can only be started from a
file.
