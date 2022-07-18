import contentType from 'content-type'
import { format } from 'util'
import generateETag from 'etag'
import proxyaddr from 'proxy-addr'
import qs from 'qs'
import querystring from 'querystring'
import { Buffer } from 'safe-buffer'
import { mime } from 'send'

export const getLogger =
    namespace =>
    (...args) => {
        if (process.env.EXPRESS_DEBUG) {
            console.log(format('[%s] %s', namespace, format(...args)))
        }
    }

export const deprecate = msg => {
    if (process.noDeprecation) {
        return
    }
    if (
        process.env.NO_DEPRECATION &&
        process.env.NO_DEPRECATION.includes('express')
    ) {
        return
    }
    console.warn(`express:deprecate:${msg}`)
}

export const methods = ['get', 'post', 'put', 'head', 'delete', 'options']

export const hasOwnProperty = Object.prototype.hasOwnProperty.call.bind(
    Object.prototype.hasOwnProperty
)

/**
 * Check if `path` looks absolute.
 *
 * @param {String} path
 * @return {Boolean}
 */
export const isAbsolute = path => {
    if ('/' === path[0]) {
        return true
    }
    if (':' === path[1] && ('\\' === path[2] || '/' === path[2])) {
        // Windows device path
        return true
    }
    if ('\\\\' === path.substring(0, 2)) {
        // Microsoft Azure absolute path
        return true
    }
}

/**
 * Parse accept params `str` returning an
 * object with `.value`, `.quality` and `.params`.
 * also includes `.originalIndex` for stable sorting
 *
 * @param {String} str
 * @param {Number} index
 * @return {Object}
 */
function acceptParams(str, index) {
    let parts = str.split(/ *; */)
    let ret = {
        value: parts[0],
        quality: 1,
        params: {},
        originalIndex: index,
    }

    parts.forEach(part => {
        let pms = part.split(/ *= */)
        if ('q' === pms[0]) {
            ret.quality = parseFloat(pms[1])
        } else {
            ret.params[pms[0]] = pms[1]
        }
    })

    return ret
}

/**
 * Normalize the given `type`, for example "html" becomes "text/html".
 *
 * @param {String} type
 * @return {Object}
 */

export const normalizeType = type =>
    ~type.indexOf('/')
        ? acceptParams(type)
        : { value: mime.lookup(type), params: {} }

/**
 * Normalize `types`, for example "html" becomes "text/html".
 *
 * @param {Array} types
 * @return {Array}
 */

export const normalizeTypes = types => types.map(type => normalizeType(type))

/**
 * Compile "etag" value to function.
 *
 * @param  {Boolean|String|Function} val
 * @return {Function}
 */

export const compileETag = val => {
    if (typeof val === 'function') {
        return val
    }

    /**
     * Create an ETag generator function, generating ETags with
     * the given options.
     *
     * @param {object} options
     * @return {function}
     */

    function createETagGenerator(options) {
        return (body, encoding) =>
            generateETag(
                !Buffer.isBuffer(body) ? Buffer.from(body, encoding) : body,
                options
            )
    }

    switch (val) {
        case true:
        case 'weak':
            return createETagGenerator({ weak: true })
        case false:
            return undefined
        case 'strong':
            return createETagGenerator({ weak: false })
        default:
            throw new TypeError('unknown value for etag function: ' + val)
    }
}

/**
 * Compile "query parser" value to function.
 *
 * @param  {String|Function} val
 * @return {Function}
 */

export const compileQueryParser = val => {
    if (typeof val === 'function') {
        return val
    }

    switch (val) {
        case true:
        case 'simple':
            return querystring.parse
        case false:
            return () => ({})
        case 'extended':
            // Parse an extended query string with qs.
            return str =>
                qs.parse(str, {
                    allowPrototypes: true,
                })
        default:
            throw new TypeError(
                'unknown value for query parser function: ' + val
            )
    }
}

/**
 * Compile "proxy trust" value to function.
 *
 * @param  {Boolean|String|Number|Array|Function} val
 * @return {Function}
 */

export const compileTrust = val => {
    if (typeof val === 'function') {
        return val
    }

    if (val === true) {
        // Support plain true/false
        return function () {
            return true
        }
    }

    if (typeof val === 'number') {
        // Support trusting hop count
        return function (_a, i) {
            return i < val
        }
    }

    if (typeof val === 'string') {
        // Support comma-separated values
        val = val.split(',').map(function (v) {
            return v.trim()
        })
    }

    return proxyaddr.compile(val || [])
}

/**
 * Set the charset in a given Content-Type string.
 *
 * @param {String} type
 * @param {String} charset
 * @return {String}
 */

export const setCharset = (type, charset) => {
    if (!type || !charset) {
        return type
    }

    // parse type
    const parsed = contentType.parse(type)

    // set charset
    parsed.parameters.charset = charset

    // format type
    return contentType.format(parsed)
}
