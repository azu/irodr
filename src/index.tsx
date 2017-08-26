import * as React from 'react';
import * as ReactDOM from 'react-dom';
import App from './App';
import registerServiceWorker from './registerServiceWorker';
import './index.css';
import { getToken, getNewTokenUrl, saveTokenFromCallbackURL } from "./auth";
import { Token } from "client-oauth2";

const request = (token: Token) => {
    // Sign API requests on behalf of the current user.
    const requestObject = token.sign({
        method: 'get',
        url: 'https://www.inoreader.com/reader/api/0/user-info'
    });
    const headers = new Headers();
    Object.keys((requestObject as any).headers).forEach(key => {
        headers.append(key, (requestObject as any).headers[key])
    });
    console.log(requestObject);
    return fetch(requestObject.url, {
        method: requestObject.method,
        headers: headers,
        mode: "cors"
    })
        .then(res => res.json())
        .then(function (res: any) {
            console.log(res) //=> { body: { ... }, status: 200, headers: { ... } }
        })
};
if (location.search.includes("?code")) {
    saveTokenFromCallbackURL(location.href).then(token => {
        console.log(token);
        history.replaceState("", "", "/");
        request(token);
    });
} else {
    getToken().then(token => {
        request(token);
    }).catch((error) => {
        location.href = getNewTokenUrl();
    });
}
ReactDOM.render(
    <App/>,
    document.getElementById('root') as HTMLElement
);
registerServiceWorker();
