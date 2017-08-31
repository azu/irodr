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