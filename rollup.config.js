import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import { readFileSync } from 'fs'
import { builtinModules } from 'module'
import { defineConfig } from 'rollup'
import { execSync } from 'child_process'

const { dependencies = {} } = JSON.parse(
    readFileSync('./package.json', 'utf-8')
)

const commitId = execSync('git rev-parse HEAD').toString().trim()

const hasUncommit =
    execSync('git status --short').toString().trim().length !== 0

const banner = `/*!
 * express-next@${commitId}${hasUncommit ? '-working' : ''}
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */
`

export default defineConfig([
    {
        input: './src/index.js',
        output: [
            {
                format: 'cjs',
                file: 'dist/express.cjs-bundle.js',
                exports: 'named',
                banner: banner + '// DO NOT USE THIS BUNDLES DIRECTLY !!!',
                sourcemap: true,
            },
            {
                format: 'es',
                file: 'dist/express.esm.mjs',
                banner,
                sourcemap: true,
            },
        ],
        plugins: [commonjs(), resolve(), json()],
        external: builtinModules,
    },
    {
        input: './src/index.js',
        output: [
            {
                format: 'es',
                file: 'dist/express.esm-bundler.js',
                banner,
                sourcemap: true,
            },
        ],
        plugins: [resolve()],
        external: [...builtinModules, ...Object.keys(dependencies)],
    },
])
