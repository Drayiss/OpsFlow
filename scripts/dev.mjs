import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const vite = fileURLToPath(new URL('../frontend/node_modules/vite/bin/vite.js', import.meta.url))
const children = new Set()
let stopping = false

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
  children.add(child)
  child.once('exit', () => children.delete(child))
  child.once('error', () => children.delete(child))
  return child
}

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Command stopped (${signal ?? code}).`))
    })
  })
}

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  // Stop only processes launched here, including dotnet's API child process.
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (!child.pid) return resolve()
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already stopped. */ }
      resolve()
    }
  })))
  console.log('\nOpsFlow launcher stopped.')
  process.exit(code)
}

function portInUse(port, host) {
  return new Promise(resolve => {
    const socket = createConnection({ port, host })
    const finish = busy => { socket.destroy(); resolve(busy) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())

try {
  for (const port of [5092, 5173]) {
    if (await portInUse(port, '127.0.0.1') || await portInUse(port, '::1')) {
      throw new Error(`Port ${port} is already in use. Stop the existing API or frontend in its terminal/Rider, then run npm start again.`)
    }
  }
  if (!existsSync(vite)) {
    throw new Error('Frontend dependencies are missing. Run npm run setup once, then npm start.')
  }
  console.log('Starting PostgreSQL. Make sure Docker Desktop is running.')
  await completed(launch('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '60', 'postgres']))
  if (!stopping) {
    console.log('\nStarting OpsFlow. Open http://localhost:5173 once Vite is ready.')
    console.log('Press Ctrl+C here to stop both the backend and frontend.\n')
    const options = { detached: process.platform !== 'win32' }
    const api = launch('dotnet', ['run', '--project', 'backend/OpsFlow.Api', '--launch-profile', 'http'], options)
    const ui = launch(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      { ...options, cwd: frontend })
    for (const [name, child] of [['Backend', api], ['Frontend', ui]]) {
      child.once('error', error => {
        console.error(`${name} could not start: ${error.message}`)
        void stop(1)
      })
      child.once('exit', code => {
        if (!stopping) {
          console.error(`${name} exited. Stopping the other service.`)
          void stop(code === 0 ? 0 : 1)
        }
      })
    }
  }
} catch (error) {
  console.error(`\n${error.message}`)
  await stop(1)
}
