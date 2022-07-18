import { parse } from 'url'
import qs from 'qs'

/**
 * @param {Object|Function} options
 * @return {Function}
 */

export default function query(options) {
    let parseFn = qs.parse

    if (typeof options === 'function') {
        parseFn = options
        options = undefined
    }

    if (options !== undefined && options.allowPrototypes === undefined) {
        // back-compat for qs module
        options.allowPrototypes = true
    }

    return function query(req, res, next) {
        if (!req.query) {
            const val = parse(req.url).query
            req.query = parseFn(val, options)
        }

        next()
    }
}
