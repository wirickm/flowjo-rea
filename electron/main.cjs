// macOS desktop shell: opens the single-file build (dist/index.html) in its
// own window. No Node access in the page, and no network: every request that
// is not file:, data: or blob: is cancelled, so the app stays local-only.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'dist', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'flowjo-rea',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links open in the default browser; the window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.loadFile(INDEX);
  return win;
}

// The page owns the FlowJo shortcuts (Cmd+Z, Shift+Cmd+Z, Cmd+S, Cmd+Y, Cmd+E,
// Cmd+L, Cmd+T, Cmd+G), so the menu leaves those keys alone.
function menu() {
  const mac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]);
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome-extension):/.test(d.url) }));
  Menu.setApplicationMenu(menu());
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
