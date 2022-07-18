import { getLogger } from '../utils'
import Layer from './layer'

const debug = getLogger('express:router:route')

export default class Route {
    /**
     * Initialize `Route` with the given `path`,
     *
     * @param {String} path
     */
    constructor(path) {
        this.path = path
        this.stack = []

        debug('new %o', path)

        // route handlers for various http methods
        this.methods = {}
    }

    /**
     * Determine if the route handles a given method.
     */

    _can_handle(method) {
        if (this.methods._all) {
            return true
        }

        let name = method.toLowerCase()

        if (name === 'head' && !this.methods['head']) {
            name = 'get'
        }

        return !!this.methods[name]
    }

    /**
     * @return {Array} supported HTTP methods
     */

    _handleable_method() {
        const methods = Object.keys(this.methods)

        // append automatic head
        if (methods.includes('get') && !methods.includes('head')) {
            methods.push('head')
        }

        // make upper case
        return methods.map(v => v.toUpperCase())
    }

    /**
     * dispatch req, res into this route
     */

    dispatch(req, res, callback) {
        let index = 0
        const stack = this.stack
        let sync = 0

        if (stack.length === 0) {
            return callback()
        }

        let method = req.method.toLowerCase()
        if (method === 'head' && !this.methods['head']) {
            method = 'get'
        }

        req.route = this

        next()

        function next(err) {
            // signal to exit route
            if (err && err === 'route') {
                return callback()
            }

            // signal to exit router
            if (err && err === 'router') {
                return callback(err)
            }

            // max sync stack
            if (++sync > 100) {
                return setImmediate(next, err)
            }

            const layer = stack[index++]

            // end of layers
            if (!layer) {
                return callback(err)
            }

            if (layer.method && layer.method !== method) {
                next(err)
            } else if (err) {
                layer.handle_error(err, req, res, next)
            } else {
                layer.handle_request(req, res, next)
            }

            sync = 0
        }
    }

    /**
     * Add a handler for all HTTP verbs to this route.
     *
     * Behaves just like middleware and can respond or call `next`
     * to continue processing.
     *
     * You can use multiple `.all` call to add multiple handlers.
     *
     *   function check_something(req, res, next){
     *     next();
     *   };
     *
     *   function validate_user(req, res, next){
     *     next();
     *   };
     *
     *   route
     *   .all(validate_user)
     *   .all(check_something)
     *   .get(function(req, res, next){
     *     res.send('hello world');
     *   });
     *
     * @param {function} handler
     * @return {Route} for chaining
     */

    all(...handles) {
        for (const handle of handles.flat(Infinity)) {
            if (typeof handle !== 'function') {
                const type = Object.prototype.toString.call(handle)
                throw new TypeError(
                    `Route.all() requires a callback function but got a ${type}`
                )
            }

            const layer = new Layer('/', {}, handle)
            layer.method = undefined

            this.methods._all = true
            this.stack.push(layer)
        }

        return this
    }

    // create Route#VERB functions

    _registerRouteHandler(method, handles) {
        for (const handle of handles.flat(Infinity)) {
            if (typeof handle !== 'function') {
                const type = Object.prototype.toString.call(handle)
                throw new Error(
                    `Route.${method}() requires a callback function but got a ${type}`
                )
            }

            debug('%s %o', method, this.path)

            const layer = new Layer('/', {}, handle)
            layer.method = method

            this.methods[method] = true
            this.stack.push(layer)
        }

        return this
    }

    get(...handles) {
        return this._registerRouteHandler('get', handles)
    }

    post(...handles) {
        return this._registerRouteHandler('post', handles)
    }

    put(...handles) {
        return this._registerRouteHandler('put', handles)
    }

    head(...handles) {
        return this._registerRouteHandler('head', handles)
    }

    delete(...handles) {
        return this._registerRouteHandler('delete', handles)
    }

    options(...handles) {
        return this._registerRouteHandler('options', handles)
    }
}
