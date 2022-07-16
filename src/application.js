import EventEmitter from 'events'
import finalhandler from 'finalhandler'
import http from 'http'
import { resolve } from 'path'
import { init } from './middleware/init'
import query from './middleware/query'
import Router from './router'
import {
    compileETag,
    compileQueryParser,
    compileTrust,
    deprecate,
    getLogger,
    methods,
} from './utils'
import View from './view'

const debug = getLogger('express:application')

/**
 * Variable for trust proxy inheritance back-compat
 */
const trustProxyDefaultSymbol = Symbol.for('trust_proxy_default')

/**
 * Application prototype.
 */

export default function createApplicationPrototype() {
    return {
        ...EventEmitter.prototype,
        cache: {},
        engines: {},
        settings: {},
        locals: Object.create(null),
        mountpath: null,
        _router: null,

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
            var env = process.env.NODE_ENV || 'development'

            // default settings
            this.enable('x-powered-by')
            this.set('etag', 'weak')
            this.set('env', env)
            this.set('query parser', 'extended')
            this.set('subdomain offset', 2)
            this.set('trust proxy', false)

            // trust proxy inherit back-compat
            Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
                configurable: true,
                value: true,
            })

            debug('booting in %s mode', env)

            this.on('mount', function onmount(parent) {
                // inherit trust proxy
                if (
                    this.settings[trustProxyDefaultSymbol] === true &&
                    typeof parent.settings['trust proxy fn'] === 'function'
                ) {
                    delete this.settings['trust proxy']
                    delete this.settings['trust proxy fn']
                }

                // inherit protos
                Object.setPrototypeOf(this.request, parent.request)
                Object.setPrototypeOf(this.response, parent.response)
                Object.setPrototypeOf(this.engines, parent.engines)
                Object.setPrototypeOf(this.settings, parent.settings)
            })

            // setup locals
            this.locals = Object.create(null)

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
                get: function () {
                    throw new Error(
                        "'app.router' is deprecated!\nPlease see the 3.x to 4.x migration guide for details on how to update your app."
                    )
                },
            })
        },

        /**
         * lazily adds the base router if it has not yet been added.
         *
         * We cannot add the base router in the defaultConfiguration because
         * it reads app settings which might be set after that has run.
         *
         */
        lazyrouter() {
            if (!this._router) {
                this._router = new Router({
                    caseSensitive: this.enabled('case sensitive routing'),
                    strict: this.enabled('strict routing'),
                })

                this._router.use(query(this.get('query parser fn')))
                this._router.use(init(this))
            }
        },

        /**
         * Dispatch a req, res pair into the application. Starts pipeline processing.
         *
         * If no callback is provided, then default error handlers will respond
         * in the event of an error bubbling through the stack.
         *
         */
        handle(req, res, callback) {
            var router = this._router

            // final handler
            var done =
                callback ||
                finalhandler(req, res, {
                    env: this.get('env'),
                    onerror: err => {
                        //Log error using console.error.
                        if (this.get('env') !== 'test') {
                            console.error(err.stack || err.toString())
                        }
                    },
                })

            // no routes
            if (!router) {
                debug('no routes defined on app')
                done()
                return
            }

            router.handle(req, res, done)
        },

        /**
         * Proxy `Router#use()` to add middleware to the app router.
         * See Router#use() documentation for details.
         *
         * If the _fn_ parameter is an express app, then it will be
         * mounted at the _route_ specified.
         *
         */
        use(fn) {
            var offset = 0
            var path = '/'

            // default path to '/'
            // disambiguate app.use([fn])
            if (typeof fn !== 'function') {
                var arg = fn

                while (Array.isArray(arg) && arg.length !== 0) {
                    arg = arg[0]
                }

                // first arg is the path
                if (typeof arg !== 'function') {
                    offset = 1
                    path = fn
                }
            }

            var fns = Array.prototype.slice
                .call(arguments, offset)
                .flat(Infinity)

            if (fns.length === 0) {
                throw new TypeError('app.use() requires a middleware function')
            }

            // setup router
            this.lazyrouter()
            var router = this._router

            fns.forEach(function (fn) {
                // non-express app
                if (!fn || !fn.handle || !fn.set) {
                    return router.use(path, fn)
                }

                debug('.use app under %s', path)
                fn.mountpath = path
                fn.parent = this

                // restore .app property on req and res
                router.use(path, function mounted_app(req, res, next) {
                    var orig = req.app
                    fn.handle(req, res, function (err) {
                        Object.setPrototypeOf(req, orig.request)
                        Object.setPrototypeOf(res, orig.response)
                        next(err)
                    })
                })

                // mounted an app
                fn.emit('mount', this)
            }, this)

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
            this.lazyrouter()
            return this._router.route(path)
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
         * @param {String} ext
         * @param {Function} fn
         * @return {app} for chaining
         */
        engine(ext, fn) {
            if (typeof fn !== 'function') {
                throw new Error('callback function required')
            }

            // get file extension
            var extension = ext[0] !== '.' ? '.' + ext : ext

            // store engine
            this.engines[extension] = fn

            return this
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
        param(name, fn) {
            this.lazyrouter()

            if (Array.isArray(name)) {
                for (var i = 0; i < name.length; i++) {
                    this.param(name[i], fn)
                }

                return this
            }

            this._router.param(name, fn)

            return this
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
         * @param {String} setting
         * @param {*} [val]
         * @return {Server} for chaining
         */
        set(setting, val) {
            if (arguments.length === 1) {
                // app.get(setting)
                var settings = this.settings

                while (settings && settings !== Object.prototype) {
                    if (
                        Object.prototype.hasOwnProperty.call(settings, setting)
                    ) {
                        return settings[setting]
                    }

                    settings = Object.getPrototypeOf(settings)
                }

                return undefined
            }

            debug('set "%s" to %o', setting, val)

            // set value
            this.settings[setting] = val

            // trigger matched settings
            switch (setting) {
                case 'etag':
                    this.set('etag fn', compileETag(val))
                    break
                case 'query parser':
                    this.set('query parser fn', compileQueryParser(val))
                    break
                case 'trust proxy':
                    this.set('trust proxy fn', compileTrust(val))

                    // trust proxy inherit back-compat
                    Object.defineProperty(
                        this.settings,
                        trustProxyDefaultSymbol,
                        {
                            configurable: true,
                            value: false,
                        }
                    )

                    break
            }

            return this
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
         * Check if `setting` is enabled (truthy).
         *
         *    app.enabled('foo')
         *    // => false
         *
         *    app.enable('foo')
         *    app.enabled('foo')
         *    // => true
         *
         * @param {String} setting
         * @return {Boolean}
         */

        enabled(setting) {
            return Boolean(this.set(setting))
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

        // Delegate `.VERB(...)` calls to `router.VERB(...)`.

        get(path) {
            if (arguments.length === 1) {
                // app.get(setting)
                return this.set(path)
            }

            this.lazyrouter()

            var route = this._router.route(path)
            route.get.apply(route, Array.prototype.slice.call(arguments, 1))
            return this
        },

        post(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            route.post.apply(route, Array.prototype.slice.call(arguments, 1))
            return this
        },

        put(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            route.put.apply(route, Array.prototype.slice.call(arguments, 1))
            return this
        },

        head(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            route.head.apply(route, Array.prototype.slice.call(arguments, 1))
            return this
        },

        delete(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            route.delete.apply(route, Array.prototype.slice.call(arguments, 1))
            return this
        },

        options(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            route.options.apply(
                route,
                Array.prototype.slice.call(arguments, 1)
            )
            return this
        },

        /**
         * Special-cased "all" method, applying the given route `path`,
         * middleware, and callback to _every_ HTTP method.
         *
         * @param {String} path
         * @param {Function} ...
         * @return {app} for chaining
         */
        all(path) {
            this.lazyrouter()

            var route = this._router.route(path)
            var args = Array.prototype.slice.call(arguments, 1)

            methods.forEach(method => route[method].apply(route, args))

            return this
        },

        // del -> delete alias

        del(path) {
            deprecate('app.del: Use app.delete instead')
            this.lazyrouter()

            var route = this._router.route(path)
            route.delete.apply(route, Array.prototype.slice.call(arguments, 1))
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
            var cache = this.cache
            var done = callback
            var engines = this.engines
            var opts = options
            var renderOptions = {}
            var view

            // support callback function as second arg
            if (typeof options === 'function') {
                done = options
                opts = {}
            }

            // merge app.locals
            Object.assign(renderOptions, this.locals)

            // merge options._locals
            if (opts._locals) {
                Object.assign(renderOptions, opts._locals)
            }

            // merge options
            Object.assign(renderOptions, opts)

            // set .cache unless explicitly provided
            if (renderOptions.cache == null) {
                renderOptions.cache = this.enabled('view cache')
            }

            // primed cache
            if (renderOptions.cache) {
                view = cache[name]
            }

            // view
            if (!view) {
                var View = this.get('view')

                view = new View(name, {
                    defaultEngine: this.get('view engine'),
                    root: this.get('views'),
                    engines: engines,
                })

                if (!view.path) {
                    var dirs =
                        Array.isArray(view.root) && view.root.length > 1
                            ? 'directories "' +
                              view.root.slice(0, -1).join('", "') +
                              '" or "' +
                              view.root[view.root.length - 1] +
                              '"'
                            : 'directory "' + view.root + '"'
                    var err = new Error(
                        'Failed to lookup view "' + name + '" in views ' + dirs
                    )
                    err.view = view
                    return done(err)
                }

                // prime the cache
                if (renderOptions.cache) {
                    cache[name] = view
                }
            }

            // Try rendering a view.
            try {
                view.render(renderOptions, done)
            } catch (err) {
                done(err)
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
         *    var http = require('http')
         *      , https = require('https')
         *      , express = require('express')
         *      , app = express();
         *
         *    http.createServer(app).listen(80);
         *    https.createServer({ ... }, app).listen(443);
         *
         * @return {http.Server}
         */
        listen() {
            var server = http.createServer(this.handle.bind(this))
            return server.listen.apply(server, arguments)
        },
    }
}
