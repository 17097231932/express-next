import { defineConfig } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import { builtinModules } from 'module'

export default defineConfig({
    input: './lib/index.js',
    output: {
        format: 'cjs',
        file: 'dist/express.js',
        exports: 'default',
    },
    plugins: [commonjs(), resolve(), json()],
    external: builtinModules,
})
