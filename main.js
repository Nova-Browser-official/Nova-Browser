const { app, BrowserWindow, Menu, shell, session, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Disable Chromium sandbox for ad-hoc (non-notarized) macOS builds.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Enable Chrome extension loading infrastructure & allow chrome://extensions style.
app.commandLine.appendSwitch('disable-extensions-except-crx-install-prompt');

const isDev = !app.isPackaged;
const CHROME_WEB_STORE = 'https://chromewebstore.google.com';
const EDGE_ADDONS_STORE = 'https://microsoftedge.microsoft.com/addons';
const EXT_INSTALL_SOURCE = 'file-crx-install';

// 真实 Chrome UA（打包态下 webview 默认 UA 为空/被拒，必须显式设置）
function buildUserAgent() {
  const chromeV = process.versions.chrome || '126.0.0.0';
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeV} Safari/537.36`;
}
const UA_STRING = buildUserAgent();

// 在创建任何窗口之前注册：每个新建的 webContents（含 webview）都强制设置 UA
app.on('web-contents-created', (evt, contents) => {
  try { contents.setUserAgent(UA_STRING); } catch(_) {}
});

let mainWindow = null;

// ---------- Extensions registry (persisted in userData) ----------
const extensionsStatePath = () => path.join(app.getPath('userData'), 'nova-extensions.json');

function readExtensionsState() {
  try {
    const raw = fs.readFileSync(extensionsStatePath(), 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.list)) return data;
  } catch (e) {}
  return { list: [] };
}

function writeExtensionsState(data) {
  try {
    fs.mkdirSync(path.dirname(extensionsStatePath()), { recursive: true });
    fs.writeFileSync(extensionsStatePath(), JSON.stringify(data, null, 2));
  } catch (e) {}
}

// ---------- CRX/ZIP extraction (supports CRX v2, v3, and plain ZIP) ----------

// Extract the ZIP data portion from a CRX file buffer.
// Supports: CRX v2, CRX v3, and plain ZIP files.
function extractCrxZipData(buf) {
  if (!buf || buf.length < 4) throw new Error('文件太小，不是合法的扩展文件');

  // Check for plain ZIP (PK\x03\x04)
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    return buf; // Already a ZIP file
  }

  // Check CRX magic "Cr24"
  const magic = buf.slice(0, 4).toString('utf-8');
  if (magic !== 'Cr24') {
    throw new Error('不是合法的 CRX 或 ZIP 文件（魔数不匹配）');
  }

  if (buf.length < 12) throw new Error('CRX 文件头部不完整');
  const version = buf.readUInt32LE(4);
  let zipStart;

  if (version === 2) {
    // CRX v2: magic(4) + version(4) + pubKeyLen(4) + sigLen(4) + pubKey + sig + zip
    if (buf.length < 16) throw new Error('CRX v2 头部不完整');
    const pubLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    zipStart = 16 + pubLen + sigLen;
  } else if (version === 3) {
    // CRX v3: magic(4) + version(4) + headerLen(4) + header(protobuf) + zip
    const headerLen = buf.readUInt32LE(8);
    zipStart = 12 + headerLen;
  } else {
    throw new Error(`不支持的 CRX 版本: ${version}`);
  }

  if (zipStart >= buf.length) throw new Error('CRX 文件损坏：ZIP 数据起始位置超出文件范围');
  return buf.slice(zipStart);
}

// Recursively find a file by name in a directory
function findFileDeep(dir, filename) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return null; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileDeep(fullPath, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return fullPath;
    }
  }
  return null;
}

// Resolve __MSG_xxx__ i18n placeholders from _locales/*/messages.json
function resolveI18nName(value, manifestDir) {
  if (!value || typeof value !== 'string') return value;
  const match = value.match(/^__MSG_(.+?)__$/);
  if (!match) return value;
  const msgKey = match[1];
  // Try en, en_US, zh_CN, zh, then any available locale
  const localesToTry = ['en', 'en_US', 'zh_CN', 'zh'];
  for (const locale of localesToTry) {
    const msgFile = path.join(manifestDir, '_locales', locale, 'messages.json');
    if (fs.existsSync(msgFile)) {
      try {
        const messages = JSON.parse(fs.readFileSync(msgFile, 'utf-8'));
        const entry = messages[msgKey];
        if (entry && entry.message) return entry.message;
      } catch(e) {}
    }
  }
  // Fallback: scan all _locales subdirectories
  const localesRoot = path.join(manifestDir, '_locales');
  if (fs.existsSync(localesRoot)) {
    try {
      const locales = fs.readdirSync(localesRoot);
      for (const locale of locales) {
        const msgFile = path.join(localesRoot, locale, 'messages.json');
        if (fs.existsSync(msgFile)) {
          try {
            const messages = JSON.parse(fs.readFileSync(msgFile, 'utf-8'));
            const entry = messages[msgKey];
            if (entry && entry.message) return entry.message;
          } catch(e) {}
        }
      }
    } catch(e) {}
  }
  // Could not resolve, return a cleaned version
  return msgKey;
}

// Read manifest from a CRX/ZIP file by extracting to a temp directory.
function crxReadManifest(crxPath) {
  const buf = fs.readFileSync(crxPath);
  const zipData = extractCrxZipData(buf);

  // Write ZIP data to temp file
  const tmpZip = path.join(os.tmpdir(), `nova-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  fs.writeFileSync(tmpZip, zipData);

  // Temp extraction dir
  const tmpDir = path.join(os.tmpdir(), `nova-ext-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(`unzip -o -qq "${tmpZip}" -d "${tmpDir}"`, { stdio: 'pipe' });
    const manifestPath = findFileDeep(tmpDir, 'manifest.json');
    if (!manifestPath) {
      const name = path.basename(crxPath, path.extname(crxPath));
      return { name, version: '1.0.0', description: '' };
    }
    const manifestDir = path.dirname(manifestPath);
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const m = JSON.parse(raw);
    const rawName = (m.name && typeof m.name === 'string') ? m.name : path.basename(crxPath, '.crx');
    const resolvedName = resolveI18nName(rawName, manifestDir);
    const resolvedDesc = m.description ? resolveI18nName(m.description, manifestDir) : '';
    return {
      name: resolvedName,
      version: m.version || '1.0.0',
      description: resolvedDesc || ''
    };
  } catch (e) {
    // If unzip fails, try fallback with filename
    const name = path.basename(crxPath, path.extname(crxPath));
    return { name, version: '1.0.0', description: '(无法解析 manifest，使用文件名)' };
  } finally {
    try { fs.unlinkSync(tmpZip); } catch(e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
  }
}

// Load all previously installed extensions on startup
function loadInstalledExtensionsOnStartup() {
  const state = readExtensionsState();
  for (const ext of state.list) {
    if (!ext.enabled) continue;
    if (ext.extDir && fs.existsSync(ext.extDir)) {
      const manifestPath = findFileDeep(ext.extDir, 'manifest.json');
      if (manifestPath) {
        const rootDir = path.dirname(manifestPath);
        try {
          session.defaultSession.loadExtension(rootDir, { allowBackgroundPages: false })
            .catch(() => {});
        } catch (e) {}
      }
    }
  }
}

async function installCrxFromPath(crxPath) {
  const stat = fs.statSync(crxPath);
  if (!stat.isFile()) throw new Error('不是文件');

  // Read and extract ZIP data from CRX
  const buf = fs.readFileSync(crxPath);
  const zipData = extractCrxZipData(buf);

  // Write ZIP to temp file
  const tmpZip = path.join(os.tmpdir(), `nova-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  fs.writeFileSync(tmpZip, zipData);

  // Generate a stable ID
  const crc32 = (str) => {
    let c; let table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) crc = table[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const fileBase = path.basename(crxPath, path.extname(crxPath));
  const hash = crc32(fileBase + '\n' + stat.size + '\n' + crxPath).toString(16).padStart(8, '0');
  const id = 'nova_' + hash;

  // Extraction directory (permanent)
  const extDir = path.join(app.getPath('userData'), 'nova-extensions', id);
  fs.mkdirSync(extDir, { recursive: true });

  // Unzip using macOS built-in unzip
  try {
    execSync(`unzip -o -qq "${tmpZip}" -d "${extDir}"`, { stdio: 'pipe' });
  } catch(e) {
    throw new Error('解压扩展失败: ' + (e.message || e));
  } finally {
    try { fs.unlinkSync(tmpZip); } catch(e) {}
  }

  // Read manifest from extracted directory
  const manifestPath = findFileDeep(extDir, 'manifest.json');
  let manifest = { name: fileBase, version: '1.0.0', description: '' };
  if (manifestPath) {
    const manifestDir = path.dirname(manifestPath);
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const rawName = (m.name && typeof m.name === 'string') ? m.name : fileBase;
      const resolvedName = resolveI18nName(rawName, manifestDir);
      const resolvedDesc = m.description ? resolveI18nName(m.description, manifestDir) : '';
      manifest = {
        name: resolvedName,
        version: m.version || '1.0.0',
        description: resolvedDesc || ''
      };
    } catch(e) {}
  }

  // Save metadata
  fs.writeFileSync(path.join(extDir, 'meta.json'), JSON.stringify({
    id, name: manifest.name, version: manifest.version, description: manifest.description,
    installedAt: Date.now(), enabled: true, crxPath: crxPath, extDir
  }, null, 2));

  // Load the extension into the session
  let loaded = false;
  try {
    const rootDir = manifestPath ? path.dirname(manifestPath) : extDir;
    await session.defaultSession.loadExtension(rootDir, { allowBackgroundPages: false });
    loaded = true;
  } catch(e) {
    // Some extensions (e.g., manifest v3 with service workers) may not load fully
    console.log('[Nova] Extension load warning:', e.message);
  }

  // Update extensions state
  const state = readExtensionsState();
  const existingIdx = state.list.findIndex(e => e.id === id);
  const entry = {
    id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    enabled: true,
    installedAt: Date.now(),
    crxPath: crxPath,
    extDir,
    loaded
  };
  if (existingIdx >= 0) state.list[existingIdx] = { ...state.list[existingIdx], ...entry };
  else state.list.push(entry);
  writeExtensionsState(state);

  return entry;
}

// ---------- Window & menus ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Nova Browser',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#1e1e2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // External links open in system browser (but allow Chrome/Edge Web Store & internal URLs).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(CHROME_WEB_STORE) || url.startsWith(EDGE_ADDONS_STORE)) return { action: 'allow' };
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Nova Browser',
      submenu: [
        { role: 'about', label: '关于 Nova Browser' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Nova Browser' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Nova Browser' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建标签页', accelerator: 'Cmd+T', click: () => { if (mainWindow) mainWindow.webContents.send('menu-new-tab'); } },
        { label: '新建窗口', accelerator: 'Cmd+N', click: () => createWindow() },
        { label: '新建无痕窗口', accelerator: 'Shift+Cmd+N', click: () => createIncognitoWindow() },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'Cmd+W', click: () => { if (mainWindow) mainWindow.webContents.send('menu-close-tab'); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'Cmd+Alt+I', click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); } }
      ]
    },
    {
      label: '收藏夹',
      submenu: [
        { label: '收藏此页', accelerator: 'Cmd+D', click: () => { if (mainWindow) mainWindow.webContents.send('menu-bookmark-page'); } },
        { label: '显示收藏夹栏', accelerator: 'Cmd+Shift+B', click: () => { if (mainWindow) mainWindow.webContents.send('menu-show-bookmarks'); } }
      ]
    },
    {
      label: '历史记录',
      submenu: [
        { label: '后退', accelerator: 'Cmd+[', click: () => { if (mainWindow) mainWindow.webContents.send('menu-back'); } },
        { label: '前进', accelerator: 'Cmd+]', click: () => { if (mainWindow) mainWindow.webContents.send('menu-forward'); } }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: 'Chrome 网上应用店', click: () => { if (mainWindow) mainWindow.webContents.send('menu-open-cws'); } },
        { label: 'Edge 扩展商店', click: () => { if (mainWindow) mainWindow.webContents.send('menu-open-edge-store'); } },
        { type: 'separator' },
        { label: '了解更多', click: () => shell.openExternal('https://www.electronjs.org') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(UA_STRING);
  // Allow navigation to Chrome Web Store (webview will inherit session).
  buildMenu();
  createWindow();

  // Load previously installed extensions on startup
  loadInstalledExtensionsOnStartup();

  // Enable built-in PDF viewer (don't prompt to download PDFs)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  // Prevent PDF download dialog — let Chromium render PDFs inline
  session.defaultSession.on('will-download', (e, item) => {
    const mime = item.getMimeType();
    if (mime === 'application/pdf') {
      e.preventDefault();
      // Open the PDF URL in a new tab instead
      const url = item.getURL();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-url-in-new-tab', url);
      }
    }
  });

  // ---------- Download handler ----------
  session.defaultSession.on('will-download', async (event, item, webContents) => {
    const filename = item.getFilename() || 'download';
    const totalBytes = item.getTotalBytes();

    // Read download settings from renderer's localStorage
    let autoSave = false;
    let dlPath = '';
    let showNotify = true;
    try {
      const settings = await mainWindow.webContents.executeJavaScript(`(function(){ try { return JSON.parse(localStorage.getItem('nova-browser-settings')||'{}'); } catch(e){ return {}; } })()`);
      autoSave = !!settings.autoSaveDownload;
      dlPath = settings.downloadPath || '';
      showNotify = settings.showDownloadNotify !== false;
    } catch(e) {}

    if (autoSave) {
      // Auto-save to download path or Downloads folder
      const dir = dlPath || app.getPath('downloads');
      savePath = path.join(dir, filename);
      // Avoid overwrite
      let counter = 1;
      while (fs.existsSync(savePath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        savePath = path.join(dir, `${base} (${counter})${ext}`);
        counter++;
      }
      item.setSavePath(savePath);
    } else {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存下载文件',
        defaultFilename: filename,
      });
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      savePath = result.filePath;
      item.setSavePath(savePath);
    }

    // Notify renderer: download started
    if (showNotify && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-start', { filename, savePath, total: totalBytes });
    }

    item.on('updated', (e, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
        if (showNotify && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', { filename, received, total, pct });
        }
      }
    });

    item.once('done', (e, state) => {
      if (showNotify && mainWindow && !mainWindow.isDestroyed()) {
        if (state === 'completed') {
          mainWindow.webContents.send('download-done', { filename, path: item.getSavePath() });
        } else {
          mainWindow.webContents.send('download-done', { filename, path: item.getSavePath(), failed: true });
        }
      }
      // Auto-install CRX files downloaded from Chrome/Edge store
      if (state === 'completed' && /\.crx$/i.test(filename)) {
        const crxPath = item.getSavePath();
        installCrxFromPath(crxPath)
          .then(entry => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('crx-auto-installed', { name: entry.name, version: entry.version });
            }
          })
          .catch(err => {
            console.log('[Nova] Auto-install CRX failed:', err.message);
          });
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (event, contents) => {
  contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'geolocation', 'notifications', 'midi', 'pointerLock', 'fullscreen'];
    callback(allowed.includes(permission));
  });

  // For webview contents: intercept target=_blank / window.open links → new tab
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-url-in-new-tab', url);
        }
      }
      return { action: 'deny' };
    });
  }
});

// ---------- IPC ----------
ipcMain.handle('new-window', () => createWindow());

// ---------- Incognito mode ----------
function createIncognitoWindow() {
  // Use a separate partition for incognito — data is in-memory only, cleared on close
  const incognitoPartition = 'incognito-' + Date.now();
  const incognitoSession = session.fromPartition(incognitoPartition, { cache: false });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: incognitoSession,
      spellcheck: true
    }
  });

  // Set incognito UA
  incognitoSession.setUserAgent(UA_STRING);

  // Prevent any persistent storage
  incognitoSession.webRequest.onBeforeRequest((details, cb) => {
    cb({});
  });

  win.loadFile('src/index.html');

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`document.title = 'Nova Browser (无痕模式)'; document.body.classList.add('incognito');`);
  });

  // Handle link opening in incognito window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('open-url-in-new-tab', { detail: '${url.replace(/'/g, "\\'")}' }))`);
    }
    return { action: 'deny' };
  });

  // Clean up session when window closed
  win.on('closed', () => {
    incognitoSession.clearCache();
    incognitoSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'serviceworker', 'webdb', 'cachestorage', 'file_system', 'shadercache', 'websql']
    });
  });

  return win;
}

ipcMain.handle('open-incognito', () => createIncognitoWindow());

ipcMain.handle('clear-browsing-data', async (_e, opts = {}) => {
  const s = session.defaultSession;
  const tasks = [];
  if (opts.cache) tasks.push(s.clearCache());
  if (opts.cookies) tasks.push(s.clearStorageData({ storages: ['cookies'] }));
  if (opts.localStorage) tasks.push(s.clearStorageData({ storages: ['localstorage', 'sessionstorage', 'indexdb', 'websql'] }));
  if (opts.history) tasks.push(s.clearStorageData({ storages: ['serviceworker', 'shadercache', 'cachestorage', 'file_system'] }));
  if (opts.downloads) tasks.push(s.clearStorageData({ storages: ['trust_tokens'] }));
  // If no options given, clear everything
  if (tasks.length === 0) {
    tasks.push(s.clearCache());
    tasks.push(s.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'serviceworker', 'webdb', 'cachestorage', 'file_system', 'shadercache', 'websql', 'trust_tokens'],
      quotas: ['temporary', 'syncable']
    }));
  }
  await Promise.all(tasks);
  return { ok: true };
});

ipcMain.handle('pick-bookmarks-html', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win || undefined, {
    title: '选择书签 HTML 文件',
    properties: ['openFile'],
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  try {
    const html = fs.readFileSync(filePath, 'utf-8');
    return { html, filename: path.basename(filePath) };
  } catch(e) {
    return { error: e.message };
  }
});

ipcMain.handle('choose-download-path', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win || undefined, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('get-versions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
}));

ipcMain.handle('show-about-dialog', async () => {
  const ver = app.getVersion();
  const win = BrowserWindow.getFocusedWindow();
  return dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: '关于 Nova Browser',
    message: 'Nova Browser',
    detail: `版本 ${ver}\nChromium ${process.versions.chrome}\nElectron ${process.versions.electron}\nNode.js ${process.versions.node}\n\n© 2026 Nova. 基于 Chromium 开源项目构建。`,
    buttons: ['确定'],
    defaultId: 0
  });
});

// ---------- Extensions IPC ----------
ipcMain.handle('list-extensions', () => {
  const state = readExtensionsState();
  // Resolve i18n names for extensions where name still contains __MSG_
  for (const ext of state.list) {
    if (ext.name && ext.name.includes('__MSG_') && ext.extDir) {
      const manifestPath = findFileDeep(ext.extDir, 'manifest.json');
      if (manifestPath) {
        const manifestDir = path.dirname(manifestPath);
        const resolved = resolveI18nName(ext.name, manifestDir);
        if (resolved && !resolved.includes('__MSG_')) {
          ext.name = resolved;
          if (ext.description && ext.description.includes('__MSG_')) {
            ext.description = resolveI18nName(ext.description, manifestDir);
          }
        }
      }
    }
  }
  writeExtensionsState(state); // persist resolved names
  return state.list;
});

ipcMain.handle('toggle-extension', async (_e, { id, enabled }) => {
  const state = readExtensionsState();
  const idx = state.list.findIndex(e => e.id === id);
  if (idx < 0) return { ok: false, error: '扩展不存在' };
  state.list[idx].enabled = !!enabled;
  writeExtensionsState(state);
  // If enabling, try to load the extension
  if (enabled && state.list[idx].extDir) {
    const manifestPath = findFileDeep(state.list[idx].extDir, 'manifest.json');
    if (manifestPath) {
      try {
        await session.defaultSession.loadExtension(path.dirname(manifestPath), { allowBackgroundPages: false });
        } catch(e) {}
    }
  }
  return { ok: true, item: state.list[idx] };
});

ipcMain.handle('remove-extension', (_e, { id }) => {
  const state = readExtensionsState();
  const idx = state.list.findIndex(e => e.id === id);
  if (idx < 0) return { ok: false };
  const item = state.list[idx];
  state.list.splice(idx, 1);
  writeExtensionsState(state);
  // Remove folder if exists
  try {
    const extDir = path.join(app.getPath('userData'), 'nova-extensions', id);
    if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
  } catch (e) {}
  return { ok: true, removed: item };
});

ipcMain.handle('install-crx', async (_e, { crxPath }) => {
  if (!crxPath || !fs.existsSync(crxPath)) throw new Error('crx 文件不存在');
  const entry = await installCrxFromPath(crxPath);
  return entry;
});

ipcMain.handle('pick-crx-file', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win || undefined, {
    title: '选择 Chrome 扩展文件 (.crx)',
    properties: ['openFile'],
    filters: [{ name: 'Chrome Extension', extensions: ['crx'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const crxPath = res.filePaths[0];
  const entry = await installCrxFromPath(crxPath);
  return entry;
});
