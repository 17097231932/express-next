import accepts from 'accepts'
import fresh from 'fresh'
import { isIP } from 'net'
import proxyaddr, { all } from 'proxy-addr'
import parseRange from 'range-parser'
import typeis from 'type-is'
import { parse } from 'url'
import { deprecate, hasOwnProperty } from './utils'

export default class Request {
    /**
     *
     * @param {IncomingMessage} req
     * @param {Application} app
     */
    constructor(req, app) {
        /**
         * @type {import('http').IncomingMessage}
         */
        this.originalRequest = req
        /**
         * @type {Application}
         */
        this.app = app

        this._wrapedRequestCache = null
    }

    get _wrapedRequest() {
        if (this._wrapedRequestCache === null) {
            const instance = this
            this._wrapedRequestCache = new Proxy(this.originalRequest, {
                get(target, p) {
                    if (Reflect.has(instance, p)) {
                        return Reflect.get(instance, p)
                    }
                    return Reflect.get(target, p)
                },
                set(target, p, value) {
                    if (Reflect.has(target, p)) {
                        return Reflect.set(target, p, value)
                    }
                    return Reflect.set(instance, p, value)
                },
            })
        }

        return this._wrapedRequestCache
    }

    /**
     * Create a Request object.
     * @param {IncomingMessage} req
     * @param {Application} app
     * @returns {Request}
     */
    static fromIncomingMessage(req, app) {
        return new this(req, app)._wrapedRequest
    }

    /**
     * Return the protocol string "http" or "https"
     * when requested with TLS. When the "trust proxy"
     * setting trusts the socket address, the
     * "X-Forwarded-Proto" header field will be trusted
     * and used if present.
     *
     * If you're running behind a reverse proxy that
     * supplies https for you this may be enabled.
     *
     * @return {String}
     */

    get protocol() {
        const proto = this.originalRequest.socket.encrypted ? 'https' : 'http'
        const trust = this.app.get('trust proxy fn')

        if (!trust(this.originalRequest.socket.remoteAddress, 0)) {
            return proto
        }

        // Note: X-Forwarded-Proto is normally only ever a
        //       single value, but this is to be safe.
        const header = this.get('X-Forwarded-Proto') || proto
        const index = header.indexOf(',')

        return index !== -1 ? header.substring(0, index).trim() : header.trim()
    }

    /**
     * Short-hand for:
     *
     *    req.protocol === 'https'
     *
     * @return {Boolean}
     */

    get secure() {
        return this.protocol === 'https'
    }

    /**
     * Return the remote address from the trusted proxy.
     *
     * The is the remote address on the socket unless
     * "trust proxy" is set.
     *
     * @return {String}
     */

    get ip() {
        const trust = this.app.get('trust proxy fn')
        return proxyaddr(this.originalRequest, trust)
    }

    /**
     * When "trust proxy" is set, trusted proxy addresses + client.
     *
     * For example if the value were "client, proxy1, proxy2"
     * you would receive the array `["client", "proxy1", "proxy2"]`
     * where "proxy2" is the furthest down-stream and "proxy1" and
     * "proxy2" were trusted.
     *
     * @return {Array}
     */

    get ips() {
        const trust = this.app.get('trust proxy fn')
        const addrs = all(this.originalRequest, trust)

        // reverse the order (to farthest -> closest)
        // and remove socket address
        addrs.reverse().pop()

        return addrs
    }

    /**
     * Return subdomains as an array.
     *
     * Subdomains are the dot-separated parts of the host before the main domain of
     * the app. By default, the domain of the app is assumed to be the last two
     * parts of the host. This can be changed by setting "subdomain offset".
     *
     * For example, if the domain is "tobi.ferrets.example.com":
     * If "subdomain offset" is not set, req.subdomains is `["ferrets", "tobi"]`.
     * If "subdomain offset" is 3, req.subdomains is `["tobi"]`.
     *
     * @return {Array}
     */
    get subdomains() {
        const hostname = this.hostname

        if (!hostname) return []

        const offset = this.app.get('subdomain offset')
        const subdomains = !isIP(hostname)
            ? hostname.split('.').reverse()
            : [hostname]

        return subdomains.slice(offset)
    }

    /**
     * Short-hand for `url.parse(req.url).pathname`.
     *
     * @return {String}
     */
    get path() {
        return parse(this.originalRequest.url).pathname
    }

    /**
     * Parse the "Host" header field to a hostname.
     *
     * When the "trust proxy" setting trusts the socket
     * address, the "X-Forwarded-Host" header field will
     * be trusted.
     *
     * @return {String}
     */

    get hostname() {
        const trust = this.app.get('trust proxy fn')
        let host = this.get('X-Forwarded-Host')

        if (!host || !trust(this.originalRequest.socket.remoteAddress, 0)) {
            host = this.get('Host')
        } else if (host.indexOf(',') !== -1) {
            // Note: X-Forwarded-Host is normally only ever a
            //       single value, but this is to be safe.
            host = host.substring(0, host.indexOf(',')).trimEnd()
        }

        if (!host) return

        // IPv6 literal support
        const offset = host[0] === '[' ? host.indexOf(']') + 1 : 0
        const index = host.indexOf(':', offset)

        return index !== -1 ? host.substring(0, index) : host
    }

    // TODO: change req.host to return host in next major

    get host() {
        deprecate('req.host: Use req.hostname instead')
        return this.hostname
    }

    /**
     * Check if the request is fresh, aka
     * Last-Modified and/or the ETag
     * still match.
     *
     * @return {Boolean}
     */

    get fresh() {
        const status = this.res.statusCode

        // GET or HEAD for weak freshness validation only
        if (!['GET', 'HEAD'].includes(this.originalRequest.method))
            return false

        // 2xx or 304 as per rfc2616 14.26
        if ((status >= 200 && status < 300) || 304 === status) {
            return fresh(this.originalRequest.headers, {
                etag: this.res.get('ETag'),
                'last-modified': this.res.get('Last-Modified'),
            })
        }

        return false
    }

    /**
     * Check if the request is stale, aka
     * "Last-Modified" and / or the "ETag" for the
     * resource has changed.
     *
     * @return {Boolean}
     */

    get stale() {
        return !this.fresh
    }

    /**
     * Check if the request was an _XMLHttpRequest_.
     *
     * @return {Boolean}
     */

    get xhr() {
        const val = this.get('X-Requested-With') || ''
        return val.toLowerCase() === 'xmlhttprequest'
    }

    /**
     * Return request header.
     *
     * The `Referrer` header field is special-cased,
     * both `Referrer` and `Referer` are interchangeable.
     *
     * Examples:
     *
     *     req.get('Content-Type');
     *     // => "text/plain"
     *
     *     req.get('content-type');
     *     // => "text/plain"
     *
     *     req.get('Something');
     *     // => undefined
     *
     * Aliased as `req.header()`.
     *
     * @param {String} name
     * @return {String}
     */

    get(name) {
        if (!name) {
            throw new TypeError('name argument is required to req.get')
        }

        if (typeof name !== 'string') {
            throw new TypeError('name must be a string to req.get')
        }

        const lc = name.toLowerCase()

        switch (lc) {
            case 'referer':
            case 'referrer':
                return (
                    this.originalRequest.headers.referrer ||
                    this.originalRequest.headers.referer
                )
            default:
                return this.originalRequest.headers[lc]
        }
    }

    header(name) {
        return this.get(name)
    }

    /**
     * To do: update docs.
     *
     * Check if the given `type(s)` is acceptable, returning
     * the best match when true, otherwise `undefined`, in which
     * case you should respond with 406 "Not Acceptable".
     *
     * The `type` value may be a single MIME type string
     * such as "application/json", an extension name
     * such as "json", a comma-delimited list such as "json, html, text/plain",
     * an argument list such as `"json", "html", "text/plain"`,
     * or an array `["json", "html", "text/plain"]`. When a list
     * or array is given, the _best_ match, if any is returned.
     *
     * Examples:
     *
     *     // Accept: text/html
     *     req.accepts('html');
     *     // => "html"
     *
     *     // Accept: text/*, application/json
     *     req.accepts('html');
     *     // => "html"
     *     req.accepts('text/html');
     *     // => "text/html"
     *     req.accepts('json, text');
     *     // => "json"
     *     req.accepts('application/json');
     *     // => "application/json"
     *
     *     // Accept: text/*, application/json
     *     req.accepts('image/png');
     *     req.accepts('png');
     *     // => undefined
     *
     *     // Accept: text/*;q=.5, application/json
     *     req.accepts(['html', 'json']);
     *     req.accepts('html', 'json');
     *     req.accepts('html, json');
     *     // => "json"
     *
     * @param {String|Array} type(s)
     * @return {String|Array|Boolean}
     */

    accepts(...args) {
        return accepts(this.originalRequest).types(...args)
    }

    /**
     * Check if the given `encoding`s are accepted.
     *
     * @param {String} ...encoding
     * @return {String|Array}
     */

    acceptsEncodings(...args) {
        return accepts(this.originalRequest).encodings(...args)
    }

    acceptsEncoding(...args) {
        deprecate('req.acceptsEncoding: Use acceptsEncodings instead')
        return this.acceptsEncodings(...args)
    }

    /**
     * Check if the given `charset`s are acceptable,
     * otherwise you should respond with 406 "Not Acceptable".
     *
     * @param {String} ...charset
     * @return {String|Array}
     */

    acceptsCharsets(...args) {
        return accepts(this.originalRequest).charsets(...args)
    }

    acceptsCharset(...args) {
        deprecate('req.acceptsCharset: Use acceptsCharsets instead')
        return this.acceptsCharsets(...args)
    }

    /**
     * Check if the given `lang`s are acceptable,
     * otherwise you should respond with 406 "Not Acceptable".
     *
     * @param {String} ...lang
     * @return {String|Array}
     */

    acceptsLanguages(...args) {
        return accepts(this.originalRequest).languages(...args)
    }

    acceptsLanguage(...args) {
        deprecate('req.acceptsLanguage: Use acceptsLanguages instead')
        return this.acceptsLanguages(...args)
    }

    /**
     * Parse Range header field, capping to the given `size`.
     *
     * Unspecified ranges such as "0-" require knowledge of your resource length. In
     * the case of a byte range this is of course the total number of bytes. If the
     * Range header field is not given `undefined` is returned, `-1` when unsatisfiable,
     * and `-2` when syntactically invalid.
     *
     * When ranges are returned, the array has a "type" property which is the type of
     * range that is required (most commonly, "bytes"). Each array element is an object
     * with a "start" and "end" property for the portion of the range.
     *
     * The "combine" option can be set to `true` and overlapping & adjacent ranges
     * will be combined into a single range.
     *
     * NOTE: remember that ranges are inclusive, so for example "Range: users=0-3"
     * should respond with 4 users when available, not 3.
     *
     * @param {number} size
     * @param {object} [options]
     * @param {boolean} [options.combine=false]
     * @return {number|array}
     */

    range(size, options) {
        const range = this.header('Range')
        if (!range) return
        return parseRange(size, range, options)
    }

    /**
     * Return the value of param `name` when present or `defaultValue`.
     *
     *  - Checks route placeholders, ex: _/user/:id_
     *  - Checks body params, ex: id=12, {"id":12}
     *  - Checks query string params, ex: ?id=12
     *
     * To utilize request bodies, `req.body`
     * should be an object. This can be done by using
     * the `bodyParser()` middleware.
     *
     * @param {String} name
     * @param {Mixed} [defaultValue]
     * @return {String}
     */

    param(name, defaultValue) {
        deprecate('req.param: Use req.params, req.body, or req.query instead')

        function exist(value) {
            return value !== undefined && value !== null
        }

        const params = this.params || {}
        const body = this.body || {}
        const query = this.query || {}

        if (exist(params[name]) && hasOwnProperty(params, name)) {
            return params[name]
        }
        if (exist(body[name])) {
            return body[name]
        }
        if (exist(query[name])) {
            return query[name]
        }

        return defaultValue
    }

    /**
     * Check if the incoming request contains the "Content-Type"
     * header field, and it contains the given mime `type`.
     *
     * Examples:
     *
     *      // With Content-Type: text/html; charset=utf-8
     *      req.is('html');
     *      req.is('text/html');
     *      req.is('text/*');
     *      // => true
     *
     *      // When Content-Type is application/json
     *      req.is('json');
     *      req.is('application/json');
     *      req.is('application/*');
     *      // => true
     *
     *      req.is('html');
     *      // => false
     *
     * @param {String|Array} types...
     * @return {String|false|null}
     */

    is(...types) {
        if (Array.isArray(types[0])) {
            return typeis(this.originalRequest, types[0])
        }
        return typeis(this.originalRequest, types)
    }
}
