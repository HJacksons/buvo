import { createReadStream, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import type { AppData } from '../src/domain/types'
import { getDatabaseInfo, loadStore, replaceStore, resetStore } from './database'

const port = Number(process.env.BUVO_API_PORT ?? 8787)
const distDir = join(process.cwd(), 'dist')

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
        database: getDatabaseInfo(),
      })
      return
    }

    if (requestUrl.pathname === '/api/store' && request.method === 'GET') {
      sendJson(response, 200, {
        data: loadStore(),
        savedAt: new Date().toISOString(),
        storage: 'sqlite',
      })
      return
    }

    if (requestUrl.pathname === '/api/store' && request.method === 'PUT') {
      const body = await readRequestBody(request)
      const parsed = JSON.parse(body) as { data?: AppData }

      if (!parsed.data) {
        sendJson(response, 400, { error: 'Missing data payload.' })
        return
      }

      replaceStore(parsed.data)
      sendJson(response, 200, {
        ok: true,
        savedAt: new Date().toISOString(),
        storage: 'sqlite',
      })
      return
    }

    if (requestUrl.pathname === '/api/store/reset' && request.method === 'POST') {
      resetStore()
      sendJson(response, 200, {
        data: loadStore(),
        savedAt: new Date().toISOString(),
        storage: 'sqlite',
      })
      return
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    serveStatic(requestUrl.pathname, response)
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  const info = getDatabaseInfo()
  console.log(`BUVO POS API running at http://127.0.0.1:${port}`)
  console.log(`SQLite database: ${info.path}`)
})
