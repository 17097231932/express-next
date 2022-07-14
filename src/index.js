import createApplicationPrototype from './application'
import request from './request'
import response from './response'

const application = createApplicationPrototype()

/**
 * Create an express application.
 */
export default function createApplication() {
    const app = (req, res, next) => {
        app.handle(req, res, next)
    }

    // mixin(app, EventEmitter.prototype, false)
    Object.assign(app, application)

    // expose the prototype that will get set on requests
    app.request = Object.create(request)
    app.request.app = app

    // expose the prototype that will get set on responses
    app.response = Object.create(response)
    app.response.app = app

    app.init()
    return app
}

export { json, raw, text, urlencoded } from 'body-parser'
export { default as static } from 'serve-static'
export { default as query } from './middleware/query'
export { default as Router } from './router'
export { default as Route } from './router/route'
export { application, request, response }
