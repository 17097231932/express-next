import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import { readFileSync } from 'fs'
import { builtinModules } from 'module'
import { defineConfig } from 'rollup'

const { dependencies = {} } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig([
    {
        input: './src/index.js',
        output: [
            {
                format: 'cjs',
                file: 'dist/express.cjs.js',
                exports: 'named',
                banner: '// DO NOT USE THIS BUNDLES DIRECTLY !!!',
                sourcemap: true,
            },
            {
                format: 'es',
                file: 'dist/express.esm.mjs',
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
                sourcemap: true,
            },
        ],
        plugins: [resolve()],
        external: [...builtinModules, ...Object.keys(dependencies)],
    },
])
