import { createReadStream, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import type { AppData } from '../src/domain/types'
import { createDataStore } from './store'

const port = Number(process.env.BUVO_API_PORT ?? 8787)
const distDir = process.env.BUVO_DIST_DIR ?? join(process.cwd(), 'dist')
const store = await createDataStore()

const mimeTypes: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

const readRequestBody = async (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')

      if (body.length > 15_000_000) {
        request.destroy()
        reject(new Error('Request body is too large.'))
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })

const serveStatic = (urlPath: string, response: ServerResponse) => {
  const requestedPath = urlPath === '/' ? '/index.html' : urlPath
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(distDir, safePath)
  const fallbackPath = join(distDir, 'index.html')
  const finalPath = existsSync(filePath) ? filePath : fallbackPath

  if (!existsSync(finalPath)) {
    sendJson(response, 404, {
      error: 'Frontend build not found. Run npm run build or use npm run dev.',
    })
    return
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(finalPath)] ?? 'application/octet-stream',
  })
  createReadStream(finalPath).pipe(response)
}

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)

  try {
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        database: await store.getDatabaseInfo(),
      })
      return
    }

    if (requestUrl.pathname === '/api/store' && request.method === 'GET') {
      const database = await store.getDatabaseInfo()

      sendJson(response, 200, {
        data: await store.loadStore(),
        revision: database.revision,
        savedAt: new Date().toISOString(),
        storage: database.engine,
      })
      return
    }

    if (requestUrl.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await readRequestBody(request)
      const parsed = JSON.parse(body) as { pin?: string; staffNumber?: string }
      const user = await store.authenticateUser(parsed.staffNumber ?? '', parsed.pin ?? '')

      if (!user) {
        sendJson(response, 401, { error: 'Incorrect staff number, PIN, or inactive user.' })
        return
      }

      sendJson(response, 200, { user })
      return
    }

    if (requestUrl.pathname === '/api/auth/unlock' && request.method === 'POST') {
      const body = await readRequestBody(request)
      const parsed = JSON.parse(body) as { pin?: string; userId?: string }
      const user = await store.unlockUser(parsed.userId ?? '', parsed.pin ?? '')

      if (!user) {
        sendJson(response, 401, { error: 'Incorrect PIN or inactive user.' })
        return
      }

      sendJson(response, 200, { user })
      return
    }

    if (requestUrl.pathname === '/api/store' && request.method === 'PUT') {
      const body = await readRequestBody(request)
      const parsed = JSON.parse(body) as { data?: AppData; revision?: number | null }

      if (!parsed.data) {
        sendJson(response, 400, { error: 'Missing data payload.' })
        return
      }

      const result = await store.replaceStore(parsed.data, {
        expectedRevision: parsed.revision,
      })
      const database = await store.getDatabaseInfo()
      sendJson(response, 200, {
        ok: true,
        revision: result.revision,
        savedAt: new Date().toISOString(),
        storage: database.engine,
      })
      return
    }

    if (requestUrl.pathname === '/api/store/reset' && request.method === 'POST') {
      const data = await store.resetStore()
      const database = await store.getDatabaseInfo()
      sendJson(response, 200, {
        data,
        revision: database.revision,
        savedAt: new Date().toISOString(),
        storage: database.engine,
      })
      return
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    serveStatic(requestUrl.pathname, response)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Store changed on another counter')
    ) {
      sendJson(response, 409, { error: error.message })
      return
    }

    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  void store.getDatabaseInfo().then((info) => {
    console.log(`BUVO POS API running at http://127.0.0.1:${port}`)
    console.log(`${info.engine} database: ${info.location}`)
  })
})
