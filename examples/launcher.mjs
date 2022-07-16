import express from 'express'
import { readdir, stat } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import cluster from 'cluster'
import process from 'process'
import net from 'net'
import { install } from 'source-map-support'

install()

const indexHtmlContent = /* html */ `<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Express Example Lunacher</title>
    </head>
    <body>
        <div id="app">
            <h1>Instance List</h1>
            <div id="instances">Nothing.</div>
            <h1>Example List</h1>
            <div id="projects">Loading...</div>
        </div>
        <script>
            async function createInstance(name) {
                const res = await fetch('/api/createInstance/' + name)
                const data = await res.json()
                if (data.status !== 'ok') {
                    alert(data.status)
                }
                await loadInstanceList()
            }

            async function deleteInstance(id) {
                const res = await fetch('/api/deleteInstance/' + id)
                const data = await res.json()
                if (data.status !== 'ok') {
                    alert(data.status)
                }
                await loadInstanceList()
            }

            async function loadProjectsData() {
                const res = await fetch('/api/projectList')
                const data = await res.json()
                const fragment = document.createElement('ul')
                for (const name of data) {
                    const el = document.createElement('li')
                    const button = document.createElement('button')
                    button.appendChild(
                        document.createTextNode('Create a instance')
                    )
                    button.addEventListener('click', () => createInstance(name))
                    el.appendChild(button)
                    el.appendChild(document.createTextNode(' '))
                    el.appendChild(document.createTextNode(name))
                    fragment.appendChild(el)
                }
                const div = document.querySelector('#projects')
                div.innerHTML = ''
                div.appendChild(fragment)
            }

            async function loadInstanceList() {
                const res = await fetch('/api/instanceList')
                const data = await res.json()
                const div = document.querySelector('#instances')
                if (data.length) {
                    const fragment = document.createElement('ul')
                    for (const instance of data) {
                        const {id, name, port} = instance
                        const displayName = name + '-' + id

                        const el = document.createElement('li')
                        const killButton = document.createElement('button')
                        killButton.appendChild(document.createTextNode('Remove'))
                        killButton.addEventListener('click', () => deleteInstance(id))
                        const openLink = document.createElement('a')
                        openLink.appendChild(document.createTextNode('Open'))
                        openLink.href = 'http://localhost:' + port + '/'
                        openLink.target = '_blank'
                        el.appendChild(killButton)
                        el.appendChild(document.createTextNode(' '))
                        el.appendChild(openLink)
                        el.appendChild(document.createTextNode(' '))
                        el.appendChild(document.createTextNode(displayName))
                        fragment.appendChild(el)
                    }
                    div.innerHTML = ''
                    div.appendChild(fragment)
                } else {
                    div.innerHTML = 'Nothing.'
                }
            }

            loadInstanceList()
            loadProjectsData()
        </script>
    </body>
</html>

`

const workers = []
let id = 1

const debugPorts = range(10000, 20000)
function range(from, to) {
    const items = []
    for (let i = from; i <= to; ++i) {
        items.push(i)
    }
    return items
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        if (debugPorts.length === 0) {
            return reject()
        }
        const port = debugPorts.shift()
        let server = net.createServer().listen(port)
        server.on('listening', () => {
            server.close()
            resolve(port)
        })
        server.on('error', (err) => {
            if (err.code == 'EADDRINUSE') {
                getFreePort()
            } else {
                throw err
            }
        })
    })
}

function startupExample(name, port) {
    return new Promise((resolve, reject) => {
        const worker = cluster.fork({
            name,
            port,
        })
        worker.on('message', message => {
            if (message.type === 'ready') {
                resolve(worker)
            } else {
                reject(new Error(message))
            }
        })
        worker.on('error', reject)
    })
}

async function runExample(name) {
    const port = await getFreePort()
    const worker = await startupExample(name, port)
    workers.push({ worker, port, name, id: id++ })
    return worker
}

function killWorker(instanceID) {
    const workers = getWorkerList()
    const index = workers.findIndex(({ id }) => id === instanceID)
    workers[index].worker.send({ type: 'close' })
    workers[index].worker.kill()
    workers.splice(index, 1)
}

function getWorkerList() {
    return workers
}

if (cluster.isWorker) {
    const { name, port } = process.env
    try {
        const module = await import(`./${name}/index.js`)
        /** @type {import('express').Express} */
        const app = module['default']
        const server = app.listen(parseInt(port), () => {
            process.send({ type: 'ready' })
            console.log(`Example ${name} started on port ${port}`)
        })
        process.on('message', ({ type }) => {
            if (type === 'close') {
                server.close()
            }
        })
    } catch (e) {
        console.error(e)
        process.send({ type: 'error' })
    }
} else {
    const exampleDirectory = dirname(fileURLToPath(import.meta.url))

    const app = express()

    app.get('/', (req, res) => {
        res.end(indexHtmlContent)
    })

    app.get('/api/projectList', async (req, res) => {
        const files = await readdir(exampleDirectory)
        const dirs = []
        for (const filename of files) {
            if (['node_modules'].includes(filename)) {
                continue
            }
            if ((await stat(join(exampleDirectory, filename))).isDirectory()) {
                dirs.push(filename)
            }
        }

        res.json(dirs)
    })

    app.get('/api/instanceList', async (req, res) => {
        const list = getWorkerList()
        const data = list.map(({ name, port, id }) => ({
            id,
            name,
            port,
        }))
        res.json(data)
    })

    app.get('/api/createInstance/:name', async (req, res) => {
        try {
            await runExample(req.params.name)
            res.json({ status: 'ok' })
        } catch (e) {
            res.json({ status: 'error' })
        }
    })

    app.get('/api/deleteInstance/:id', (req, res) => {
        try {
            killWorker(parseInt(req.params.id))
            res.json({ status: 'ok' })
        } catch (e) {
            console.error(e)
            res.json({ status: 'error' })
        }
    })

    app.listen(8080)
    console.log('Local: http://localhost:8080')
}
