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
            res.setHeader('X-Powered-By', 'Express')
        }

        req.res = res
        res.req = req
        req.next = next

        Object.setPrototypeOf(req, app.request)
        Object.setPrototypeOf(res, app.response)

        res.locals = res.locals || {}

        next()
    }
}
