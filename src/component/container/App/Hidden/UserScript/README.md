# UserScript

This handle public API for UserScripts like Greasemonkey, browser's extension.

## `window.userScript.getActiveContent(): UserScriptActiveContent | undefined`

Return active content or undefined.

```ts
interface UserScriptActiveContent {
    id: string;
    author: string;
    publishedDate: Date;
    // if is not update, same with publishedDate
    updatedDate: Date;
    title: string;
    body: string;
    url: string;
}
```

## `window.userScript.getActiveSubscription(): UserScriptActiveSubscription | undefined`

Return active subscription or undefined.

```ts
interface UserScriptActiveSubscription {
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
}
```

## `registerKey(keys: string, handler: (event?: Event) => void): void;`

Register shortcut key.


## `trigger(keys: string, action?: string): void`

Trigger exist shortcut key.

## event

### Event List

- `SubscriptionContent::componentDidMount`
- `SubscriptionContent::componentDidUpdate`
- `SubscriptionContent::componentWillUnmount`

### `event.subscribe(event: string, handler: (...args: any[]) => void):void`

Subscript `event` and register `handler` that is called when the `event` is dispatched.

### Example

```js
userScript.event.subscribe("SubscriptionContent::componentDidMount", (content) => {
   const element = document.querySelector(`[data-content-id="${content.contentId}"]`);
   if(element){
      element.querySelector(".SubscriptionContentsContainer-contentTitle").classList.add("ng-content");
      element.querySelector(".SubscriptionContentsContainer-contentBody").setAttribute("hidden", true);
   } 
});
```