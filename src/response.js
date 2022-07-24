import contentDisposition from 'content-disposition'
import { serialize } from 'cookie'
import { sign } from 'cookie-signature'
import escapeHtml from 'escape-html'
import createError from 'http-errors'
import onFinished from 'on-finished'
import { extname, resolve } from 'path'
import { Buffer } from 'safe-buffer'
import send, { mime } from 'send'
import { message } from 'statuses'
import vary from 'vary'
import {
    deprecate,
    encodeurl,
    isAbsolute,
    normalizeType,
    normalizeTypes,
    setCharset,
} from './utils'

/**
 * Stringify JSON, like JSON.stringify, but v8 optimized, with the
 * ability to escape characters that can trigger HTML sniffing.
 *
 * @param {*} value
 * @param {function} replacer
 * @param {number} spaces
 * @param {boolean} escape
 * @returns {string}
 */

function stringify(value, replacer, spaces, escape) {
    // v8 checks arguments.length for optimizing simple call
    // https://bugs.chromium.org/p/v8/issues/detail?id=4730
    let json =
        replacer || spaces
            ? JSON.stringify(value, replacer, spaces)
            : JSON.stringify(value)

    if (escape && typeof json === 'string') {
        json = json.replace(/[<>&]/g, c => {
            switch (c.charCodeAt(0)) {
                case 0x3c:
                    return '\\u003c'
                case 0x3e:
                    return '\\u003e'
                case 0x26:
                    return '\\u0026'
                /* istanbul ignore next: unreachable default */
                default:
                    return c
            }
        })
    }

    return json
}

// pipe the send file stream
function sendfile(res, file, options, callback) {
    let done = false
    let streaming

    // errors
    file.on('error', err => {
        if (done) return
        done = true
        callback(err)
    })

    // directory
    file.on('directory', () => {
        if (done) return
        done = true

        const err = new Error('EISDIR, read')
        err.code = 'EISDIR'
        callback(err)
    })

    // ended
    file.on('end', function onend() {
        if (done) return
        done = true
        callback()
    })

    // file
    file.on('file', () => {
        streaming = false
    })

    // streaming
    file.on('stream', () => {
        streaming = true
    })

    // request aborted
    function onaborted() {
        if (done) return
        done = true

        const err = new Error('Request aborted')
        err.code = 'ECONNABORTED'
        callback(err)
    }

    // finished
    onFinished(res, err => {
        if (err && err.code === 'ECONNRESET') {
            return onaborted()
        }
        if (done) return
        if (err) {
            done = true
            callback(err)
        }

        setImmediate(() => {
            if (streaming !== false && !done) {
                onaborted()
                return
            }

            if (done) return
            done = true
            callback()
        })
    })

    if (options.headers) {
        // set headers on successful transfer
        file.on('headers', res => {
            for (const [key, value] of Object.entries(options.headers)) {
                res.setHeader(key, value)
            }
        })
    }

    // pipe
    file.pipe(res)
}

export default class Response {
    /**
     *
     * @param {ServerResponse} res
     * @param {Application} app
     */
    constructor(res, app) {
        /**
         * @type {import('http').ServerResponse}
         */
        this.originalResponse = res
        /**
         * @type {Application}
         */
        this.app = app

        this._wrapedResponseCache = null
    }

    get _wrapedResponse() {
        if (this._wrapedResponseCache === null) {
            const instance = this
            this._wrapedResponseCache = new Proxy(this.originalResponse, {
                get(target, p) {
                    if (Reflect.has(instance, p)) {
                        return Reflect.get(instance, p)
                    }
                    const fn = Reflect.get(target, p)
                    if (typeof fn !== 'function') return fn
                    return fn.bind(target)
                },
                set(target, p, value) {
                    if (Reflect.has(target, p)) {
                        return Reflect.set(target, p, value)
                    }
                    return Reflect.set(instance, p, value)
                },
            })
        }

        return this._wrapedResponseCache
    }

    /**
     * Create a Response object.
     * @param {import('http').ServerResponse} serverResponse
     * @param {Application} app
     * @returns {Response}
     */
    static fromServerResponse(serverResponse, app) {
        return new this(serverResponse, app)._wrapedResponse
    }

    /**
     * Set status `code`.
     *
     * @param {Number} code
     * @return {ServerResponse}
     */

    status(code) {
        // no string or float
        if (
            (typeof code === 'string' || Math.floor(code) !== code) &&
            code > 99 &&
            code < 1000
        ) {
            deprecate(
                `res.status(${JSON.stringify(
                    code
                )}): use res.status(${Math.floor(code)}) instead`
            )
            code = Math.floor(code)
        }

        this.originalResponse.statusCode = code

        return this._wrapedResponse
    }

    /**
     * Set Link header field with the given `links`.
     *
     * Examples:
     *
     *    res.links({
     *      next: 'http://api.example.com/users?page=2',
     *      last: 'http://api.example.com/users?page=5'
     *    });
     *
     * @param {Object} links
     * @return {ServerResponse}
     */

    links(links) {
        let link = this.get('Link') || ''

        return this.set(
            'Link',
            (link ? link + ', ' : '') +
                Object.keys(links)
                    .map(rel => {
                        return `<${links[rel]}>; rel="${rel}"`
                    })
                    .join(', ')
        )
    }

    /**
     * Send a response.
     *
     * Examples:
     *
     *     res.send(Buffer.from('wahoo'));
     *     res.send({ some: 'json' });
     *     res.send('<p>some html</p>');
     *
     * @param {string|number|boolean|object|Buffer} body
     */

    send(body, depd_arg) {
        // deprecate usage
        // allow status / body
        if (depd_arg !== undefined) {
            // res.send(body, status) backwards compat
            if (typeof body !== 'number' && typeof depd_arg === 'number') {
                deprecate(
                    'res.send(body, status): Use res.status(status).send(body) instead'
                )
                this.originalResponse.statusCode = depd_arg
            } else {
                deprecate(
                    'res.send(status, body): Use res.status(status).send(body) instead'
                )
                this.originalResponse.statusCode = body
                body = depd_arg
            }
        }

        // disambiguate res.send(status) and res.send(status, num)
        if (typeof body === 'number' && depd_arg === undefined) {
            // res.send(status) will set status message as text string
            if (!this.get('Content-Type')) {
                this.contentType('txt')
            }

            deprecate('res.send(status): Use res.sendStatus(status) instead')
            this.originalResponse.statusCode = body
            body = message[body]
        }

        switch (typeof body) {
            // string defaulting to html
            case 'string':
                if (!this.get('Content-Type')) {
                    this.contentType('html')
                }
                break
            case 'boolean':
            case 'number':
            case 'object':
                if (body === null) {
                    body = ''
                } else if (Buffer.isBuffer(body)) {
                    if (!this.get('Content-Type')) {
                        this.contentType('bin')
                    }
                } else {
                    return this.json(body)
                }
                break
        }

        let encoding
        let type

        // write strings in utf-8
        if (typeof body === 'string') {
            encoding = 'utf8'
            type = this.get('Content-Type')

            // reflect this in content-type
            if (typeof type === 'string') {
                this.set('Content-Type', setCharset(type, 'utf-8'))
            }
        }

        // determine if ETag should be generated
        const etagFn = this.app.get('etag fn')
        const generateETag = !this.get('ETag') && typeof etagFn === 'function'

        let len

        // populate Content-Length
        if (body !== undefined) {
            if (Buffer.isBuffer(body)) {
                // get length of Buffer
                len = body.length
            } else if (!generateETag && body.length < 1000) {
                // just calculate length when no ETag + small chunk
                len = Buffer.byteLength(body, encoding)
            } else {
                // convert chunk to Buffer and calculate
                body = Buffer.from(body, encoding)
                encoding = undefined
                len = body.length
            }

            this.set('Content-Length', len)
        }

        // populate ETag
        if (generateETag && len !== undefined) {
            let etag = etagFn(body, encoding)
            if (etag) {
                this.set('ETag', etag)
            }
        }

        // freshness
        if (this.req.fresh) this.originalResponse.statusCode = 304

        // strip irrelevant headers
        if ([204, 304].includes(this.originalResponse.statusCode)) {
            this.originalResponse.removeHeader('Content-Type')
            this.originalResponse.removeHeader('Content-Length')
            this.originalResponse.removeHeader('Transfer-Encoding')
            body = ''
        }

        // alter headers for 205
        if (this.originalResponse.statusCode === 205) {
            this.set('Content-Length', '0')
            this.originalResponse.removeHeader('Transfer-Encoding')
            body = ''
        }

        if (this.req.method === 'HEAD') {
            // skip body for HEAD
            this.originalResponse.end()
        } else {
            // respond
            this.originalResponse.end(body, encoding)
        }

        return this._wrapedResponse
    }

    /**
     * Send JSON response.
     *
     * Examples:
     *
     *     res.json(null);
     *     res.json({ user: 'tj' });
     *
     * @param {string|number|boolean|object} obj
     */

    json(obj, depd_arg) {
        // deprecate usage
        // allow status / body
        if (depd_arg !== undefined) {
            // res.json(body, status) backwards compat
            if (typeof depd_arg === 'number') {
                deprecate(
                    'res.json(obj, status): Use res.status(status).json(obj) instead'
                )
                this.originalResponse.statusCode = depd_arg
            } else {
                deprecate(
                    'res.json(status, obj): Use res.status(status).json(obj) instead'
                )
                this.originalResponse.statusCode = obj
                obj = depd_arg
            }
        }

        // settings
        const escape = this.app.get('json escape')
        const replacer = this.app.get('json replacer')
        const spaces = this.app.get('json spaces')
        const body = stringify(obj, replacer, spaces, escape)

        // content-type
        if (!this.get('Content-Type')) {
            this.set('Content-Type', 'application/json')
        }

        return this.send(body)
    }

    /**
     * Send JSON response with JSONP callback support.
     *
     * Examples:
     *
     *     res.jsonp(null);
     *     res.jsonp({ user: 'tj' });
     *
     * @param {string|number|boolean|object} obj
     */

    jsonp(obj, depd_arg) {
        // allow status / body
        if (depd_arg !== undefined) {
            // res.jsonp(body, status) backwards compat
            if (typeof depd_arg === 'number') {
                deprecate(
                    'res.jsonp(obj, status): Use res.status(status).jsonp(obj) instead'
                )
                this.originalResponse.statusCode = depd_arg
            } else {
                deprecate(
                    'res.jsonp(status, obj): Use res.status(status).jsonp(obj) instead'
                )
                this.originalResponse.statusCode = obj
                obj = depd_arg
            }
        }

        // settings
        const escape = this.app.get('json escape')
        const replacer = this.app.get('json replacer')
        const spaces = this.app.get('json spaces')
        let body = stringify(obj, replacer, spaces, escape)
        let callback = this.req.query[this.app.get('jsonp callback name')]

        // content-type
        if (!this.get('Content-Type')) {
            this.set('X-Content-Type-Options', 'nosniff')
            this.set('Content-Type', 'application/json')
        }

        // fixup callback
        if (Array.isArray(callback)) {
            callback = callback[0]
        }

        // jsonp
        if (typeof callback === 'string' && callback.length !== 0) {
            this.set('X-Content-Type-Options', 'nosniff')
            this.set('Content-Type', 'text/javascript')

            // restrict callback charset
            callback = callback.replace(/[^\[\]\w$.]/g, '')

            if (body === undefined) {
                // empty argument
                body = ''
            } else if (typeof body === 'string') {
                // replace chars not allowed in JavaScript that are in JSON
                body = body
                    .replace(/\u2028/g, '\\u2028')
                    .replace(/\u2029/g, '\\u2029')
            }

            // the /**/ is a specific security mitigation for "Rosetta Flash JSONP abuse"
            // the typeof check is just to reduce client error noise
            body = `/**/ typeof ${callback} === 'function' && ${callback}(${body});`
        }

        return this.send(body)
    }

    /**
     * Send given HTTP status code.
     *
     * Sets the response status to `statusCode` and the body of the
     * response to the standard description from node's http.STATUS_CODES
     * or the statusCode number if no description.
     *
     * Examples:
     *
     *     res.sendStatus(200);
     *
     * @param {number} statusCode
     */

    sendStatus(statusCode) {
        const body = message[statusCode] || statusCode.toString()

        this.originalResponse.statusCode = statusCode
        this.contentType('txt')

        return this.send(body)
    }

    /**
     * Transfer the file at the given `path`.
     *
     * Automatically sets the _Content-Type_ response header field.
     * The callback `callback(err)` is invoked when the transfer is complete
     * or when an error occurs. Be sure to check `res.headersSent`
     * if you wish to attempt responding, as the header and some data
     * may have already been transferred.
     *
     * Options:
     *
     *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
     *   - `root`     root directory for relative filenames
     *   - `headers`  object of headers to serve with file
     *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
     *
     * Other options are passed along to `send`.
     *
     * Examples:
     *
     *  The following example illustrates how `res.sendFile()` may
     *  be used as an alternative for the `static()` middleware for
     *  dynamic situations. The code backing `res.sendFile()` is actually
     *  the same code, so HTTP cache support etc is identical.
     *
     *     app.get('/user/:uid/photos/:file', function(req, res){
     *       var uid = req.params.uid
     *         , file = req.params.file;
     *
     *       req.user.mayViewFilesFrom(uid, function(yes){
     *         if (yes) {
     *           res.sendFile('/uploads/' + uid + '/' + file);
     *         } else {
     *           res.send(403, 'Sorry! you cant see that.');
     *         }
     *       });
     *     });
     *
     */
    sendFile(path, options = {}, callback) {
        if (!path) {
            throw new TypeError('path argument is required to res.sendFile')
        }

        if (typeof path !== 'string') {
            throw new TypeError('path must be a string to res.sendFile')
        }

        // support function as second arg
        if (typeof options === 'function') {
            callback = options
            options = {}
        }

        if (!options.root && !isAbsolute(path)) {
            throw new TypeError(
                'path must be absolute or specify root to res.sendFile'
            )
        }

        // create file stream
        const pathname = encodeURI(path)
        const file = send(this.req.originalRequest, pathname, options)

        const next = this.next

        // transfer
        sendfile(this.originalResponse, file, options, err => {
            if (callback) {
                // have custom callback
                return callback(err)
            } else {
                if (err && err.code === 'EISDIR') {
                    return next()
                }

                // next() all but write errors
                if (
                    err &&
                    err.code !== 'ECONNABORTED' &&
                    err.syscall !== 'write'
                ) {
                    next(err)
                }
            }
        })
    }

    /**
     * Transfer the file at the given `path`.
     *
     * Automatically sets the _Content-Type_ response header field.
     * The callback `callback(err)` is invoked when the transfer is complete
     * or when an error occurs. Be sure to check `res.headersSent`
     * if you wish to attempt responding, as the header and some data
     * may have already been transferred.
     *
     * Options:
     *
     *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
     *   - `root`     root directory for relative filenames
     *   - `headers`  object of headers to serve with file
     *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
     *
     * Other options are passed along to `send`.
     *
     * Examples:
     *
     *  The following example illustrates how `res.sendfile()` may
     *  be used as an alternative for the `static()` middleware for
     *  dynamic situations. The code backing `res.sendfile()` is actually
     *  the same code, so HTTP cache support etc is identical.
     *
     *     app.get('/user/:uid/photos/:file', function(req, res){
     *       var uid = req.params.uid
     *         , file = req.params.file;
     *
     *       req.user.mayViewFilesFrom(uid, function(yes){
     *         if (yes) {
     *           res.sendfile('/uploads/' + uid + '/' + file);
     *         } else {
     *           res.send(403, 'Sorry! you cant see that.');
     *         }
     *       });
     *     });
     *
     */
    sendfile(path, options = {}, callback) {
        deprecate('res.sendfile: Use res.sendFile instead')

        // support function as second arg
        if (typeof options === 'function') {
            callback = options
            options = {}
        }

        // create file stream
        const file = send(this.req, path, options)

        const next = this.next

        // transfer
        sendfile(this.originalResponse, file, options, err => {
            if (callback) {
                // have custom callback
                return callback(err)
            } else {
                if (err && err.code === 'EISDIR') return next()

                // next() all but write errors
                if (
                    err &&
                    err.code !== 'ECONNABORTED' &&
                    err.syscall !== 'write'
                ) {
                    next(err)
                }
            }
        })
    }

    /**
     * Transfer the file at the given `path` as an attachment.
     *
     * Optionally providing an alternate attachment `filename`,
     * and optional callback `callback(err)`. The callback is invoked
     * when the data transfer is complete, or when an error has
     * occurred. Be sure to check `res.headersSent` if you plan to respond.
     *
     * Optionally providing an `options` object to use with `res.sendFile()`.
     * This function will set the `Content-Disposition` header, overriding
     * any `Content-Disposition` header passed as header options in order
     * to set the attachment and filename.
     *
     * This method uses `res.sendFile()`.
     *
     * download(path, filename, options, callback)
     * download(path, callback)
     * download(path, filename, callback)
     * download(path, options)
     * download(path, options, callback)
     */

    download(path, filename, options, callback) {
        let opts = options || null

        // support function as second or third arg
        if (typeof filename === 'function') {
            // overload 2
            callback = filename
            filename = null
            opts = null
        } else if (typeof options === 'function') {
            // overload 3
            callback = options
            opts = null
        }

        // support optional filename, where options may be in it's place
        if (
            typeof filename === 'object' &&
            (typeof options === 'function' || options === undefined)
        ) {
            // overload 4 (overload 5 is based on 3 and 4)
            opts = filename
            filename = null
        }

        // set Content-Disposition when file is sent
        const headers = {
            'Content-Disposition': contentDisposition(filename || path),
        }

        // merge user-provided headers
        if (opts && opts.headers) {
            for (const [key, value] of Object.entries(opts.headers)) {
                if (key.toLowerCase() !== 'content-disposition') {
                    headers[key] = value
                }
            }
        }

        // merge user-provided options
        opts = Object.create(opts)
        opts.headers = headers

        // Resolve the full path for sendFile
        const fullPath = !opts.root ? resolve(path) : path

        // send file
        return this.sendFile(fullPath, opts, callback)
    }

    /**
     * Set _Content-Type_ response header with `type` through `mime.lookup()`
     * when it does not contain "/", or set the Content-Type to `type` otherwise.
     *
     * Examples:
     *
     *     res.type('.html');
     *     res.type('html');
     *     res.type('json');
     *     res.type('application/json');
     *     res.type('png');
     *
     * @param {String} type
     * @return {ServerResponse} for chaining
     */

    contentType(type) {
        const ct = !type.includes('/') ? mime.lookup(type) : type

        return this.set('Content-Type', ct)
    }

    type(type) {
        return this.contentType(type)
    }

    /**
     * Respond to the Acceptable formats using an `obj`
     * of mime-type callbacks.
     *
     * This method uses `req.accepted`, an array of
     * acceptable types ordered by their quality values.
     * When "Accept" is not present the _first_ callback
     * is invoked, otherwise the first match is used. When
     * no match is performed the server responds with
     * 406 "Not Acceptable".
     *
     * Content-Type is set for you, however if you choose
     * you may alter this within the callback using `res.type()`
     * or `res.set('Content-Type', ...)`.
     *
     *    res.format({
     *      'text/plain': function(){
     *        res.send('hey');
     *      },
     *
     *      'text/html': function(){
     *        res.send('<p>hey</p>');
     *      },
     *
     *      'application/json': function () {
     *        res.send({ message: 'hey' });
     *      }
     *    });
     *
     * In addition to canonicalized MIME types you may
     * also use extnames mapped to these types:
     *
     *    res.format({
     *      text: function(){
     *        res.send('hey');
     *      },
     *
     *      html: function(){
     *        res.send('<p>hey</p>');
     *      },
     *
     *      json: function(){
     *        res.send({ message: 'hey' });
     *      }
     *    });
     *
     * By default Express passes an `Error`
     * with a `.status` of 406 to `next(err)`
     * if a match is not made. If you provide
     * a `.default` callback it will be invoked
     * instead.
     *
     * @param {Object} obj
     * @return {ServerResponse} for chaining
     */

    format(obj) {
        const next = this.next

        const keys = Object.keys(obj).filter(v => v !== 'default')

        const key = keys.length > 0 ? this.req.accepts(keys) : false

        this.vary('Accept')

        if (key) {
            this.set('Content-Type', normalizeType(key).value)
            obj[key](this.req, this._wrapedResponse, next)
        } else if (obj.default) {
            obj.default(this.req, this._wrapedResponse, next)
        } else {
            throw createError(406, {
                types: normalizeTypes(keys).map(o => o.value),
            })
        }

        return this._wrapedResponse
    }

    /**
     * Set _Content-Disposition_ header to _attachment_ with optional `filename`.
     *
     * @param {String} filename
     * @return {ServerResponse}
     */

    attachment(filename) {
        if (filename) {
            this.contentType(extname(filename))
        }

        this.set('Content-Disposition', contentDisposition(filename))

        return this._wrapedResponse
    }

    /**
     * Append additional header `field` with value `val`.
     *
     * Example:
     *
     *    res.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
     *    res.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
     *    res.append('Warning', '199 Miscellaneous warning');
     *
     * @param {String} field
     * @param {String|Array} val
     * @return {ServerResponse} for chaining
     */

    append(field, val) {
        const prev = this.get(field)
        let value = val

        if (prev) {
            // concat the new and prev vals
            value = [prev, val].flat()
        }

        return this.set(field, value)
    }

    /**
     * Set header `field` to `val`, or pass
     * an object of header fields.
     *
     * Examples:
     *
     *    res.set('Foo', ['bar', 'baz']);
     *    res.set('Accept', 'application/json');
     *    res.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
     *
     * Aliased as `res.header()`.
     *
     * @param {String|Object} field
     * @param {String|Array} val
     * @return {ServerResponse} for chaining
     */
    header(field, val) {
        if (typeof field === 'string' && val) {
            let value = Array.isArray(val)
                ? val.map(v => v.toString())
                : val.toString()

            // add charset to content-type
            if (field.toLowerCase() === 'content-type') {
                if (Array.isArray(value)) {
                    throw new TypeError(
                        'Content-Type cannot be set to an Array'
                    )
                }
                if (!/;\s*charset\s*=/.test(value)) {
                    const charset = mime.charsets.lookup(value.split(';')[0])
                    if (charset) {
                        value += '; charset=' + charset.toLowerCase()
                    }
                }
            }

            // provided by ServerResponse
            this.originalResponse.setHeader(field, value)
        } else {
            for (const [key, value] of Object.entries(field)) {
                this.set(key, value)
            }
        }
        return this._wrapedResponse
    }

    set(...args) {
        return this.header(...args)
    }

    /**
     * Get value for header `field`.
     *
     * @param {String} field
     * @return {String}
     */

    get(field) {
        // provided by ServerResponse
        return this.originalResponse.getHeader(field)
    }

    /**
     * Clear cookie `name`.
     *
     * @param {String} name
     * @param {Object} [options]
     * @return {ServerResponse} for chaining
     */

    clearCookie(name, options) {
        const opts = {
            expires: new Date(1),
            path: '/',
            ...options,
        }

        return this.cookie(name, '', opts)
    }

    /**
     * Set cookie `name` to `value`, with the given `options`.
     *
     * Options:
     *
     *    - `maxAge`   max-age in milliseconds, converted to `expires`
     *    - `signed`   sign the cookie
     *    - `path`     defaults to "/"
     *
     * Examples:
     *
     *    // "Remember Me" for 15 minutes
     *    res.cookie('rememberme', '1', { expires: new Date(Date.now() + 900000), httpOnly: true });
     *
     *    // same as above
     *    res.cookie('rememberme', '1', { maxAge: 900000, httpOnly: true })
     *
     * @param {String} name
     * @param {String|Object} value
     * @param {Object} [options]
     * @return {ServerResponse} for chaining
     */

    cookie(name, value, options) {
        const opts = { ...options }
        const secret = this.req.secret
        const signed = opts.signed

        if (signed && !secret) {
            throw new Error(
                'cookieParser("secret") required for signed cookies'
            )
        }

        let val =
            typeof value === 'object'
                ? 'j:' + JSON.stringify(value)
                : value.toString()

        if (signed) {
            val = 's:' + sign(val, secret)
        }

        if (opts.maxAge != null) {
            const maxAge = opts.maxAge - 0

            if (!isNaN(maxAge)) {
                opts.expires = new Date(Date.now() + maxAge)
                opts.maxAge = Math.floor(maxAge / 1000)
            }
        }

        if (opts.path == null) {
            opts.path = '/'
        }

        this.append('Set-Cookie', serialize(name, val, opts))

        return this._wrapedResponse
    }

    /**
     * Set the location header to `url`.
     *
     * The given `url` can also be "back", which redirects
     * to the _Referrer_ or _Referer_ headers or "/".
     *
     * Examples:
     *
     *    res.location('/foo/bar').;
     *    res.location('http://example.com');
     *    res.location('../login');
     *
     * @param {String} url
     * @return {ServerResponse} for chaining
     */

    location(url) {
        // "back" is an alias for the referrer
        if (url === 'back') {
            url = this.req.get('Referrer') || '/'
        }

        // set location
        return this.set('Location', encodeurl(url))
    }

    /**
     * Redirect to the given `url` with optional response `status`
     * defaulting to 302.
     *
     * The resulting `url` is determined by `res.location()`, so
     * it will play nicely with mounted apps, relative paths,
     * `"back"` etc.
     *
     * Examples:
     *
     *    res.redirect('/foo/bar');
     *    res.redirect('http://example.com');
     *    res.redirect(301, 'http://example.com');
     *    res.redirect('../login'); // /blog/post/1 -> /blog/login
     *
     */

    redirect(url, code) {
        let body
        let status = 302

        // allow status / url
        if (code) {
            if (typeof url === 'number') {
                status = url
                url = code
            } else {
                deprecate(
                    'res.redirect(url, status): Use res.redirect(status, url) instead'
                )
                status = code
            }
        }

        // Set location header
        url = this.location(url).get('Location')

        // Support text/{plain,html} by default
        this.format({
            text() {
                body = `${message[status]}. Redirecting to ${url}`
            },

            html() {
                const u = escapeHtml(url)
                body = `<p>${message[status]}. Redirecting to <a href="${u}">${u}</a></p>`
            },

            default() {
                body = ''
            },
        })

        // Respond
        this.originalResponse.statusCode = status
        this.set('Content-Length', Buffer.byteLength(body))

        if (this.req.method === 'HEAD') {
            this.originalResponse.end()
        } else {
            this.originalResponse.end(body)
        }
    }

    /**
     * Add `field` to Vary. If already present in the Vary set, then
     * this call is simply ignored.
     *
     * @param {Array|String} field
     * @return {ServerResponse} for chaining
     */

    vary(field) {
        // checks for back-compat
        if (!field || (Array.isArray(field) && !field.length)) {
            deprecate('res.vary(): Provide a field name')
            return this._wrapedResponse
        }

        vary(this.originalResponse, field)

        return this._wrapedResponse
    }

    /**
     * Render `view` with the given `options` and optional callback `fn`.
     * When a callback function is given a response will _not_ be made
     * automatically, otherwise a response of _200_ and _text/html_ is given.
     *
     * Options:
     *
     *  - `cache`     boolean hinting to the engine it should cache
     *  - `filename`  filename of the view being rendered
     *
     */

    render(view, options = {}, callback) {
        const app = this.app

        // support callback function as second arg
        if (typeof options === 'function') {
            callback = options
            options = {}
        }

        // merge res.locals
        options._locals = this.locals

        // default callback to respond
        callback =
            callback ||
            ((err, str) => {
                if (err) {
                    return this.next(err)
                }
                this.send(str)
            })

        // render
        app.render(view, options, callback)
    }
}
