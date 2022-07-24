/**
 * Initialization middleware, exposing the
 * request and response to each other, as well
 * as defaulting the X-Powered-By header field.
 *
 * @param {Function} app
 * @return {Function}
 */

export function init(app) {
    return function expressInit(req, res, next) {
        if (app.enabled('x-powered-by')) {
            res.set('X-Powered-By', 'Express')
        }

        res.next = next

        res.locals = res.locals || {}

        next()
    }
}
