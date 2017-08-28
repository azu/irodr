# irodr

RSS reader client for [Inoreader](http://www.inoreader.com/ "Inoreader").

It aim to work on browser/electron.

![screenshot](https://media.giphy.com/media/3o7aD1E8CZAirML9WE/giphy.gif)

## Purpose

- Fast read
    - Prefetch
    - Mark as "read" at idle time
- Customizable for user
    - [ ] We will provide some API like `window.getActiveItem` for UserScript.
- Allow of other RSS reader API like Feedly
    - Domain model should not depended on Inoreader
- Welcome to Pull Request

## Usage

    npm start

This server is also proxy server.

## :memo: Notes

- Inoreader doesn't support CORS
    - Please support CORS :bow:
    - [x] Comment to [Inoreader Developers - User authentication via OAuth 2.0](http://www.inoreader.com/developers/oauth "Inoreader Developers - User authentication via OAuth 2.0")
- Currently, We need CORS proxy in `package.json`
    - In other word, require proxy or proxy server

## Changelog

See [Releases page](https://github.com/azu/irodr/releases).

## Running tests

Install devDependencies and Run `npm test`:

    npm i -d && npm test

## Contributing

Pull requests and stars are always welcome.

For bugs and feature requests, [please create an issue](https://github.com/azu/irodr/issues).

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## Author

- [github/azu](https://github.com/azu)
- [twitter/azu_re](https://twitter.com/azu_re)

## License

MIT © azu
