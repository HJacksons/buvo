const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')

const port = process.env.BUVO_API_PORT || '8787'
const apiUrl = `http://127.0.0.1:${port}`
const devRendererUrl = process.env.BUVO_ELECTRON_RENDERER_URL

let mainWindow = null
let apiProcess = null

const waitForApi = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/api/health`)

      if (response.ok) {
        return
      }
    } catch {
      // The local API may still be booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error('BUVO local API did not start.')
}

const startPackagedApi = () => {
  if (devRendererUrl) {
    return
  }

  const appPath = app.getAppPath()
  const serverEntry = path.join(appPath, 'dist-server', 'index.mjs')

  apiProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      BUVO_API_PORT: port,
      BUVO_DB_PATH:
        process.env.BUVO_DB_PATH || path.join(app.getPath('userData'), 'buvo-pos.sqlite'),
      BUVO_DIST_DIR: path.join(appPath, 'dist'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'ignore',
  })
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    backgroundColor: '#f8faf6',
    height: 820,
    minHeight: 720,
    minWidth: 1120,
    show: false,
    title: 'BUVO POS',
    width: 1280,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)

    return { action: 'deny' }
  })

  await waitForApi()
  await mainWindow.loadURL(devRendererUrl || apiUrl)
  mainWindow.show()
}

app.whenReady().then(async () => {
  startPackagedApi()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('before-quit', () => {
  apiProcess?.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
