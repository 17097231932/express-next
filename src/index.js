import createApplicationPrototype from './application'
import Request from './request'
import Response from './response'

/**
 * Create an express application.
 */
export default function createApp() {
    const app = (req, res, next) => {
        app.handle(req, res, next)
    }

    const application = createApplicationPrototype()

    Object.assign(app, application)

    app.init()
    return app
}

export { json, raw, text, urlencoded } from 'body-parser'
export { default as static } from './middleware/static'
export { default as query } from './middleware/query'
export { default as Router } from './router'
export { default as Route } from './router/route'
export { createApp, Request, Response }
