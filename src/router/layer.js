import pathRegexp from 'path-to-regexp'
import { getLogger, hasOwnProperty } from '../utils'

const debug = getLogger('express:router:layer')

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 */
function decode_param(val) {
    if (typeof val !== 'string' || !val) {
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

        this.handle = fn
        this.name = fn.name || '<anonymous>'
        this.params = undefined
        this.path = undefined
        const keys = []
        // this function will change keys array
        this.regexp = pathRegexp(path, keys, options)
        this.keys = keys

        // set fast path flags
        this.fast_star = path === '*'
        this.fast_slash = path === '/' && options.end === false
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
        const fn = this.handle

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
        const fn = this.handle

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
     * @param {string} path
     * @return {boolean}
     */

    match(path) {
        let match

        this.params = {}

        if (path != null) {
            // fast path non-ending match for / (any path matches)
            if (this.fast_slash) {
                this.path = ''
                return true
            }

            // fast path for * (everything matched in a param)
            if (this.fast_star) {
                this.params[0] = decode_param(path)
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
        this.path = match[0]

        const params = this.params

        for (let i = 1; i < match.length; i++) {
            const key = this.keys[i - 1]
            const prop = key.name
            const val = decode_param(match[i])

            if (val !== undefined || !hasOwnProperty(params, prop)) {
                params[prop] = val
            }
        }

        return true
    }
}
