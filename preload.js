const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  // Main menu events
  onMenuNewTab: (cb) => ipcRenderer.on('menu-new-tab', cb),
  onMenuCloseTab: (cb) => ipcRenderer.on('menu-close-tab', cb),
  onMenuBack: (cb) => ipcRenderer.on('menu-back', cb),
  onMenuForward: (cb) => ipcRenderer.on('menu-forward', cb),
  onMenuBookmarkPage: (cb) => ipcRenderer.on('menu-bookmark-page', cb),
  onMenuShowBookmarks: (cb) => ipcRenderer.on('menu-show-bookmarks', cb),
  onMenuOpenCWS: (cb) => ipcRenderer.on('menu-open-cws', cb),
  onMenuOpenEdgeStore: (cb) => ipcRenderer.on('menu-open-edge-store', cb),

  // Requests back to main
  newWindow: () => ipcRenderer.invoke('new-window'),
  openIncognito: () => ipcRenderer.invoke('open-incognito'),
  clearData: (opts) => ipcRenderer.invoke('clear-browsing-data', opts),
  getVersions: () => ipcRenderer.invoke('get-versions'),
  showAboutDialog: () => ipcRenderer.invoke('show-about-dialog'),

  // Extensions
  listExtensions: () => ipcRenderer.invoke('list-extensions'),
  toggleExtension: (arg) => ipcRenderer.invoke('toggle-extension', arg),
  removeExtension: (arg) => ipcRenderer.invoke('remove-extension', arg),
  installCrx: (arg) => ipcRenderer.invoke('install-crx', arg),
  pickCrxFile: () => ipcRenderer.invoke('pick-crx-file'),

  // Bookmarks import
  pickBookmarksHtml: () => ipcRenderer.invoke('pick-bookmarks-html'),

  // Download settings
  chooseDownloadPath: () => ipcRenderer.invoke('choose-download-path'),

  // Link open in new tab (from webview setWindowOpenHandler)
  onOpenUrlInNewTab: (cb) => ipcRenderer.on('open-url-in-new-tab', (_e, url) => cb(url)),

  // Download events
  onDownloadStart: (cb) => ipcRenderer.on('download-start', (_e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_e, data) => cb(data)),

  // CRX auto-installed (from Chrome/Edge store download)
  onCrxAutoInstalled: (cb) => ipcRenderer.on('crx-auto-installed', (_e, data) => cb(data))
});
