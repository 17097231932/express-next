var bundle = require('./dist/express.cjs')

module.exports = bundle['default']

for (var key in bundle) {
    if (key !== 'defalut') {
        module.exports[key] = bundle[key]
    }
}
