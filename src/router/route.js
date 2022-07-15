import { getLogger } from '../utils'
import Layer from './layer'

const debug = getLogger('express:router:route')

export default class Route {
    /**
     * Initialize `Route` with the given `path`,
     *
     * @param {String} path
     * @public
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

    _handles_method(method) {
        if (this.methods._all) {
            return true
        }

        var name = method.toLowerCase()

        if (name === 'head' && !this.methods['head']) {
            name = 'get'
        }

        return Boolean(this.methods[name])
    }

    /**
     * @return {Array} supported HTTP methods
     */

    _options() {
        var methods = Object.keys(this.methods)

        // append automatic head
        if (this.methods.get && !this.methods.head) {
            methods.push('head')
        }

        for (var i = 0; i < methods.length; i++) {
            // make upper case
            methods[i] = methods[i].toUpperCase()
        }

        return methods
    }

    /**
     * dispatch req, res into this route
     */

    dispatch(req, res, done) {
        var idx = 0
        var stack = this.stack
        var sync = 0

        if (stack.length === 0) {
            return done()
        }

        var method = req.method.toLowerCase()
        if (method === 'head' && !this.methods['head']) {
            method = 'get'
        }

        req.route = this

        next()

        function next(err) {
            // signal to exit route
            if (err && err === 'route') {
                return done()
            }

            // signal to exit router
            if (err && err === 'router') {
                return done(err)
            }

            // max sync stack
            if (++sync > 100) {
                return setImmediate(next, err)
            }

            var layer = stack[idx++]

            // end of layers
            if (!layer) {
                return done(err)
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

    all() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                var type = Object.prototype.toString.call(handle)
                var msg =
                    'Route.all() requires a callback function but got a ' +
                    type
                throw new TypeError(msg)
            }

            var layer = new Layer('/', {}, handle)
            layer.method = undefined

            this.methods._all = true
            this.stack.push(layer)
        }

        return this
    }

    // create Route#VERB functions

    get() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.get() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('get %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'get'

            this.methods.get = true
            this.stack.push(layer)
        }

        return this
    }

    post() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.post() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('post %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'post'

            this.methods.post = true
            this.stack.push(layer)
        }

        return this
    }

    put() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.put() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('put %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'put'

            this.methods.put = true
            this.stack.push(layer)
        }

        return this
    }

    head() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.head() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('head %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'head'

            this.methods.head = true
            this.stack.push(layer)
        }

        return this
    }

    delete() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.delete() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('delete %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'delete'

            this.methods.delete = true
            this.stack.push(layer)
        }

        return this
    }

    options() {
        var handles = Array.prototype.slice.call(arguments).flat(Infinity)

        for (var i = 0; i < handles.length; i++) {
            var handle = handles[i]

            if (typeof handle !== 'function') {
                throw new Error(
                    'Route.options() requires a callback function but got a ' +
                        Object.prototype.toString.call(handle)
                )
            }

            debug('options %o', this.path)

            var layer = new Layer('/', {}, handle)
            layer.method = 'options'

            this.methods.options = true
            this.stack.push(layer)
        }

        return this
    }
}
