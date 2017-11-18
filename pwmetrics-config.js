const isCI = Boolean(process.env.CI);
let secret = {};
try {
    secret = require("./pwmetrics.secret");
} catch (error) {}
// pwmerics_url=http://localhost:13245/?ci yarn run  pwmerics
const specificURL = process.env.pwmerics_url;
const targetURL = specificURL ? specificURL : !isCI ? "http://localhost:13245/?ci" : "http://irodr.netlify.com/?ci";
module.exports = {
    url: targetURL,
    sheets: {
        type: "GOOGLE_SHEETS", // sheets service type. Available types: GOOGLE_SHEETS
        options: {
            // https://docs.google.com/spreadsheets/d/16Z3v5sP05Z9KsOeRrnh3rRdUMXTIUDcE4aKhDvfo-mk/edit
            spreadsheetId: "16Z3v5sP05Z9KsOeRrnh3rRdUMXTIUDcE4aKhDvfo-mk",
            tableName: "data"
        }
    },
    clientSecret: secret
};
