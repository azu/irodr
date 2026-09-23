# User Script API

Irodr exposes `window.userScript` for user scripts (Greasemonkey, Violentmonkey, Tampermonkey, browser extensions).
See [resources/userScript](../resources/userScript) for examples.

## `"userscript-init"` event

Irodr dispatches `userscript-init` on `window` when the API is ready. Listen for it before using `window.userScript`.

```js
window.addEventListener("userscript-init", (event) => {
  // event.detail.userScript === window.userScript
});
```

## `window.userScript.getActiveContent(): UserScriptActiveContent | undefined`

The focused item.

```ts
interface UserScriptActiveContent {
  id: string;
  author: string;
  publishedDate: Date;
  // Same as publishedDate when not updated
  updatedDate: Date;
  title: string;
  body: { content: string };
  url: string;
}
```

## `window.userScript.getActiveSubscription(): UserScriptActiveSubscription | undefined`

The open feed.

```ts
interface UserScriptActiveSubscription {
  title: string;
  // The feed URL, or the site URL when the source has no feed URL (GitHub)
  url: string;
  iconUrl: string;
  htmlUrl: string;
}
```

## `window.userScript.registerKey(keys: string, handler: (event?: Event) => void): void`

Bind a shortcut, e.g. `"n"` or `"shift+n"`. It replaces a default binding of the same keys, as in irodr 1.x.

## `window.userScript.triggerKey(keys: string): void`

Run the handlers bound to `keys`, e.g. `triggerKey("j")` moves to the next item.

## `window.userScript.getDefaultActions()`

The built-in actions by name, e.g. `getDefaultActions()["move-next-content-item"]()`.

## Events

`window.userScript.event.subscribe(event: string, handler: (content) => void): () => void`

| Event                                       | When                                  |
| ------------------------------------------- | ------------------------------------- |
| `SubscriptionContent::componentDidMount`    | An item is rendered                   |
| `SubscriptionContent::componentDidUpdate`   | A rendered item changes or is focused |
| `SubscriptionContent::componentWillUnmount` | An item is removed                    |

`content` has `contentId`, `title`, `url`, `author`, `body` (HTML), `isFocus`, `publishedDate` and `updatedDate`.

## DOM

These class names and attributes are stable for user scripts:

| Selector                                       | Element                         |
| ---------------------------------------------- | ------------------------------- |
| `.SubscriptionContentsContainer`               | The scrolling article view      |
| `.SubscriptionContentsContainer-content`       | An item, with `data-content-id` |
| `.SubscriptionContentsContainer-contentTitle`  | An item's title                 |
| `.SubscriptionContentsContainer-contentBody`   | An item's body                  |
| `.SubscriptionContentsContainer-contentFooter` | An item's footer (dates)        |
| `.SubscriptionListContainer-item`              | A feed, with `data-feedid`      |
| `.ng-content`                                  | Hides an item's content         |

## Example

```js
window.addEventListener("userscript-init", () => {
  userScript.event.subscribe("SubscriptionContent::componentDidMount", (content) => {
    const element = document.querySelector(`[data-content-id="${CSS.escape(content.contentId)}"]`);
    if (element && /^PR:/.test(content.title)) {
      element.querySelector(".SubscriptionContentsContainer-contentTitle").classList.add("ng-content");
      element.querySelector(".SubscriptionContentsContainer-contentBody").setAttribute("hidden", "");
    }
  });
});
```

## Translation

`Shift+T` translates the focused item from English to Japanese with the browser's
[Translator API](https://developer.chrome.com/docs/ai/translator-api). A user script can provide a translator instead:

```js
window.irodrTranslator = {
  async translateBatch(texts, sourceLanguage, targetLanguage) {
    return texts; // translated texts, in the same order
  }
};
```

Irodr uses the Translator API first and the user script's translator when the Translator API is unavailable
(e.g. Firefox and Safari, or Chrome without the language pack). Translation starts at the paragraphs on screen and
continues as the article is scrolled: `translateBatch` receives about 300 characters of text at a time, and link
labels are translated in place so links keep working.

[irodr-translate.user.js](../resources/userScript/irodr-translate.user.js) is a translator with Google Translate.
It calls `translate.googleapis.com/translate_a/single`, the unofficial endpoint that browser extensions such as
[Traduzir-paginas-web](https://github.com/FilipePS/Traduzir-paginas-web) use, through `GM_xmlhttpRequest`
because the endpoint does not allow CORS. The endpoint is not a documented API: Google may rate-limit or change it,
so use it at your own risk. Change `CLIENT` in the script when requests start failing with HTTP 429 or 403.
