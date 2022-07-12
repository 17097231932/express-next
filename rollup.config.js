import { defineConfig } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import { builtinModules } from 'module'

export default defineConfig({
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
})
