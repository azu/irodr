const isCI = Boolean(process.env.CI);
let secret = {};
try {
    secret = require("./pwmetrics.secret");
} catch (error) {}
module.exports = {
    url: !isCI ? "http://localhost:13245/?ci" : "http://irodr.netlify.com/?ci",
    sheets: {
        type: "GOOGLE_SHEETS", // sheets service type. Available types: GOOGLE_SHEETS
        options: {
            spreadsheetId: "16Z3v5sP05Z9KsOeRrnh3rRdUMXTIUDcE4aKhDvfo-mk",
            tableName: "data"
        }
    },
    clientSecret: secret
};
