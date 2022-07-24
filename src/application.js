import EventEmitter from 'events'
import finalhandler from 'finalhandler'
import http from 'http'
import { resolve } from 'path'
import { init } from './middleware/init'
import query from './middleware/query'
import Request from './request'
import Response from './response'
import Router from './router'
import {
    compileETag,
    compileQueryParser,
    compileTrust,
    deprecate,
    getLogger,
    hasOwnProperty,
} from './utils'
import View from './view'

const debug = getLogger('express:application')

/**
 * Variable for trust proxy inheritance back-compat
 */
const trustProxyDefaultSymbol = Symbol.for('trust_proxy_default')

export const isApplication = Symbol.for('express.Application')

/**
 * Application prototype.
 */

export default function createApplicationPrototype() {
    return {
        ...EventEmitter.prototype,
        [isApplication]: true,
        cache: {},
        engines: {},
        settings: {},
        locals: {},
        mountpath: null,
        _router: null,

        request: {},
        response: {},

        /**
         * Initialize the server.
         *
         *   - setup default configuration
         *   - setup default middleware
         *   - setup route reflection methods
         *
         */
        init() {
            this.cache = {}
            this.engines = {}
            this.settings = {}

            this.defaultConfiguration()
        },

        /**
         * Initialize application configuration.
         */
        defaultConfiguration() {
            const env = process.env.NODE_ENV || 'development'

            // default settings
            this.enable('x-powered-by')
            this.set('etag', 'weak')
            this.set('env', env)
            this.set('query parser', 'extended')
            this.set('subdomain offset', 2)
            this.set('trust proxy', false)

            // trust proxy inherit back-compat
            this.settings[trustProxyDefaultSymbol] = true

            debug('booting in %s mode', env)

            this.on('mount', parent => {
                // inherit trust proxy
                if (
                    this.settings[trustProxyDefaultSymbol] === true &&
                    typeof parent.settings['trust proxy fn'] === 'function'
                ) {
                    delete this.settings['trust proxy']
                    delete this.settings['trust proxy fn']
                }

                // inherit protos
                Object.setPrototypeOf(this.engines, parent.engines)
                Object.setPrototypeOf(this.settings, parent.settings)
            })

            // setup locals
            this.locals = {}

            // top-most app is mounted at /
            this.mountpath = '/'

            // default locals
            this.locals.settings = this.settings

            // default configuration
            this.set('view', View)
            this.set('views', resolve('views'))
            this.set('jsonp callback name', 'callback')

            if (env === 'production') {
                this.enable('view cache')
            }

            Object.defineProperty(this, 'router', {
                get() {
                    throw new Error(
                        "'app.router' is deprecated!\nPlease see the 3.x to 4.x migration guide for details on how to update your app."
                    )
                },
            })
        },

        /**
         * Assign `setting` to `val`, or return `setting`'s value.
         *
         *    app.set('foo', 'bar');
         *    app.set('foo');
         *    // => "bar"
         *
         * Mounted servers inherit their parent server's settings.
         *
         * @param {string} key
         * @param {any} [value]
         * @return {Server} for chaining
         */
        set(key, value) {
            if (arguments.length === 1) {
                // app.get(setting)
                let settings = this.settings

                while (settings && settings !== Object.prototype) {
                    if (hasOwnProperty(settings, key)) {
                        return settings[key]
                    }

                    settings = Object.getPrototypeOf(settings)
                }

                return
            }

            debug('set "%s" to %o', key, value)

            // set value
            this.settings[key] = value

            // trigger matched settings
            switch (key) {
                case 'etag':
                    this.set('etag fn', compileETag(value))
                    break
                case 'query parser':
                    this.set('query parser fn', compileQueryParser(value))
                    break
                case 'trust proxy':
                    this.set('trust proxy fn', compileTrust(value))
                    // trust proxy inherit back-compat
                    this.settings[trustProxyDefaultSymbol] = false
                    break
            }

            return this
        },

        /**
         * Check if `setting` is enabled (truthy).
         *
         *    app.enabled('foo')
         *    // => false
         *
         *    app.enable('foo')
         *    app.enabled('foo')
         *    // => true
         *
         * @param {string} setting
         * @return {boolean}
         */

        enabled(setting) {
            return !!this.set(setting)
        },

        /**
         * Check if `setting` is disabled.
         *
         *    app.disabled('foo')
         *    // => true
         *
         *    app.enable('foo')
         *    app.disabled('foo')
         *    // => false
         *
         * @param {String} setting
         * @return {Boolean}
         */
        disabled(setting) {
            return !this.set(setting)
        },

        /**
         * Enable `setting`.
         *
         * @param {String} setting
         * @return {app} for chaining
         */
        enable(setting) {
            return this.set(setting, true)
        },

        /**
         * Disable `setting`.
         *
         * @param {String} setting
         * @return {app} for chaining
         */
        disable(setting) {
            return this.set(setting, false)
        },

        /**
         * Return the app's absolute pathname
         * based on the parent(s) that have
         * mounted it.
         *
         * For example if the application was
         * mounted as "/admin", which itself
         * was mounted as "/blog" then the
         * return value would be "/blog/admin".
         *
         * @return {String}
         */
        path() {
            return this.parent ? this.parent.path() + this.mountpath : ''
        },

        /**
         * lazily adds the base router if it has not yet been added.
         *
         * We cannot add the base router in the defaultConfiguration because
         * it reads app settings which might be set after that has run.
         *
         */
        getRouter() {
            if (!this._router) {
                this._router = new Router({
                    caseSensitive: this.enabled('case sensitive routing'),
                    strict: this.enabled('strict routing'),
                })

                this._router.use(query(this.get('query parser fn')))
                this._router.use(init(this))
            }

            return this._router
        },

        /**
         * Dispatch a req, res pair into the application. Starts pipeline processing.
         *
         * If no callback is provided, then default error handlers will respond
         * in the event of an error bubbling through the stack.
         *
         */
        handle(req, res, callback) {
            const router = this.getRouter()

            // final handler
            if (!callback) {
                callback = finalhandler(req, res, {
                    env: this.get('env'),
                    onerror: err => {
                        // Log error using console.error.
                        // this refer to application
                        if (this.get('env') !== 'test') {
                            console.error(err.stack || err.toString())
                        }
                    },
                })
            }

            // no routes
            if (!router) {
                debug('no routes defined on app')
                callback()
                return
            }

            if (req instanceof Request && res instanceof Response) {
                let origApp = req.app

                req.app = this
                res.app = this

                router.handle(req, res, callback)

                req.app = origApp
                res.app = origApp
            } else {
                req = Request.fromIncomingMessage(req, this)

                for (const [key, value] of Object.entries(this.request)) {
                    Reflect.set(req, key, value)
                }

                res = Response.fromServerResponse(res, this)

                for (const [key, value] of Object.entries(this.response)) {
                    Reflect.set(res, key, value)
                }

                req.res = res
                res.req = req

                return router.handle(req, res, callback)
            }
        },

        /**
         * Proxy `Router#use()` to add middleware to the app router.
         * See Router#use() documentation for details.
         *
         * If the _fn_ parameter is an express app, then it will be
         * mounted at the _route_ specified.
         *
         */
        use(...args) {
            let path

            if (Array.isArray(args[0])) {
                let arg0 = args[0]

                while (Array.isArray(arg0) && arg0.length) {
                    arg0 = arg0[0]
                }

                if (typeof arg0 !== 'function') {
                    path = args.shift()
                }
            }

            const middlewares = args.flat(Infinity)

            if (!path) {
                if (typeof middlewares[0] !== 'function') {
                    path = middlewares.shift()
                } else {
                    path = '/'
                }
            }

            if (!middlewares.length) {
                throw new TypeError('app.use() requires a middleware function')
            }

            // setup router
            const router = this.getRouter()

            for (const middleware of middlewares) {
                if (middleware && middleware[isApplication]) {
                    // express app
                    debug('.use app under %s', path)

                    middleware.mountpath = path
                    middleware.parent = this

                    // restore .app property on req and res
                    router.use(path, (req, res, next) => {
                        middleware.handle(req, res, next)
                    })

                    // mounted an app
                    middleware.emit('mount', this)
                } else {
                    router.use(path, middleware)
                }
            }

            return this
        },

        /**
         * Proxy to the app `Router#route()`
         * Returns a new `Route` instance for the _path_.
         *
         * Routes are isolated middleware stacks for specific paths.
         * See the Route api docs for details.
         *
         */
        route(path) {
            return this.getRouter().route(path)
        },

        /**
         * Proxy to `Router#param()` with one added api feature. The _name_ parameter
         * can be an array of names.
         *
         * See the Router#param() docs for more details.
         *
         * @param {String|Array} name
         * @param {Function} fn
         * @return {app} for chaining
         */
        param(names, fn) {
            if (!Array.isArray(names)) {
                names = [names]
            }

            for (const name of names) {
                this.getRouter().param(name, fn)
            }

            return this
        },

        // Delegate `.VERB(...)` calls to `route.VERB(...)`.
        _registerRouteHandler(method, path, fns) {
            this.getRouter()
                .route(path)
                [method](...fns)
            return this
        },

        get(path, ...fns) {
            if (path && fns.length === 0) {
                // app.get(setting)
                return this.set(path)
            }

            return this._registerRouteHandler('get', path, fns)
        },

        post(path, ...fns) {
            return this._registerRouteHandler('post', path, fns)
        },

        put(path, ...fns) {
            return this._registerRouteHandler('put', path, fns)
        },

        head(path, ...fns) {
            return this._registerRouteHandler('head', path, fns)
        },

        delete(path, ...fns) {
            return this._registerRouteHandler('delete', path, fns)
        },

        options(path, ...fns) {
            return this._registerRouteHandler('options', path, fns)
        },

        /**
         * Special-cased "all" method, applying the given route `path`,
         * middleware, and callback to _every_ HTTP method (GET, POST,
         * PUT, HEAD, DELETE, OPTIONS).
         *
         * @param {String} path
         * @param {Function} ...
         * @return {app} for chaining
         */
        all(path, ...fns) {
            return this._registerRouteHandler('all', path, fns)
        },

        // del -> delete alias

        del(path, ...fns) {
            deprecate('app.del: Use app.delete instead')
            return this.delete(path, ...fns)
        },

        /**
         * Register the given template engine callback `fn`
         * as `ext`.
         *
         * By default will `require()` the engine based on the
         * file extension. For example if you try to render
         * a "foo.ejs" file Express will invoke the following internally:
         *
         *     app.engine('ejs', require('ejs').__express);
         *
         * For engines that do not provide `.__express` out of the box,
         * or if you wish to "map" a different extension to the template engine
         * you may use this method. For example mapping the EJS template engine to
         * ".html" files:
         *
         *     app.engine('html', require('ejs').renderFile);
         *
         * In this case EJS provides a `.renderFile()` method with
         * the same signature that Express expects: `(path, options, callback)`,
         * though note that it aliases this method as `ejs.__express` internally
         * so if you're using ".ejs" extensions you don't need to do anything.
         *
         * Some template engines do not follow this convention, the
         * [Consolidate.js](https://github.com/tj/consolidate.js)
         * library was created to map all of node's popular template
         * engines to follow this convention, thus allowing them to
         * work seamlessly within Express.
         *
         * @param {String} extname
         * @param {Function} fn
         * @return {app} for chaining
         */
        engine(extname, fn) {
            if (typeof fn !== 'function') {
                throw new Error('callback function required')
            }

            // get file extension (add '.' to the extension name)
            const extension = extname[0] !== '.' ? '.' + extname : extname

            // store engine
            this.engines[extension] = fn

            return this
        },

        /**
         * Render the given view `name` name with `options`
         * and a callback accepting an error and the
         * rendered template string.
         *
         * Example:
         *
         *    app.render('email', { name: 'Tobi' }, function(err, html){
         *      // ...
         *    })
         *
         * @param {String} name
         * @param {Object|Function} options or fn
         * @param {Function} callback
         */
        render(name, options, callback) {
            const cache = this.cache
            const engines = this.engines

            // support callback function as second arg
            if (typeof options === 'function') {
                callback = options
                options = {}
            }

            const renderOptions = {}

            // merge app.locals
            Object.assign(renderOptions, this.locals)

            // merge options._locals
            if (options._locals) {
                Object.assign(renderOptions, options._locals)
            }

            // merge options
            Object.assign(renderOptions, options)

            // set .cache unless explicitly provided
            if (!renderOptions.cache) {
                renderOptions.cache = this.enabled('view cache')
            }

            let view

            // primed cache
            if (renderOptions.cache) {
                view = cache[name]
            }

            // view
            if (!view) {
                const View = this.get('view') || View

                view = new View(name, {
                    defaultEngine: this.get('view engine'),
                    root: this.get('views'),
                    engines: engines,
                })

                if (!view.path) {
                    let dirs
                    if (Array.isArray(view.root) && view.root.length > 1) {
                        const others = view.root.slice(0, -1).join('", "')
                        const last = view.root.slice(-1)
                        dirs = `directories "${others}" or "${last}"`
                    } else {
                        dirs = `directory "${view.root}"`
                    }
                    const err = new Error(
                        `Failed to lookup view "${name}" in views ${dirs}`
                    )
                    err.view = view
                    return callback(err)
                }

                // prime the cache
                if (renderOptions.cache) {
                    cache[name] = view
                }
            }

            // Try rendering a view.
            try {
                return view.render(renderOptions, callback)
            } catch (err) {
                callback(err)
            }
        },

        /**
         * Listen for connections.
         *
         * A node `http.Server` is returned, with this
         * application (which is a `Function`) as its
         * callback. If you wish to create both an HTTP
         * and HTTPS server you may do so with the "http"
         * and "https" modules as shown here:
         *
         *    const http = require('http')
         *    const https = require('https')
         *    const express = require('express')
         *    const app = express()
         *
         *    app.listen(8080) // => http.Server
         *    http.createServer(app).listen(80)
         *    https.createServer({ ... }, app).listen(443)
         *
         * @return {http.Server}
         */
        listen(...args) {
            const server = http.createServer(this.handle.bind(this))
            return server.listen(...args)
        },
    }
}
