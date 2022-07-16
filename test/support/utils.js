var assert = require('assert')
var { Buffer } = require('safe-buffer')

/**
 * Assert that a supertest response has a specific body.
 *
 * @param {Buffer} buf
 * @returns {function}
 */

exports.shouldHaveBody = function shouldHaveBody(buf) {
    return function (res) {
        var body = !Buffer.isBuffer(res.body)
            ? Buffer.from(res.text)
            : res.body
        assert.ok(body, 'response has body')
        assert.strictEqual(body.toString('hex'), buf.toString('hex'))
    }
}

/**
 * Assert that a supertest response does have a header.
 *
 * @param {string} header Header name to check
 * @returns {function}
 */

exports.shouldHaveHeader = function shouldHaveHeader(header) {
    return function (res) {
        assert.ok(
            header.toLowerCase() in res.headers,
            'should have header ' + header
        )
    }
}

/**
 * Assert that a supertest response does not have a body.
 *
 * @returns {function}
 */

exports.shouldNotHaveBody = function shouldNotHaveBody() {
    return function (res) {
        assert.ok(res.text === '' || res.text === undefined)
    }
}

/**
 * Assert that a supertest response does not have a header.
 *
 * @param {string} header Header name to check
 * @returns {function}
 */
exports.shouldNotHaveHeader = function shouldNotHaveHeader(header) {
    return function (res) {
        assert.ok(
            !(header.toLowerCase() in res.headers),
            'should not have header ' + header
        )
    }
}
