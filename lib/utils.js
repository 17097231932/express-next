import { Buffer } from 'safe-buffer'
import contentType from 'content-type'
import { mime } from 'send'
import generateETag from 'etag'
import proxyaddr from 'proxy-addr'
import qs from 'qs'
import querystring from 'querystring'

/**
 * Return strong ETag for `body`.
 *
 * @param {String|Buffer} body
 * @param {String} [encoding]
 * @return {String}
 * @api private
 */

export const etag = createETagGenerator({ weak: false })

/**
 * Return weak ETag for `body`.
 *
 * @param {String|Buffer} body
 * @param {String} [encoding]
 * @return {String}
 * @api private
 */

export const wetag = createETagGenerator({ weak: true })

/**
 * Check if `path` looks absolute.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

export const isAbsolute = function (path) {
    if ('/' === path[0]) return true
    if (':' === path[1] && ('\\' === path[2] || '/' === path[2])) return true // Windows device path
    if ('\\\\' === path.substring(0, 2)) return true // Microsoft Azure absolute path
}

/**
 * Normalize the given `type`, for example "html" becomes "text/html".
 *
 * @param {String} type
 * @return {Object}
 * @api private
 */

export const normalizeType = function (type) {
    return ~type.indexOf('/')
        ? acceptParams(type)
        : { value: mime.lookup(type), params: {} }
}

/**
 * Normalize `types`, for example "html" becomes "text/html".
 *
 * @param {Array} types
 * @return {Array}
 * @api private
 */

export const normalizeTypes = function (types) {
    var ret = []

    for (var i = 0; i < types.length; ++i) {
        ret.push(normalizeType(types[i]))
    }

    return ret
}

/**
 * Parse accept params `str` returning an
 * object with `.value`, `.quality` and `.params`.
 * also includes `.originalIndex` for stable sorting
 *
 * @param {String} str
 * @param {Number} index
 * @return {Object}
 * @api private
 */

function acceptParams(str, index) {
    var parts = str.split(/ *; */)
    var ret = { value: parts[0], quality: 1, params: {}, originalIndex: index }

    for (var i = 1; i < parts.length; ++i) {
        var pms = parts[i].split(/ *= */)
        if ('q' === pms[0]) {
            ret.quality = parseFloat(pms[1])
        } else {
            ret.params[pms[0]] = pms[1]
        }
    }

    return ret
}

/**
 * Compile "etag" value to function.
 *
 * @param  {Boolean|String|Function} val
 * @return {Function}
 * @api private
 */

export const compileETag = function (val) {
    var fn

    if (typeof val === 'function') {
        return val
    }

    switch (val) {
        case true:
        case 'weak':
            fn = wetag
            break
        case false:
            break
        case 'strong':
            fn = etag
            break
        default:
            throw new TypeError('unknown value for etag function: ' + val)
    }

    return fn
}

/**
 * Compile "query parser" value to function.
 *
 * @param  {String|Function} val
 * @return {Function}
 * @api private
 */

export const compileQueryParser = function compileQueryParser(val) {
    var fn

    if (typeof val === 'function') {
        return val
    }

    switch (val) {
        case true:
        case 'simple':
            fn = querystring.parse
            break
        case false:
            fn = newObject
            break
        case 'extended':
            fn = parseExtendedQueryString
            break
        default:
            throw new TypeError(
                'unknown value for query parser function: ' + val
            )
    }

    return fn
}

/**
 * Compile "proxy trust" value to function.
 *
 * @param  {Boolean|String|Number|Array|Function} val
 * @return {Function}
 * @api private
 */

export const compileTrust = function (val) {
    if (typeof val === 'function') return val

    if (val === true) {
        // Support plain true/false
        return function () {
            return true
        }
    }

    if (typeof val === 'number') {
        // Support trusting hop count
        return function (a, i) {
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
 * @api private
 */

export const setCharset = function setCharset(type, charset) {
    if (!type || !charset) {
        return type
    }

    // parse type
    var parsed = contentType.parse(type)

    // set charset
    parsed.parameters.charset = charset

    // format type
    return contentType.format(parsed)
}

/**
 * Create an ETag generator function, generating ETags with
 * the given options.
 *
 * @param {object} options
 * @return {function}
 * @private
 */

function createETagGenerator(options) {
    return (body, encoding) => {
        var buf = !Buffer.isBuffer(body) ? Buffer.from(body, encoding) : body

        return generateETag(buf, options)
    }
}

/**
 * Parse an extended query string with qs.
 *
 * @return {Object}
 * @private
 */

function parseExtendedQueryString(str) {
    return qs.parse(str, {
        allowPrototypes: true,
    })
}

/**
 * Return new empty object.
 *
 * @return {Object}
 * @api private
 */

function newObject() {
    return {}
}
