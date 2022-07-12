import { EventEmitter } from 'events'
import mixin from 'merge-descriptors'
import application from './application'
import Route from './router/route'
import Router from './router'
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

import { json, raw, text, urlencoded } from 'body-parser'
import query from './middleware/query'
import serveStatic from 'serve-static'

createApplication.application = application
createApplication.request = request
createApplication.response = response
createApplication.Route = Route
createApplication.Router = Router
createApplication.json = json
createApplication.raw = raw
createApplication.text = text
createApplication.urlencoded = urlencoded
createApplication.query = query
createApplication['static'] = serveStatic
