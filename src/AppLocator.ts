// MIT © 2017 azu
import { Context } from "almin";
/**
 * Locator is a singleton.
 */
let _context: Context<any> | null = null;
export const appLocator = {
    get context(): Context<any> {
        return _context!;
    },
    set context(context: Context<any>) {
        _context = context;
    }
};
