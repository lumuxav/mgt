const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron')
const path = require('node:path')
const { APP_URL, RELEASES_URL, isAppUrl, isExternalUrl, canRequestCamera } = require('./policy.cjs')

// Some AppImage launchers add this flag on hosts without user namespaces.
// Never open business data in an unsandboxed renderer.
if (app.commandLine.hasSwitch('no-sandbox')) {
  dialog.showErrorBox('MGT requires browser sandboxing', 'This computer cannot start MGT with sandboxing enabled. Use https://mgt-lake.vercel.app in your browser or ask your administrator to configure sandbox support.')
  app.exit(1)
}
app.enableSandbox()

let mainWindow
let cameraAllowed = false
const externalPrompts = new Set()

async function openExternal(url) {
  if (!isExternalUrl(url) || externalPrompts.size > 0 || !mainWindow || mainWindow.isDestroyed()) return
  externalPrompts.add(url)
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Open in your browser?',
      message: `Open ${new URL(url).hostname} in your browser?`,
      detail: url, buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0,
    })
    if (response === 1) await shell.openExternal(url)
  } finally { externalPrompts.delete(url) }
}

function loadWorkspace() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(APP_URL).catch(() => {})
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'MGT Business Suite', width: 1366, height: 900, minWidth: 390, minHeight: 400,
    backgroundColor: '#10243a', show: false,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../public/icons/mgt-icon-512.png'),
    webPreferences: {
      partition: 'persist:mgt', nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  const contents = mainWindow.webContents
  contents.on('will-attach-webview', event => event.preventDefault())
  // Subframes cannot navigate out to local files or third-party documents either.
  contents.on('will-frame-navigate', event => {
    if (!isAppUrl(event.url)) {
      event.preventDefault()
      if (event.isMainFrame && isAppUrl(contents.getURL())) openExternal(event.url).catch(() => {})
    }
  })
  contents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault() })
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) contents.loadURL(url).catch(() => {})
    else if (isAppUrl(contents.getURL())) openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isAppUrl(url)) mainWindow.loadFile(path.join(__dirname, 'offline.html')).catch(() => {})
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null; cameraAllowed = false })
  loadWorkspace()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.mgt.businesssuite.desktop')
    const ses = session.fromPartition('persist:mgt')
    ses.setPermissionCheckHandler((contents, permission, origin, details) =>
      Boolean(cameraAllowed && contents && isAppUrl(contents.getURL()) && isAppUrl(origin) &&
        details.isMainFrame && permission === 'media' && details.mediaType === 'video'))
    ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (!contents || !canRequestCamera(contents.getURL(), permission, details) || !mainWindow) return callback(false)
      try {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question', title: 'Camera access', message: 'Allow MGT to use your camera to scan barcodes?',
          buttons: ['Not now', 'Allow camera'], defaultId: 0, cancelId: 0,
        })
        cameraAllowed = response === 1 && !contents.isDestroyed() && isAppUrl(contents.getURL())
        callback(cameraAllowed)
      } catch { callback(false) }
    })
    ses.on('will-download', (event, item, contents) => {
      if (!contents || !isAppUrl(contents.getURL())) { event.preventDefault(); return }
      // Keep Chromium's Save dialog; never open downloaded files automatically.
      item.setSaveDialogOptions({ title: 'Save MGT download' })
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [
        { label: 'Open workspace', click: loadWorkspace },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print() },
        { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [
        { label: 'Latest app downloads', click: () => openExternal(RELEASES_URL).catch(() => {}) },
        { label: 'About MGT', click: () => dialog.showMessageBox(mainWindow, { title: 'MGT Business Suite', message: 'MGT Business Suite', detail: `Version ${app.getVersion()}` }) },
      ] },
    ]))
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
