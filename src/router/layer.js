import pathRegexp from 'path-to-regexp'
import { getLogger } from '../utils'

const debug = getLogger('express:router:layer')

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 */
function decode_param(val) {
    if (typeof val !== 'string' || val.length === 0) {
        return val
    }

    try {
        return decodeURIComponent(val)
    } catch (err) {
        if (err instanceof URIError) {
            err.message = "Failed to decode param '" + val + "'"
            err.status = err.statusCode = 400
        }

        throw err
    }
}

export default class Layer {
    constructor(path, options, fn) {
        debug('new %o', path)
        var opts = options || {}

        this.handle = fn
        this.name = fn.name || '<anonymous>'
        this.params = undefined
        this.path = undefined
        this.regexp = pathRegexp(path, (this.keys = []), opts)

        // set fast path flags
        this.regexp.fast_star = path === '*'
        this.regexp.fast_slash = path === '/' && opts.end === false
    }

    /**
     * Handle the error for the layer.
     *
     * @param {Error} error
     * @param {Request} req
     * @param {Response} res
     * @param {function} next
     */

    handle_error(error, req, res, next) {
        var fn = this.handle

        if (fn.length !== 4) {
            // not a standard error handler
            return next(error)
        }

        try {
            fn(error, req, res, next)
        } catch (err) {
            next(err)
        }
    }

    /**
     * Handle the request for the layer.
     *
     * @param {Request} req
     * @param {Response} res
     * @param {function} next
     */
    handle_request(req, res, next) {
        var fn = this.handle

        if (fn.length > 3) {
            // not a standard request handler
            return next()
        }

        try {
            fn(req, res, next)
        } catch (err) {
            next(err)
        }
    }

    /**
     * Check if this route matches `path`, if so
     * populate `.params`.
     *
     * @param {String} path
     * @return {Boolean}
     */

    match(path) {
        var match

        if (path != null) {
            // fast path non-ending match for / (any path matches)
            if (this.regexp.fast_slash) {
                this.params = {}
                this.path = ''
                return true
            }

            // fast path for * (everything matched in a param)
            if (this.regexp.fast_star) {
                this.params = { 0: decode_param(path) }
                this.path = path
                return true
            }

            // match the path
            match = this.regexp.exec(path)
        }

        if (!match) {
            this.params = undefined
            this.path = undefined
            return false
        }

        // store values
        this.params = {}
        this.path = match[0]

        var keys = this.keys
        var params = this.params

        for (var i = 1; i < match.length; i++) {
            var key = keys[i - 1]
            var prop = key.name
            var val = decode_param(match[i])

            if (
                val !== undefined ||
                !Object.prototype.hasOwnProperty.call(params, prop)
            ) {
                params[prop] = val
            }
        }

        return true
    }
}
