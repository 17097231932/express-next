import { parse } from 'url'
import { deprecate, getLogger } from '../utils'
import Layer from './layer'
import Route from './route'

const debug = getLogger('express:router')

/**
 * append methods to a list of methods
 */
function appendMethods(list, addition) {
    return [...new Set([...list, ...addition])]
}

/**
 * get pathname of request
 */
function getPathname(req) {
    try {
        return parse(req.url).pathname
    } catch (err) {
        return undefined
    }
}

/**
 * Get get protocol + host for a URL
 */
function getProtohost(url) {
    if (typeof url !== 'string' || url.length === 0 || url[0] === '/') {
        return undefined
    }

    const searchIndex = url.indexOf('?')
    const pathLength = searchIndex !== -1 ? searchIndex : url.length
    const fqdnIndex = url.slice(0, pathLength).indexOf('://')

    return fqdnIndex !== -1
        ? url.substring(0, url.indexOf('/', 3 + fqdnIndex))
        : undefined
}

/**
 * get type for error message
 */
function gettype(obj) {
    if (typeof obj !== 'object') {
        return typeof obj
    }

    // inspect [[Class]] for objects
    return Object.prototype.toString
        .call(obj)
        .replace(/^\[object (\S+)\]$/, '$1')
}

/**
 * Match path to a layer.
 *
 * @param {Layer} layer
 * @param {string} path
 */
function matchLayer(layer, path) {
    try {
        return layer.match(path)
    } catch (err) {
        return err
    }
}

/**
 * merge params with parent params
 */
function mergeParams(params, parent) {
    if (typeof parent !== 'object' || !parent) {
        return params
    }

    // make copy of parent for base
    const obj = { ...parent }

    // simple non-numeric merging
    if (!(0 in params) || !(0 in parent)) {
        return { ...obj, ...params }
    }

    let i = 0
    let o = 0

    // determine numeric gaps
    while (i in params) {
        i++
    }

    while (o in parent) {
        o++
    }

    // offset numeric indices in params before merge
    for (i--; i >= 0; i--) {
        params[i + o] = params[i]

        // create holes for the merge when necessary
        if (i < o) {
            delete params[i]
        }
    }

    return { ...obj, ...params }
}

/**
 * restore obj props after function
 */
function restore(fn, obj) {
    const props = new Array(arguments.length - 2)
    var vals = new Array(arguments.length - 2)

    for (var i = 0; i < props.length; i++) {
        props[i] = arguments[i + 2]
        vals[i] = obj[props[i]]
    }

    return function () {
        // restore vals
        for (var i = 0; i < props.length; i++) {
            obj[props[i]] = vals[i]
        }

        return fn.apply(this, arguments)
    }
}

/**
 * send an OPTIONS response
 */
function sendOptionsResponse(res, options, next) {
    try {
        const body = options.join(',')
        res.set('Allow', body)
        res.send(body)
    } catch (err) {
        next(err)
    }
}

/**
 * wrap a function
 */
function wrap(old, fn) {
    return function proxy() {
        var args = new Array(arguments.length + 1)

        args[0] = old
        for (var i = 0, len = arguments.length; i < len; i++) {
            args[i + 1] = arguments[i]
        }

        fn.apply(this, args)
    }
}

const proto = {
    params: {},
    _params: [],
    stack: [],
    caseSensitive: null,
    mergeParams: null,
    strict: null,

    init(opts = {}) {
        this.params = {}
        this._params = []
        this.caseSensitive = opts.caseSensitive
        this.mergeParams = opts.mergeParams
        this.strict = opts.strict
        this.stack = []
    },

    /**
     * Map the given param placeholder `name`(s) to the given callback.
     *
     * Parameter mapping is used to provide pre-conditions to routes
     * which use normalized placeholders. For example a _:user_id_ parameter
     * could automatically load a user's information from the database without
     * any additional code,
     *
     * The callback uses the same signature as middleware, the only difference
     * being that the value of the placeholder is passed, in this case the _id_
     * of the user. Once the `next()` function is invoked, just like middleware
     * it will continue on to execute the route, or subsequent parameter functions.
     *
     * Just like in middleware, you must either respond to the request or call next
     * to avoid stalling the request.
     *
     *  app.param('user_id', function(req, res, next, id){
     *    User.find(id, function(err, user){
     *      if (err) {
     *        return next(err);
     *      } else if (!user) {
     *        return next(new Error('failed to load user'));
     *      }
     *      req.user = user;
     *      next();
     *    });
     *  });
     *
     * @param {String} name
     * @param {Function} fn
     * @return {app} for chaining
     */
    param(name, fn) {
        // param logic
        if (typeof name === 'function') {
            deprecate('router.param(fn): Refactor to use path params')
            this._params.push(name)
            return
        }

        if (name[0] === ':') {
            const depdName = name
            name = name.slice(1)
            deprecate(
                `router.param('${depdName}', fn): Use router.param('${name}', fn) instead`
            )
        }

        // apply param functions
        for (const param of this._params) {
            let ret = param(name, fn)
            if (ret) {
                fn = ret
            }
        }

        // ensure we end up with a middleware function
        if (typeof fn !== 'function') {
            throw new Error(`invalid param() call for ${name}, got ${fn}`)
        }

        // init
        if (!this.params[name]) {
            this.params[name] = []
        }

        this.params[name].push(fn)

        return this
    },

    /**
     * Dispatch a req, res into the router.
     */
    handle(req, res, out) {
        const self = this

        debug('dispatching %s %s', req.method, req.url)

        let idx = 0
        var protohost = getProtohost(req.url) || ''
        var removed = ''
        var slashAdded = false
        var sync = 0
        var paramcalled = {}

        // store options for OPTIONS request
        // only used if OPTIONS request
        var options = []

        // middleware and routes
        var stack = this.stack

        // manage inter-router variables
        var parentParams = req.params
        var parentUrl = req.baseUrl || ''
        var done = restore(out, req, 'baseUrl', 'next', 'params')

        // setup next layer
        req.next = next

        // for options requests, respond with a default if nothing else responds
        if (req.method === 'OPTIONS') {
            done = wrap(done, function (old, err) {
                if (err || options.length === 0) return old(err)
                sendOptionsResponse(res, options, old)
            })
        }

        // setup basic req values
        req.baseUrl = parentUrl
        req.originalUrl = req.originalUrl || req.url

        next()

        function trim_prefix(layer, layerError, layerPath, path) {
            if (layerPath.length !== 0) {
                // Validate path is a prefix match
                if (layerPath !== path.slice(0, layerPath.length)) {
                    next(layerError)
                    return
                }

                // Validate path breaks on a path separator
                var c = path[layerPath.length]
                if (c && c !== '/' && c !== '.') return next(layerError)

                // Trim off the part of the url that matches the route
                // middleware (.use stuff) needs to have the path stripped
                debug('trim prefix (%s) from url %s', layerPath, req.url)
                removed = layerPath
                req.url =
                    protohost +
                    req.url.slice(protohost.length + removed.length)

                // Ensure leading slash
                if (!protohost && req.url[0] !== '/') {
                    req.url = '/' + req.url
                    slashAdded = true
                }

                // Setup base URL (no trailing slash)
                req.baseUrl =
                    parentUrl +
                    (removed[removed.length - 1] === '/'
                        ? removed.substring(0, removed.length - 1)
                        : removed)
            }

            debug('%s %s : %s', layer.name, layerPath, req.originalUrl)

            if (layerError) {
                layer.handle_error(layerError, req, res, next)
            } else {
                layer.handle_request(req, res, next)
            }
        }

        function next(err) {
            var layerError = err === 'route' ? null : err

            // remove added slash
            if (slashAdded) {
                req.url = req.url.slice(1)
                slashAdded = false
            }

            // restore altered req.url
            if (removed.length !== 0) {
                req.baseUrl = parentUrl
                req.url = protohost + removed + req.url.slice(protohost.length)
                removed = ''
            }

            // signal to exit router
            if (layerError === 'router') {
                setImmediate(done, null)
                return
            }

            // no more matching layers
            if (idx >= stack.length) {
                setImmediate(done, layerError)
                return
            }

            // max sync stack
            if (++sync > 100) {
                return setImmediate(next, err)
            }

            // get pathname of request
            var path = getPathname(req)

            if (path == null) {
                return done(layerError)
            }

            // find next matching layer
            var layer
            var match
            var route

            while (match !== true && idx < stack.length) {
                layer = stack[idx++]
                match = matchLayer(layer, path)
                route = layer.route

                if (typeof match !== 'boolean') {
                    // hold on to layerError
                    layerError = layerError || match
                }

                if (match !== true) {
                    continue
                }

                if (!route) {
                    // process non-route handlers normally
                    continue
                }

                if (layerError) {
                    // routes do not match with a pending error
                    match = false
                    continue
                }

                var method = req.method
                var has_method = route._can_handle(method)

                // build up automatic options response
                if (!has_method && method === 'OPTIONS') {
                    options = appendMethods(
                        options,
                        route._handleable_method()
                    )
                }

                // don't even bother matching route
                if (!has_method && method !== 'HEAD') {
                    match = false
                }
            }

            // no match
            if (match !== true) {
                return done(layerError)
            }

            // store route for dispatch on change
            if (route) {
                req.route = route
            }

            // Capture one-time layer values
            req.params = self.mergeParams
                ? mergeParams(layer.params, parentParams)
                : layer.params
            var layerPath = layer.path

            // this should be done for the layer
            self.process_params(layer, paramcalled, req, res, function (err) {
                if (err) {
                    next(layerError || err)
                } else if (route) {
                    layer.handle_request(req, res, next)
                } else {
                    trim_prefix(layer, layerError, layerPath, path)
                }

                sync = 0
            })
        }
    },

    /**
     * Process any parameters for the layer.
     */
    process_params(layer, called, req, res, done) {
        var params = this.params

        // captured parameters from the layer, keys and values
        var keys = layer.keys

        // fast track
        if (!keys || keys.length === 0) {
            return done()
        }

        var i = 0
        var name
        var paramIndex = 0
        var key
        var paramVal
        var paramCallbacks
        var paramCalled

        // process params in order
        // param callbacks can be async
        function param(err) {
            if (err) {
                return done(err)
            }

            if (i >= keys.length) {
                return done()
            }

            paramIndex = 0
            key = keys[i++]
            name = key.name
            paramVal = req.params[name]
            paramCallbacks = params[name]
            paramCalled = called[name]

            if (paramVal === undefined || !paramCallbacks) {
                return param()
            }

            // param previously called with same value or error occurred
            if (
                paramCalled &&
                (paramCalled.match === paramVal ||
                    (paramCalled.error && paramCalled.error !== 'route'))
            ) {
                // restore value
                req.params[name] = paramCalled.value

                // next param
                return param(paramCalled.error)
            }

            called[name] = paramCalled = {
                error: null,
                match: paramVal,
                value: paramVal,
            }

            paramCallback()
        }

        // single param callbacks
        function paramCallback(err) {
            var fn = paramCallbacks[paramIndex++]

            // store updated value
            paramCalled.value = req.params[key.name]

            if (err) {
                // store error
                paramCalled.error = err
                param(err)
                return
            }

            if (!fn) return param()

            try {
                fn(req, res, paramCallback, paramVal, key.name)
            } catch (e) {
                paramCallback(e)
            }
        }

        param()
    },

    /**
     * Use the given middleware function, with optional path, defaulting to "/".
     *
     * Use (like `.all`) will run for any http METHOD, but it will not add
     * handlers for those methods so OPTIONS requests will not consider `.use`
     * functions even if they could respond.
     *
     * The other difference is that _route_ path is stripped and not visible
     * to the handler function. The main effect of this feature is that mounted
     * handlers can operate without any code changes regardless of the "prefix"
     * pathname.
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

        const callbacks = args.flat(Infinity)

        if (!path) {
            if (typeof callbacks[0] !== 'function') {
                path = callbacks.shift()
            } else {
                path = '/'
            }
        }

        if (!callbacks.length) {
            throw new TypeError('Router.use() requires a middleware function')
        }

        for (const fn of callbacks) {
            if (typeof fn !== 'function') {
                throw new TypeError(
                    'Router.use() requires a middleware function but got a ' +
                        gettype(fn)
                )
            }

            // add the middleware
            debug('use %o %s', path, fn.name || '<anonymous>')

            const layer = new Layer(
                path,
                {
                    sensitive: this.caseSensitive,
                    strict: false,
                    end: false,
                },
                fn
            )

            layer.route = undefined

            this.stack.push(layer)
        }

        return this
    },

    /**
     * Create a new Route for the given path.
     *
     * Each route contains a separate middleware stack and VERB handlers.
     *
     * See the Route api documentation for details on adding handlers
     * and middleware to routes.
     *
     * @param {String} path
     * @return {Route}
     */
    route(path) {
        const route = new Route(path)

        const layer = new Layer(
            path,
            {
                sensitive: this.caseSensitive,
                strict: this.strict,
                end: true,
            },
            route.dispatch.bind(route)
        )

        layer.route = route

        this.stack.push(layer)
        return route
    },

    // create Router#VERB functions
    _registerRouteHandler(method, path, middlewares) {
        this.route(path)[method](...middlewares)
        return this
    },

    get(path, ...middlewares) {
        return this._registerRouteHandler('get', path, middlewares)
    },

    post(path, ...middlewares) {
        return this._registerRouteHandler('post', path, middlewares)
    },

    put(path, ...middlewares) {
        return this._registerRouteHandler('put', path, middlewares)
    },

    head(path, ...middlewares) {
        return this._registerRouteHandler('head', path, middlewares)
    },

    delete(path, ...middlewares) {
        return this._registerRouteHandler('delete', path, middlewares)
    },

    options(path, ...middlewares) {
        return this._registerRouteHandler('options', path, middlewares)
    },

    all(path, ...middlewares) {
        return this._registerRouteHandler('all', path, middlewares)
    },
}

/**
 * Initialize a new `Router` with the given `options`.
 *
 * @param {Object} [options]
 * @return {Router} which is an callable function
 */

export default function createRouter(options = {}) {
    function router(req, res, next) {
        router.handle(req, res, next)
    }

    // mixin Router class functions
    Object.setPrototypeOf(router, proto)

    router.init(options || {})
    return router
}
