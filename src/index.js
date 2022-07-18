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

    Object.assign(app, application)

    // expose the prototype that will get set on requests
    app.request = { app }
    Object.setPrototypeOf(app.request, request)

    // expose the prototype that will get set on responses
    app.response = { app }
    Object.setPrototypeOf(app.response, response)

    app.init()
    return app
}

export { json, raw, text, urlencoded } from 'body-parser'
export { default as static } from 'serve-static'
export { default as query } from './middleware/query'
export { default as Router } from './router'
export { default as Route } from './router/route'
export { createApplication as createApp, application, request, response }
