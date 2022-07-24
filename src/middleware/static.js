import escapeHtml from 'escape-html'
import { resolve } from 'path'
import send from 'send'
import { format, parse } from 'url'
import { encodeurl } from '../utils'

/**
 * Collapse all leading slashes into a single slash
 * @param {string} str
 */
function collapseLeadingSlashes(str) {
    let slashesCount
    for (let i = 0; i < str.length; i++) {
        if (str.charAt(i) !== '/') {
            slashesCount = i
            break
        }
    }

    return slashesCount > 1 ? '/' + str.slice(slashesCount) : str
}

/**
 * Create a minimal HTML document.
 *
 * @param {string} title
 * @param {string} body
 */

function createHtmlDocument(title, body) {
    return (
        '<!DOCTYPE html>\n' +
        '<html lang="en">\n' +
        '<head>\n' +
        '<meta charset="utf-8">\n' +
        '<title>' +
        title +
        '</title>\n' +
        '</head>\n' +
        '<body>\n' +
        '<pre>' +
        body +
        '</pre>\n' +
        '</body>\n' +
        '</html>\n'
    )
}

/**
 * Create a directory listener that just 404s.
 */

function createNotFoundDirectoryListener() {
    return function notFound() {
        this.error(404)
    }
}

/**
 * Create a directory listener that performs a redirect.
 */

function createRedirectDirectoryListener() {
    return function redirect(res) {
        if (this.hasTrailingSlash()) {
            this.error(404)
            return
        }

        // get original URL
        const originalUrl = parse(this.req.originalUrl)

        // append trailing slash
        originalUrl.path = null
        originalUrl.pathname = collapseLeadingSlashes(
            originalUrl.pathname + '/'
        )

        // reformat the URL
        const loc = encodeurl(format(originalUrl))
        const doc = createHtmlDocument(
            'Redirecting',
            'Redirecting to <a href="' +
                escapeHtml(loc) +
                '">' +
                escapeHtml(loc) +
                '</a>'
        )

        // send redirect response
        res.statusCode = 301
        res.setHeader('Content-Type', 'text/html; charset=UTF-8')
        res.setHeader('Content-Length', Buffer.byteLength(doc))
        res.setHeader('Content-Security-Policy', "default-src 'none'")
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Location', loc)
        res.end(doc)
    }
}

/**
 * @param {string} root
 * @param {object} [opts]
 * @return {function}
 */

export default function serveStatic(root, opts = {}) {
    if (!root) {
        throw new TypeError('root path required')
    }

    if (typeof root !== 'string') {
        throw new TypeError('root path must be a string')
    }

    const { fallthrough, redirect, setHeaders, ...sendOptions } = opts

    if (setHeaders && typeof setHeaders !== 'function') {
        throw new TypeError('option setHeaders must be function')
    }

    // setup options for send
    sendOptions.maxage = opts.maxage || opts.maxAge || 0
    sendOptions.root = resolve(root)

    // construct directory listener
    const onDirectory =
        redirect !== false
            ? createRedirectDirectoryListener()
            : createNotFoundDirectoryListener()

    return function serveStatic(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (fallthrough !== false) {
                return next()
            }

            // method not allowed
            res.statusCode = 405
            res.setHeader('Allow', 'GET, HEAD')
            res.setHeader('Content-Length', '0')
            res.end()
            return
        }

        let forwardError = fallthrough === false
        const pathname = parse(req.originalUrl).pathname
        let path = parse(req.url).pathname

        // make sure redirect occurs at mount
        if (path === '/' && pathname.slice(-1) !== '/') {
            path = ''
        }

        // create send stream
        const stream = send(req, path, sendOptions)

        // add directory handler
        stream.on('directory', onDirectory)

        // add headers listener
        if (setHeaders) {
            stream.on('headers', setHeaders)
        }

        // add file listener for fallthrough
        if (fallthrough !== false) {
            stream.on('file', () => {
                // once file is determined, always forward error
                forwardError = true
            })
        }

        // forward errors
        stream.on('error', err => {
            if (forwardError || !(err.statusCode < 500)) {
                next(err)
                return
            }

            next()
        })

        // pipe
        stream.pipe(res)
    }
}
