import { parse } from 'url'
import qs from 'qs'

/**
 * @param {Object|Function} options
 * @return {Function}
 */

export default function query(options) {
    var opts = Object.assign({}, options)
    var queryparse = qs.parse

    if (typeof options === 'function') {
        queryparse = options
        opts = undefined
    }

    if (opts !== undefined && opts.allowPrototypes === undefined) {
        // back-compat for qs module
        opts.allowPrototypes = true
    }

    return function query(req, res, next) {
        if (!req.query) {
            var val = parse(req.url).query
            req.query = queryparse(val, opts)
        }

        next()
    }
}
