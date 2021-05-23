const proxy = require("http-proxy-middleware");
module.exports = function (app) {
    app.use(
        "/cors",
        proxy({
            target: "https://jp.inoreader.com/",
            pathRewrite: {
                "^/cors": ""
            },
            changeOrigin: true
        })
    );
    app.use(
        "/api",
        proxy({
            target: "https://jp.inoreader.com/reader",
            changeOrigin: true
        })
    );
};
