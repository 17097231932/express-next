import { EventEmitter } from 'events'
import mixin from 'merge-descriptors'
import application from './application'
import request from './request'
import response from './response'

/**
 * Create an express application.
 *
 * @return {Function}
 * @api public
 */

export default function createApplication() {
    var app = function (req, res, next) {
        app.handle(req, res, next)
    }

    mixin(app, EventEmitter.prototype, false)
    mixin(app, application, false)

    // expose the prototype that will get set on requests
    app.request = Object.create(request, {
        app: {
            configurable: true,
            enumerable: true,
            writable: true,
            value: app,
        },
    })

    // expose the prototype that will get set on responses
    app.response = Object.create(response, {
        app: {
            configurable: true,
            enumerable: true,
            writable: true,
            value: app,
        },
    })

    app.init()
    return app
}

export { json, raw, text, urlencoded } from 'body-parser'
export { default as static } from 'serve-static'
export { default as query } from './middleware/query'
export { default as Router } from './router'
export { default as Route } from './router/route'
export { application, request, response }
