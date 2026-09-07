/ Nova Browser - Renderer Process
// Tab management, navigation, bookmarks, shortcuts, drag-and-drop tabs, extensions.

// ------------------------- Constants & defaults -------------------------
const HOMEPAGE = 'nova://newtab';
const SETTINGS = 'nova://settings';
const DEFAULT_SEARCH = 'https://www.google.com/search?q=';
const DEFAULT_HOME = 'nova://newtab';
const CHROME_WEB_STORE = 'https://chromewebstore.google.com';
const EDGE_ADDONS_STORE = 'https://microsoftedge.microsoft.com/addons';

const DEFAULT_SHORTCUTS = [
  { title: 'Google', url: 'https://www.google.com', color: '#4285F4', letter: 'G' },
  { title: 'YouTube', url: 'https://www.youtube.com', color: '#FF0000', letter: 'Y' },
  { title: 'GitHub', url: 'https://github.com', color: '#24292e', letter: 'G' },
  { title: 'Wikipedia', url: 'https://wikipedia.org', color: '#000000', letter: 'W' },
  { title: 'Reddit', url: 'https://www.reddit.com', color: '#FF4500', letter: 'R' },
  { title: 'Bing', url: 'https://www.bing.com', color: '#0078D4', letter: 'B' },
  { title: 'Baidu', url: 'https://www.baidu.com', color: '#2932E1', letter: 'B' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com', color: '#F48024', letter: 'S' }
];

const SHORTCUT_COLORS = [
  '#4285F4','#EA4335','#FBBC05','#34A853',
  '#5B8CFF','#B06BFF','#FF6B9A','#00BCD4',
  '#FF9800','#9C27B0','#607D8B','#263238'
];

const SETTINGS_SECTION_TITLES = {
  appearance: { title: '外观', desc: '自定义 Nova Browser 的外观与主题' },
  search:     { title: '搜索引擎', desc: '配置地址栏搜索行为' },
  translate:  { title: '翻译', desc: '网页翻译提供商与目标语言' },
  startup:    { title: '启动与主页', desc: '浏览器启动与主页按钮的行为' },
  downloads:  { title: '下载', desc: '管理下载位置与通知' },
  privacy:    { title: '隐私与安全', desc: '清除浏览数据、拼写检查' },
  extensions: { title: '扩展程序', desc: '安装并管理 Chrome / Edge 扩展' },
  bookmarks:  { title: '收藏夹', desc: '查看、管理与导入书签' },
  about:      { title: '关于 Nova', desc: '版本与内核信息' }
};

// ------------------------- Settings system -------------------------
const SETTINGS_KEY = 'nova-browser-settings';
const defaultSettings = {
  theme: 'dark',
  tabsPosition: 'top',
  searchEngine: DEFAULT_SEARCH,
  customEngines: [],
  translateProvider: 'baidu',
  translateLang: 'zh',
  startup: 'newtab',
  homepage: DEFAULT_HOME,
  newtabUrl: '',
  newtabBg: '',
  spellcheck: true,
  downloadPath: '',
  autoSaveDownload: false,
  showDownloadNotify: true
};
let SEARCH_ENGINE = defaultSettings.searchEngine;
let currentSettings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.assign({}, defaultSettings, parsed);
  } catch (e) { return Object.assign({}, defaultSettings); }
}
function saveSettings(s) {
  currentSettings = Object.assign({}, currentSettings, s);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
  applySettings(currentSettings);
  return currentSettings;
}
function applySettings(s) {
  SEARCH_ENGINE = s.searchEngine;
  applyTheme(s.theme);
  applyTabsPosition(s.tabsPosition || 'top');
  if (s.spellcheck !== undefined) {
    document.body.setAttribute('spellcheck', s.spellcheck ? 'true' : 'false');
  }
}

function applyTabsPosition(position) {
  const body = document.body;
  if (!body) return;
  if (position === 'left') body.classList.add('vertical-tabs');
  else body.classList.remove('vertical-tabs');
  // Reset drop indicator classes in case user toggles mid-drag
  document.querySelectorAll('.tab.drop-before,.tab.drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function applyTheme(mode) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (mode === 'light' || mode === 'dark') root.classList.add(mode);
  else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    root.classList.add(prefersLight ? 'light' : 'dark');
  }
}
applySettings(currentSettings);

// ------------------------- Shortcuts (custom on new tab) -------------------------
const SHORTCUTS_KEY = 'nova-shortcuts';
let shortcuts = loadShortcuts();

function loadShortcuts() {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return DEFAULT_SHORTCUTS.slice();
}
function saveShortcuts() {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
}
function detectShortcutColor(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const ch = host.charAt(0).toLowerCase();
    const i = (ch.charCodeAt(0) || 0) % SHORTCUT_COLORS.length;
    return SHORTCUT_COLORS[i];
  } catch (e) { return SHORTCUT_COLORS[0]; }
}
function detectLetter(title, url) {
  const t = (title || '').trim();
  if (t) return t.charAt(0).toUpperCase();
  try { return new URL(url).hostname.replace(/^www\./, '').charAt(0).toUpperCase(); }
  catch (e) { return '?'; }
}

// ------------------------- Bookmarks -------------------------
const BOOKMARKS_KEY = 'nova-bookmarks';
let bookmarks = loadBookmarks();

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveBookmarks() {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}
function findBookmarkIndex(url) {
  return bookmarks.findIndex(b => b.url === url);
}
function addBookmark({ url, title }) {
  if (!url || url === HOMEPAGE || url === SETTINGS) return false;
  if (findBookmarkIndex(url) !== -1) return false;
  const bm = { id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), url, title: (title || url).slice(0, 200), createdAt: Date.now() };
  bookmarks.unshift(bm);
  saveBookmarks();
  return true;
}
function removeBookmarkByUrl(url) {
  const i = findBookmarkIndex(url);
  if (i >= 0) { bookmarks.splice(i, 1); saveBookmarks(); return true; }
  return false;
}
function removeBookmarkById(id) {
  const i = bookmarks.findIndex(b => b.id === id);
  if (i >= 0) { bookmarks.splice(i, 1); saveBookmarks(); return true; }
  return false;
}

// ------------------------- Tab state & DOM refs -------------------------
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

const $ = (sel) => document.querySelector(sel);
const requireEl = (sel) => {
  const el = document.querySelector(sel);
  if (!el) {
    console.error('[Nova] 缺少关键 DOM 元素:', sel);
    throw new Error('缺少关键 DOM 元素: ' + sel);
  }
  return el;
};
let tabsEl, newTabBtn, webviewsEl, newTabPage, settingsPage, bookmarksPanel, shortcutModal;
let urlInput, backBtn, forwardBtn, reloadBtn, homeBtn, loadingBar, ctxMenu, menuBtn, appMenu, bookmarksBtn, bookmarkStar;

// ------------------------- URL helpers -------------------------
function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const low = trimmed.toLowerCase();
  if (low === 'nova://newtab' || low === 'about:newtab') return HOMEPAGE;
  if (low === 'nova://settings' || low === 'about:settings' || low === 'chrome://settings') return SETTINGS;
  const looksLikeUrl = /^https?:\/\//i.test(trimmed) ||
    (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed) && !/\s/.test(trimmed));
  if (looksLikeUrl) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }
  return SEARCH_ENGINE + encodeURIComponent(trimmed);
}
function getFaviconUrl(pageUrl) {
  try { const u = new URL(pageUrl); return u.origin + '/favicon.ico'; }
  catch (e) { return null; }
}

// ------------------------- Tab management (with DnD reorder + +anchor) -------------------------
function createTab(url = HOMEPAGE, activate = true, atIndex = -1) {
  const id = ++tabIdCounter;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = id;
  tabEl.draggable = true;
  tabEl.innerHTML = `
    <div class="tab-favicon">N</div>
    <div class="tab-title">New Tab</div>
    <div class="tab-close">
      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </div>
  `;
  // CRITICAL for 需求3 (insertBefore as anchor so + is always after last tab)
  // and also works with DnD: insertBefore(newTab, newTabBtn) places tab just before +.
  tabsEl.insertBefore(tabEl, newTabBtn);

  attachTabDnDEvents(tabEl, id);

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchToTab(id);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });
  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    switchToTab(id);
    showContextMenu(e.clientX, e.clientY, id);
  });

  // Webview — allowpopups is REQUIRED so setWindowOpenHandler fires for target=_blank / window.open
  const webview = document.createElement('webview');
  webview.className = 'webview';
  webview.dataset.id = id;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no');
  webview.setAttribute('width', '100%');
  webview.setAttribute('height', '100%');
  // 打包态 webview UA 必须显式设置，否则为空导致服务器拒绝
  const chromeV = (typeof process !== 'undefined' && process.versions && process.versions.chrome) || '126.0.6478.234';
  webview.setAttribute('useragent', `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeV} Safari/537.36`);
  webviewsEl.appendChild(webview);

  const tab = { id, tabEl, webview, url, title: 'New Tab', loading: false, canGoBack: false, canGoForward: false };
  if (atIndex === -1 || atIndex >= tabs.length) tabs.push(tab);
  else tabs.splice(atIndex, 0, tab);

  attachWebviewEvents(tab);
  loadUrlInTab(tab, url);
  if (activate) switchToTab(id);
  return tab;
}

// -------- Tab DnD --------
let draggingTabId = null;
function attachTabDnDEvents(tabEl, id) {
  tabEl.addEventListener('dragstart', (e) => {
    draggingTabId = id;
    tabEl.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); } catch(_) {}
  });
  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    clearDropMarkers();
    draggingTabId = null;
  });
  tabEl.addEventListener('dragover', (e) => {
    if (!draggingTabId || draggingTabId === id) return;
    e.preventDefault();
    clearDropMarkers();
    const r = tabEl.getBoundingClientRect();
    const isVert = document.body.classList.contains('vertical-tabs');
    const before = isVert
      ? (e.clientY - r.top) < r.height / 2
      : (e.clientX - r.left) < r.width / 2;
    tabEl.classList.add(before ? 'drop-before' : 'drop-after');
  });
  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drop-before', 'drop-after');
  });
  tabEl.addEventListener('drop', (e) => {
    if (!draggingTabId || draggingTabId === id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = tabEl.getBoundingClientRect();
    const isVert = document.body.classList.contains('vertical-tabs');
    const before = isVert
      ? (e.clientY - r.top) < r.height / 2
      : (e.clientX - r.left) < r.width / 2;
    reorderTabs(draggingTabId, id, before);
    clearDropMarkers();
  });
}
function clearDropMarkers() {
  document.querySelectorAll('.tab.drop-before, .tab.drop-after')
    .forEach(el => el.classList.remove('drop-before', 'drop-after'));
}

function reorderTabs(fromId, toId, insertBefore) {
  const fromIdx = tabs.findIndex(t => t.id === fromId);
  let toIdx = tabs.findIndex(t => t.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = tabs.splice(fromIdx, 1);
  toIdx = tabs.findIndex(t => t.id === toId); // recompute after splice
  const finalIdx = insertBefore ? toIdx : toIdx + 1;
  tabs.splice(finalIdx, 0, moved);
  // Reorder DOM tab elements
  const referenceTab = tabs[finalIdx + 1];
  if (referenceTab) tabsEl.insertBefore(moved.tabEl, referenceTab.tabEl);
  else tabsEl.insertBefore(moved.tabEl, newTabBtn); // before + anchor
  // Reorder webviews (not strictly necessary since position absolute; but keeps order sane)
  const refWv = tabs[finalIdx + 1];
  if (refWv) webviewsEl.insertBefore(moved.webview, refWv.webview);
  else webviewsEl.appendChild(moved.webview);
}

function attachWebviewEvents(tab) {
  const { webview } = tab;
  webview.addEventListener('did-start-loading', () => {
    tab.loading = true;
    if (tab.id === activeTabId) updateLoading(true);
  });
  webview.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    if (tab.id === activeTabId) updateLoading(false);
    updateNavButtons();
    // Bookmark state may depend on latest URL
    if (tab.id === activeTabId) refreshBookmarkStarState();
  });
  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    if (tab.id === activeTabId) {
      updateUrlBar(tab);
      updateNavButtons();
      refreshBookmarkStarState();
    }
  });
  webview.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) {
      tab.webview.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(
        `<html><body style="font-family:-apple-system,sans-serif;padding:60px;text-align:center;background:#1e1e2e;color:#e4e4ef">
        <h2 style="color:#ff6b6b">无法加载网页</h2>
        <p style="color:#9a9ab0;margin-top:12px">${e.errorDescription || '未知错误'} (${e.errorCode})</p>
        <p style="color:#9a9ab0;margin-top:8px;font-size:12px">${e.url}</p>
        </body></html>`
      );
    }
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) { updateUrlBar(tab); refreshBookmarkStarState(); }
  });
  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'Untitled';
    tab.tabEl.querySelector('.tab-title').textContent = tab.title;
    if (tab.id === activeTabId) refreshBookmarkStarState();
  });
  webview.addEventListener('page-favicon-updated', (e) => updateFavicon(tab, e.favicons && e.favicons[0]));
  // Fallback: some Electron versions fire 'new-window' on webview before setWindowOpenHandler
  webview.addEventListener('new-window', (e) => {
    if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
      e.preventDefault();
      createTab(e.url);
    }
  });
}

function updateFavicon(tab, favUrl) {
  const faviconEl = tab.tabEl.querySelector('.tab-favicon');
  if (favUrl) {
    faviconEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = favUrl;
    img.onerror = () => { faviconEl.innerHTML = (tab.title || 'N').charAt(0).toUpperCase(); };
    faviconEl.appendChild(img);
  } else {
    faviconEl.innerHTML = (tab.title || 'N').charAt(0).toUpperCase();
  }
}

function hideInternalPages() {
  newTabPage.classList.add('hidden');
  settingsPage.classList.add('hidden');
}

function loadUrlInTab(tab, url) {
  tab.url = url;
  if (url === HOMEPAGE) {
    if (tab.id === activeTabId) {
      hideInternalPages();
      newTabPage.classList.remove('hidden');
      renderShortcuts();
    }
    tab.title = '新标签页';
    tab.tabEl.querySelector('.tab-title').textContent = tab.title;
    tab.tabEl.querySelector('.tab-favicon').innerHTML = 'N';
    tab.canGoBack = false; tab.canGoForward = false;
    if (tab.id === activeTabId) {
      urlInput.value = ''; urlInput.placeholder = '搜索或输入网址';
      updateNavButtons(); refreshBookmarkStarState();
    }
  } else if (url === SETTINGS) {
    if (tab.id === activeTabId) {
      hideInternalPages();
      settingsPage.classList.remove('hidden');
      settingsPage.scrollTop = 0;
      populateSettingsForm(currentSettings);
      refreshVersionsLabel();
      renderBookmarkListInSettings();
      renderExtensionsList();
    }
    tab.title = '设置';
    tab.tabEl.querySelector('.tab-title').textContent = tab.title;
    tab.tabEl.querySelector('.tab-favicon').innerHTML = '⚙';
    tab.canGoBack = false; tab.canGoForward = false;
    if (tab.id === activeTabId) {
      urlInput.value = 'nova://settings';
      updateNavButtons(); refreshBookmarkStarState();
    }
  } else {
    if (tab.id === activeTabId) hideInternalPages();
    tab.webview.src = url;
  }
}

function switchToTab(id) {
  activeTabId = id;
  tabs.forEach(t => {
    const active = t.id === id;
    t.tabEl.classList.toggle('active', active);
    t.webview.classList.toggle('active', active);
    try { t.webview.setActive(active); } catch(_) {}
    if (active) {
      try { void t.webview.offsetWidth; } catch(_) {}
      setTimeout(() => { try { void t.webview.offsetWidth; } catch(_) {} }, 50);
    }
  });
  const tab = getTab(id);
  if (!tab) return;
  hideInternalPages();
  if (tab.url === HOMEPAGE) { newTabPage.classList.remove('hidden'); renderShortcuts(); }
  else if (tab.url === SETTINGS) {
    settingsPage.classList.remove('hidden');
    populateSettingsForm(currentSettings);
    refreshVersionsLabel();
    renderBookmarkListInSettings();
    renderExtensionsList();
  }
  updateUrlBar(tab);
  updateNavButtons();
  updateLoading(tab.loading);
  refreshBookmarkStarState();
  // Scroll tab into view
  tab.tabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab(getNewTabUrl()); return; }
  if (activeTabId === id) switchToTab(tabs[Math.min(idx, tabs.length - 1)].id);
}
function getTab(id) { return tabs.find(t => t.id === id); }
function getActiveTab() { return getTab(activeTabId); }

// ------------------------- UI updates -------------------------
function updateUrlBar(tab) {
  if (tab.url === HOMEPAGE) { urlInput.value = ''; urlInput.placeholder = '搜索或输入网址'; }
  else if (tab.url === SETTINGS) urlInput.value = 'nova://settings';
  else urlInput.value = tab.url;
  updateSecurityIndicator(tab.url);
}

function updateSecurityIndicator(url) {
  const lockEl = $('#url-lock');
  const secureIcon = $('#lock-icon-secure');
  const insecureIcon = $('#lock-icon-insecure');
  if (!lockEl || !secureIcon || !insecureIcon) return;

  // Internal pages (HOMEPAGE, nova://, chrome://, file://, about:)
  const isInternal = !url || url === HOMEPAGE || url === SETTINGS ||
    url.startsWith('nova://') || url.startsWith('chrome://') ||
    url.startsWith('file://') || url.startsWith('about:') || url.startsWith('data:');

  if (isInternal) {
    lockEl.className = 'url-lock secure internal';
    lockEl.title = 'Nova Browser 内部页面';
    secureIcon.style.display = '';
    insecureIcon.style.display = 'none';
  } else if (url.startsWith('https://')) {
    lockEl.className = 'url-lock secure';
    lockEl.title = '安全连接（HTTPS）';
    secureIcon.style.display = '';
    insecureIcon.style.display = 'none';
  } else if (url.startsWith('http://')) {
    lockEl.className = 'url-lock insecure';
    lockEl.title = '不安全的连接（HTTP）';
    secureIcon.style.display = 'none';
    insecureIcon.style.display = '';
  } else {
    lockEl.className = 'url-lock secure';
    lockEl.title = '安全连接';
    secureIcon.style.display = '';
    insecureIcon.style.display = 'none';
  }
}
function updateNavButtons() {
  const tab = getActiveTab(); if (!tab) return;
  backBtn.disabled = !tab.canGoBack;
  forwardBtn.disabled = !tab.canGoForward;
}
function updateLoading(loading) {
  if (loading) { loadingBar.classList.add('active'); loadingBar.classList.remove('done'); }
  else {
    loadingBar.classList.remove('active'); loadingBar.classList.add('done');
    setTimeout(() => loadingBar.classList.remove('done'), 300);
  }
}

// ------------------------- Navigation -------------------------
function navigate(input) {
  const url = normalizeUrl(input); if (!url) return;
  const tab = getActiveTab(); if (!tab) return;
  loadUrlInTab(tab, url);
}
function goBack() {
  const tab = getActiveTab();
  if (tab && tab.canGoBack) { newTabPage.classList.add('hidden'); settingsPage.classList.add('hidden'); tab.webview.goBack(); }
}
function goForward() {
  const tab = getActiveTab(); if (tab && tab.canGoForward) tab.webview.goForward();
}
function reload() { const tab = getActiveTab(); if (tab && tab.url !== HOMEPAGE) tab.webview.reload(); }
function goHome() {
  const tab = getActiveTab(); if (!tab) return;
  const hp = currentSettings.homepage || HOMEPAGE;
  const url = (hp === 'nova://newtab') ? HOMEPAGE : normalizeUrl(hp) || HOMEPAGE;
  loadUrlInTab(tab, url);
}

// Returns the URL to open when user creates a new tab
function getNewTabUrl() {
  return (currentSettings.newtabUrl) ? currentSettings.newtabUrl : HOMEPAGE;
}

// ------------------------- DOM 就绪后统一分配引用 & 绑定 & 启动 -------------------------
function boot() {
  tabsEl = requireEl('#tabs');
  newTabBtn = requireEl('#new-tab-btn');
  webviewsEl = requireEl('#webviews');
  newTabPage = requireEl('#newtab-page');
  settingsPage = requireEl('#settings-page');
  bookmarksPanel = requireEl('#bookmarks-panel');
  shortcutModal = requireEl('#shortcut-modal');
  urlInput = requireEl('#url-input');
  backBtn = requireEl('#back-btn');
  forwardBtn = requireEl('#forward-btn');
  reloadBtn = requireEl('#reload-btn');
  homeBtn = requireEl('#home-btn');
  loadingBar = requireEl('#loading-bar');
  ctxMenu = requireEl('#ctx-menu');
  menuBtn = requireEl('#menu-btn');
  appMenu = requireEl('#app-menu');
  bookmarksBtn = requireEl('#bookmarks-btn');
  bookmarkStar = requireEl('#bookmark-star');

  console.time('[Nova] bind');
  bindAllEventListeners();
  bindSettingsSidebar();
  bindSettingsControls();
  setupCrxDnd();
  applySettings(currentSettings);
  renderShortcuts();
  refreshBookmarkStarState();
  renderPanelBookmarks();
  // Apply new tab background from settings
  applyNewtabBackground(currentSettings.newtabBg);
  // If custom newtab URL is set, open that instead of HOMEPAGE
  const initialUrl = (currentSettings.newtabUrl) ? currentSettings.newtabUrl : HOMEPAGE;
  createTab(initialUrl);
  console.timeEnd('[Nova] bind');
}

// -------- Three-dot app menu toggle --------
function toggleAppMenu(show) {
  if (!appMenu) return;
  const shouldShow = typeof show === 'boolean' ? show : appMenu.classList.contains('hidden');
  if (shouldShow) {
    // Position the dropdown below the menu button, right-aligned.
    const r = menuBtn.getBoundingClientRect();
    const menuW = 260;
    const left = Math.max(8, r.right - menuW);
    appMenu.style.left = left + 'px';
    appMenu.style.top = (r.bottom + 4) + 'px';
    appMenu.classList.remove('hidden');
  } else {
    appMenu.classList.add('hidden');
  }
}

function bindAllEventListeners() {
  // -------- Tab bar --------
  newTabBtn.addEventListener('click', () => createTab(getNewTabUrl()));
  // Tabs container dragover: valid drop target during tab DnD so tab can drop outside a sibling slot.
  tabsEl.addEventListener('dragover', (e) => {
    if (draggingTabId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  backBtn.addEventListener('click', goBack);
  forwardBtn.addEventListener('click', goForward);
  reloadBtn.addEventListener('click', reload);
  homeBtn.addEventListener('click', goHome);

  // -------- Three-dot app menu --------
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAppMenu(); });
  appMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.app-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    toggleAppMenu(false);
    switch (action) {
      case 'newtab':
        createTab(getNewTabUrl());
        setTimeout(() => { const el = $('#newtab-search'); if (el) el.focus(); }, 50);
        break;
      case 'newwin':
        if (window.nova && window.nova.newWindow) window.nova.newWindow();
        break;
      case 'bookmarks':
        toggleBookmarksPanel();
        break;
      case 'incognito':
        if (window.nova && window.nova.openIncognito) window.nova.openIncognito();
        else alert('无痕模式将在重启后可用');
        break;
      case 'home': goHome(); break;
      case 'cleardata':
        if (confirm('确定清除所有浏览数据（缓存、Cookie、本地存储）吗？')) {
          if (window.nova && window.nova.clearData) window.nova.clearData();
          else alert('数据清除将在下次重启后生效');
        }
        break;
      case 'devtools': {
        const t = getActiveTab();
        if (t && t.url !== HOMEPAGE && t.url !== SETTINGS) t.webview.openDevTools();
        break;
      }
      case 'fullscreen':
        if (document.body.webkitRequestFullscreen) document.body.webkitRequestFullscreen();
        break;
      case 'settings': {
        const c = getActiveTab();
        if (c) loadUrlInTab(c, SETTINGS);
        break;
      }
      case 'about':
        if (window.nova && window.nova.showAboutDialog) window.nova.showAboutDialog();
        else alert(`Nova Browser\n版本 1.0.7\n\n© 2026 Nova`);
        break;
    }
  });

  // -------- Bookmarks (star + panel button) --------
  bookmarkStar.addEventListener('click', toggleBookmarkForActiveTab);
  bookmarksBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBookmarksPanel(); });
  const bmClose = $('#bookmarks-close');
  if (bmClose) bmClose.addEventListener('click', () => toggleBookmarksPanel(false));

  // Extensions button — opens settings → extensions section
  const extensionsBtn = $('#extensions-btn');
  if (extensionsBtn) extensionsBtn.addEventListener('click', () => openExtensionsSettings());

  // Translate button — translates current page via provider
  const translateBtn = $('#translate-btn');
  if (translateBtn) translateBtn.addEventListener('click', () => translateCurrentPage());

  // New tab background image upload
  const bgBtn = $('#newtab-bg-btn');
  const bgFile = $('#newtab-bg-file');
  if (bgBtn && bgFile) {
    bgBtn.addEventListener('click', () => bgFile.click());
    bgFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { alert('图片大小不能超过 5MB'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        currentSettings.newtabBg = dataUrl;
        saveSettings(currentSettings);
        applyNewtabBackground(dataUrl);
      };
      reader.readAsDataURL(file);
      bgFile.value = '';
    });
  }

  // -------- Context menu --------
  ctxMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const action = item.dataset.action;
    const tab = getTab(ctxTabId);
    hideContextMenu();
    if (!tab) return;
    switch (action) {
      case 'back': if (tab.canGoBack) tab.webview.goBack(); break;
      case 'forward': if (tab.canGoForward) tab.webview.goForward(); break;
      case 'reload': if (tab.url !== HOMEPAGE && tab.url !== SETTINGS) tab.webview.reload(); break;
      case 'bookmark':
        if (tab.url !== HOMEPAGE && tab.url !== SETTINGS) {
          if (findBookmarkIndex(tab.url) >= 0) { removeBookmarkByUrl(tab.url); }
          else addBookmark({ url: tab.url, title: tab.title });
          renderPanelBookmarks(); renderBookmarkListInSettings(); refreshBookmarkStarState();
        }
        break;
      case 'newtab': createTab(getNewTabUrl()); break;
      case 'duplicate':
        createTab(tab.url === HOMEPAGE ? HOMEPAGE : (tab.url === SETTINGS ? SETTINGS : tab.url));
        break;
      case 'close': closeTab(ctxTabId); break;
    }
  });

  // -------- Global click to hide overlays --------
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctx-menu') && !e.target.closest('.tab')) hideContextMenu();
    if (!e.target.closest('#app-menu') && !e.target.closest('#menu-btn')) toggleAppMenu(false);
    if (!e.target.closest('#bookmarks-panel') && !e.target.closest('#bookmarks-btn') && !e.target.closest('#app-menu')) {
      if (bookmarksPanel && !bookmarksPanel.classList.contains('hidden')) toggleBookmarksPanel(false);
    }
  });

  // -------- Keyboard shortcuts --------
  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key === 't') { e.preventDefault(); createTab(getNewTabUrl()); setTimeout(() => { const el = $('#newtab-search'); if (el) el.focus(); }, 50); }
    else if (cmd && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
    else if (cmd && e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
    else if (cmd && e.key === 'r') { e.preventDefault(); reload(); }
    else if (cmd && e.key === ',') {
      e.preventDefault();
      const t = getActiveTab(); if (t) loadUrlInTab(t, SETTINGS);
    }
    else if (cmd && e.key === 'd') {
      e.preventDefault();
      toggleBookmarkForActiveTab();
    }
    else if (cmd && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggleBookmarksPanel();
    }
    else if (e.key === 'Escape') {
      hideContextMenu();
      if (shortcutModal && !shortcutModal.classList.contains('hidden')) shortcutModal.classList.add('hidden');
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { navigate(urlInput.value); urlInput.blur(); }
    else if (e.key === 'Escape') { const t = getActiveTab(); if (t) updateUrlBar(t); urlInput.blur(); }
  });
  urlInput.addEventListener('focus', () => { urlInput.select(); });

  const newtabSearch = $('#newtab-search');
  if (newtabSearch) newtabSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value;
      if (val.trim()) { navigate(val); e.target.value = ''; }
    }
  });

  // -------- Menu events from main process --------
  if (window.nova) {
    window.nova.onMenuNewTab(() => { createTab(getNewTabUrl()); setTimeout(() => { const el = $('#newtab-search'); if (el) el.focus(); }, 50); });
    window.nova.onMenuCloseTab(() => { if (activeTabId) closeTab(activeTabId); });
    window.nova.onMenuBack(() => goBack());
    window.nova.onMenuForward(() => goForward());
    window.nova.onMenuBookmarkPage(() => toggleBookmarkForActiveTab());
    window.nova.onMenuShowBookmarks(() => toggleBookmarksPanel());
    window.nova.onMenuOpenCWS(() => { const t = getActiveTab(); if (t) loadUrlInTab(t, CHROME_WEB_STORE); });
    window.nova.onMenuOpenEdgeStore(() => { const t = getActiveTab(); if (t) loadUrlInTab(t, EDGE_ADDONS_STORE); });

    // Link clicked inside a webview → open in a new tab
    window.nova.onOpenUrlInNewTab((url) => { createTab(url); });

    // Download events
    window.nova.onDownloadStart((data) => showDownloadToast(data));
    window.nova.onDownloadProgress((data) => updateDownloadToast(data));
    window.nova.onDownloadDone((data) => finishDownloadToast(data));

    // CRX auto-installed from Chrome/Edge store download
    window.nova.onCrxAutoInstalled((data) => {
      alert(`扩展已自动安装：${data.name} v${data.version}`);
      if (!settingsPage.classList.contains('hidden')) renderExtensionsList();
    });
  }
}

// ------------------------- Download toast UI -------------------------
function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return val.toFixed(val < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}

function showDownloadToast(data) {
  let toast = $('#download-toast');
  if (!toast) return;
  toast.innerHTML = `
    <div class="dl-icon">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
    </div>
    <div class="dl-info">
      <div class="dl-name">${escapeHtml(data.filename)}</div>
      <div class="dl-status">
        <div class="dl-bar-wrap"><div class="dl-bar" id="dl-bar" style="width:0%"></div></div>
        <span class="dl-pct" id="dl-pct">0%</span>
      </div>
    </div>
    <button class="dl-close" id="dl-close">×</button>
  `;
  toast.classList.remove('hidden');
  const closeBtn = $('#dl-close');
  if (closeBtn) closeBtn.addEventListener('click', () => toast.classList.add('hidden'));
}

function updateDownloadToast(data) {
  const bar = $('#dl-bar');
  const pct = $('#dl-pct');
  if (bar) bar.style.width = data.pct + '%';
  if (pct) pct.textContent = data.pct + '%';
}

function finishDownloadToast(data) {
  const toast = $('#download-toast');
  if (!toast) return;
  const bar = $('#dl-bar');
  const pct = $('#dl-pct');
  if (data.failed) {
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '失败';
    toast.querySelector('.dl-name').textContent = data.filename + '（下载失败）';
  } else {
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '完成';
    toast.querySelector('.dl-name').textContent = data.filename + ' 已完成';
  }
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ------------------------- Settings page (sidebar navigation + save/cancel) -------------------------
function bindSettingsSidebar() {
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      showSettingsSection(section);
    });
  });
}
function showSettingsSection(section) {
  document.querySelectorAll('.settings-nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.section === section));
  document.querySelectorAll('.settings-section').forEach(s =>
    s.classList.toggle('hidden', s.dataset.panel !== section));
  const meta = SETTINGS_SECTION_TITLES[section] || { title: '设置', desc: '' };
  const titleEl = $('#settings-section-title');
  const descEl = $('#settings-section-desc');
  if (titleEl) titleEl.textContent = meta.title;
  if (descEl) descEl.textContent = meta.desc;

  if (section === 'extensions') renderExtensionsList();
  if (section === 'bookmarks') renderBookmarkListInSettings();
  if (section === 'about') refreshVersionsLabel();
  if (section === 'downloads' || section === 'search' || section === 'privacy' || section === 'translate' || section === 'startup') populateSettingsForm(currentSettings);
  settingsPage.querySelector('.settings-main').scrollTop = 0;
}

function populateSettingsForm(s) {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });
  // Tabs position (top / left)
  document.querySelectorAll('#tabs-position-group .theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabsPosition === (s.tabsPosition || 'top'));
  });
  const sel = $('#setting-search-engine');
  if (sel) sel.value = s.searchEngine;
  const startup = $('#setting-startup');
  if (startup) startup.value = s.startup;
  const hp = $('#setting-homepage');
  if (hp) hp.value = (s.homepage === HOMEPAGE) ? '' : (s.homepage || '');
  const sc = $('#setting-spellcheck');
  if (sc) sc.checked = !!s.spellcheck;
  // Download settings
  const dlPath = $('#setting-download-path');
  if (dlPath) dlPath.value = s.downloadPath || '';
  const autoSave = $('#setting-auto-save');
  if (autoSave) autoSave.checked = !!s.autoSaveDownload;
  const dlNotify = $('#setting-dl-notify');
  if (dlNotify) dlNotify.checked = s.showDownloadNotify !== false;
  // Translate settings
  const tp = $('#setting-translate-provider');
  if (tp) tp.value = s.translateProvider || 'baidu';
  const tl = $('#setting-translate-lang');
  if (tl) tl.value = s.translateLang || 'zh';
  // New tab URL
  const nu = $('#setting-newtab-url');
  if (nu) nu.value = s.newtabUrl || '';
  // Custom engine display
  renderCustomEngineList();
}

function readSettingsForm() {
  const themeBtn = document.querySelector('.theme-btn:not([data-tabs-position]).active') || document.querySelector('#theme-group .theme-btn.active');
  const theme = themeBtn ? themeBtn.dataset.theme : 'dark';
  const posBtn = document.querySelector('#tabs-position-group .theme-btn.active');
  const tabsPosition = posBtn ? (posBtn.dataset.tabsPosition || 'top') : (currentSettings.tabsPosition || 'top');
  const searchEngine = $('#setting-search-engine').value || DEFAULT_SEARCH;
  const startup = $('#setting-startup').value || 'newtab';
  const homepageRaw = $('#setting-homepage').value.trim();
  const homepage = !homepageRaw ? HOMEPAGE : (normalizeUrl(homepageRaw) || HOMEPAGE);
  const spellcheck = $('#setting-spellcheck').checked;
  const downloadPath = ($('#setting-download-path') || {}).value || '';
  const autoSaveDownload = ($('#setting-auto-save') || {}).checked || false;
  const showDownloadNotify = ($('#setting-dl-notify') || {}).checked !== false;
  const translateProvider = ($('#setting-translate-provider') || {}).value || 'baidu';
  const translateLang = ($('#setting-translate-lang') || {}).value || 'zh';
  const newtabUrlRaw = ($('#setting-newtab-url') || {}).value || '';
  const newtabUrl = newtabUrlRaw.trim() ? (normalizeUrl(newtabUrlRaw.trim()) || '') : '';
  return { theme, tabsPosition, searchEngine, startup, homepage, spellcheck, downloadPath, autoSaveDownload, showDownloadNotify, translateProvider, translateLang, newtabUrl };
}

async function refreshVersionsLabel() {
  const lbl = $('#setting-chrome'); if (!lbl) return;
  lbl.textContent = '加载中…';
  try {
    if (window.nova && window.nova.getVersions) {
      const v = await window.nova.getVersions();
      lbl.textContent = v.chrome || '-';
      const appLbl = $('#setting-version');
      if (appLbl && v.app) appLbl.textContent = 'v' + v.app;
    }
  } catch (e) { lbl.textContent = '-'; }
}

function bindSettingsControls() {
  // Theme selection (only theme group, not tabs-position)
  document.querySelectorAll('#theme-group .theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#theme-group .theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Tabs position selection (separate group)
  document.querySelectorAll('#tabs-position-group .theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tabs-position-group .theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Preview immediately
      const pos = btn.dataset.tabsPosition || 'top';
      applyTabsPosition(pos);
    });
  });

  $('#setting-save').addEventListener('click', () => {
    const patch = readSettingsForm();
    const next = saveSettings(patch);
    alert('设置已保存' + (next.theme === 'system' ? '（主题跟随系统，重启后完整生效）' : ''));
  });
  $('#setting-cancel').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) loadUrlInTab(tab, HOMEPAGE);
  });

  // ---- Clear browsing data with categories ----
  $('#setting-clear-data').addEventListener('click', async () => {
    const modal = $('#clear-data-modal');
    if (!modal) {
      // Fallback: simple confirm
      if (!confirm('确定清除所有浏览数据吗？')) return;
      try { if (window.nova && window.nova.clearData) { await window.nova.clearData(); alert('浏览数据已清除'); } }
      catch (e) { alert('清除失败: ' + e.message); }
      return;
    }
    modal.classList.remove('hidden');
  });
  const clearCancel = $('#clear-data-cancel');
  if (clearCancel) clearCancel.addEventListener('click', () => $('#clear-data-modal').classList.add('hidden'));
  const clearConfirm = $('#clear-data-confirm');
  if (clearConfirm) clearConfirm.addEventListener('click', async () => {
    const opts = {
      cache: !!$('#cd-cache').checked,
      cookies: !!$('#cd-cookies').checked,
      history: !!$('#cd-history').checked,
      localStorage: !!$('#cd-localstorage').checked,
      downloads: !!$('#cd-downloads').checked
    };
    const anyChecked = Object.values(opts).some(v => v);
    if (!anyChecked) { alert('请至少选择一项要清除的数据'); return; }
    try {
      if (window.nova && window.nova.clearData) { await window.nova.clearData(opts); }
      $('#clear-data-modal').classList.add('hidden');
      alert('已清除选中的浏览数据');
    } catch (e) { alert('清除失败: ' + e.message); }
  });

  // ---- Download settings ----
  const dlChoose = $('#setting-download-choose');
  if (dlChoose) dlChoose.addEventListener('click', async () => {
    try {
      if (!window.nova || !window.nova.chooseDownloadPath) { alert('不支持选择下载目录'); return; }
      const p = await window.nova.chooseDownloadPath();
      if (p) { $('#setting-download-path').value = p; }
    } catch(e) { alert('选择目录失败: ' + e.message); }
  });

  // ---- Custom search engine ----
  const addEngineBtn = $('#setting-add-engine');
  if (addEngineBtn) addEngineBtn.addEventListener('click', () => {
    const nameEl = $('#ce-name');
    const urlEl = $('#ce-url');
    const name = (nameEl.value || '').trim();
    let url = (urlEl.value || '').trim();
    if (!name) { alert('请填写引擎名称'); return; }
    if (!url) { alert('请填写搜索 URL 模板（含 %s 占位符）'); return; }
    // Convert %s to query encoding if needed
    if (url.includes('%s')) url = url.replace('%s', encodeURIComponent('%s'));
    if (!url.includes('?') && !url.includes('=')) {
      // Simple URL, add ?q=
      url = url + '?q=' + encodeURIComponent('%s');
    }
    if (!currentSettings.customEngines) currentSettings.customEngines = [];
    currentSettings.customEngines.push({ name, url });
    saveSettings(currentSettings);
    nameEl.value = ''; urlEl.value = '';
    renderCustomEngineList();
    // Add to select dropdown
    const sel = $('#setting-search-engine');
    if (sel) {
      const opt = document.createElement('option');
      opt.value = url; opt.textContent = name;
      sel.appendChild(opt);
      sel.value = url;
    }
  });

  // ---- Extensions: Chrome + Edge store ----
  $('#setting-open-cws').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) loadUrlInTab(tab, CHROME_WEB_STORE);
  });
  const edgeBtn = $('#setting-open-edge');
  if (edgeBtn) edgeBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) loadUrlInTab(tab, EDGE_ADDONS_STORE);
  });
  $('#setting-install-crx').addEventListener('click', async () => {
    try {
      if (!window.nova || !window.nova.pickCrxFile) { alert('不支持的扩展安装'); return; }
      const entry = await window.nova.pickCrxFile();
      if (!entry) return;
      alert(`已安装扩展：${entry.name} v${entry.version}`);
      renderExtensionsList();
    } catch (e) { alert('扩展安装失败：' + (e.message || e)); }
  });

  // ---- Bookmark import from HTML ----
  const importBtn = $('#setting-import-bookmarks');
  if (importBtn) importBtn.addEventListener('click', async () => {
    try {
      if (!window.nova || !window.nova.pickBookmarksHtml) { alert('不支持书签导入'); return; }
      const result = await window.nova.pickBookmarksHtml();
      if (!result) return;
      if (result.error) { alert('读取文件失败: ' + result.error); return; }
      const imported = parseBookmarksHtml(result.html);
      if (imported.length === 0) { alert('未在文件中找到任何书签'); return; }
      let added = 0;
      imported.forEach(b => {
        if (findBookmarkIndex(b.url) === -1) {
          bookmarks.unshift({ id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), url: b.url, title: b.title, createdAt: Date.now() });
          added++;
        }
      });
      saveBookmarks();
      renderBookmarkListInSettings(); renderPanelBookmarks(); refreshBookmarkStarState();
      alert(`成功导入 ${added} 个书签（共发现 ${imported.length} 个，跳过 ${imported.length - added} 个重复）`);
    } catch (e) { alert('导入失败: ' + e.message); }
  });

  // ---- Bookmarks management ----
  $('#setting-clear-bookmarks').addEventListener('click', () => {
    if (!confirm('确定清空所有收藏？')) return;
    bookmarks = []; saveBookmarks();
    renderBookmarkListInSettings(); renderPanelBookmarks(); refreshBookmarkStarState();
  });
}

// ---- Custom engine list rendering ----
function renderCustomEngineList() {
  const list = $('#custom-engine-list');
  if (!list) return;
  list.innerHTML = '';
  const engines = currentSettings.customEngines || [];
  if (!engines.length) {
    list.innerHTML = '<div class="ext-empty">暂无自定义搜索引擎</div>';
    return;
  }
  engines.forEach((eng, idx) => {
    const el = document.createElement('div');
    el.className = 'ext-item';
    el.innerHTML = `
      <div class="ext-icon">${escapeHtml(eng.name.charAt(0).toUpperCase())}</div>
      <div class="ext-info">
        <div class="ext-name">${escapeHtml(eng.name)}</div>
        <div class="ext-meta">${escapeHtml(eng.url)}</div>
      </div>
      <button class="settings-btn danger small">移除</button>
    `;
    el.querySelector('.settings-btn.danger').addEventListener('click', () => {
      currentSettings.customEngines.splice(idx, 1);
      saveSettings(currentSettings);
      // Remove from select
      const sel = $('#setting-search-engine');
      if (sel) {
        const opt = Array.from(sel.options).find(o => o.value === eng.url);
        if (opt) opt.remove();
      }
      renderCustomEngineList();
    });
    list.appendChild(el);
  });
}

// ---- Parse Netscape Bookmark HTML format ----
function parseBookmarksHtml(html) {
  const results = [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = doc.querySelectorAll('a[href]');
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      const title = (a.textContent || '').trim();
      if (href && href.startsWith('http') && title) {
        results.push({ url: href, title: title.slice(0, 200) });
      }
    });
  } catch(e) {}
  return results;
}

// ------------------------- Extensions (renderer UI) -------------------------
// Apply new tab background image
function applyNewtabBackground(dataUrl) {
  if (!newTabPage) return;
  if (dataUrl) {
    newTabPage.style.backgroundImage = `url("${dataUrl}")`;
    newTabPage.style.backgroundSize = 'cover';
    newTabPage.style.backgroundPosition = 'center';
    newTabPage.classList.add('has-bg');
  } else {
    newTabPage.style.backgroundImage = '';
    newTabPage.style.backgroundSize = '';
    newTabPage.style.backgroundPosition = '';
    newTabPage.classList.remove('has-bg');
  }
}

// Translate current page
function translateCurrentPage() {
  const tab = getActiveTab();
  if (!tab || !tab.webview) { alert('当前没有可翻译的页面'); return; }
  if (tab.url === HOMEPAGE || tab.url === SETTINGS) { alert('请在网页上使用翻译功能'); return; }
  const url = tab.webview.getURL();
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
    alert('当前页面不支持翻译');
    return;
  }
  const provider = currentSettings.translateProvider || 'baidu';
  const lang = currentSettings.translateLang || 'zh';
  let translateUrl;
  if (provider === 'baidu') {
    // Baidu translate: open translate.baidu.com with the page URL
    translateUrl = `https://fanyi.baidu.com/transpage?query=${encodeURIComponent(url)}&source=url&from=auto&to=${lang}&type=&x?`;
  } else {
    // Youdao translate
    translateUrl = `https://fanyi.youdao.com/transpage?query=${encodeURIComponent(url)}&from=auto&to=${lang}`;
  }
  createTab(translateUrl);
}

// Open settings page and jump to extensions section
function openExtensionsSettings() {
  const tab = getActiveTab();
  if (tab && (tab.url === SETTINGS || settingsPage.classList.contains('hidden') === false)) {
    // Already in settings, just switch section
    showSettingsSection('extensions');
  } else if (tab) {
    // Navigate to settings first, then switch section after a short delay
    loadUrlInTab(tab, SETTINGS);
    setTimeout(() => showSettingsSection('extensions'), 100);
  }
}

async function renderExtensionsList() {
  const list = $('#ext-list'); if (!list) return;
  list.innerHTML = '';
  try {
    const all = window.nova && window.nova.listExtensions ? await window.nova.listExtensions() : [];
    if (!all.length) {
      list.innerHTML = `<div class="ext-empty">还未安装任何扩展。<br/>打开 Chrome 应用商店下载，或将 .crx 文件拖到窗口安装。</div>`;
      return;
    }
    all.forEach(ext => {
      const el = document.createElement('div');
      el.className = 'ext-item';
      el.innerHTML = `
        <div class="ext-icon">${(ext.name || 'E').charAt(0).toUpperCase()}</div>
        <div class="ext-info">
          <div class="ext-name">${ext.name || '未命名扩展'}</div>
          <div class="ext-meta">版本 ${ext.version || '-'}${ext.enabled ? ' · 已启用' : ' · 已禁用'}${ext.description ? ' · ' + ext.description.slice(0, 60) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <label class="settings-toggle">
            <input type="checkbox" ${ext.enabled ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
          <button class="settings-btn danger small">移除</button>
        </div>
      `;
      const toggle = el.querySelector('input[type=checkbox]');
      toggle.addEventListener('change', async () => {
        if (window.nova && window.nova.toggleExtension) {
          await window.nova.toggleExtension({ id: ext.id, enabled: toggle.checked });
          renderExtensionsList();
        }
      });
      el.querySelector('.settings-btn.danger').addEventListener('click', async () => {
        if (!confirm(`确定移除扩展 "${ext.name}" 吗？`)) return;
        if (window.nova && window.nova.removeExtension) {
          await window.nova.removeExtension({ id: ext.id });
          renderExtensionsList();
        }
      });
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = `<div class="ext-empty">读取扩展失败：${e.message || e}</div>`;
  }
}

// ------------------------- Drag-drop CRX overlay -------------------------
let dragCrxDepth = 0;
function setupCrxDnd() {
  window.addEventListener('dragenter', (e) => {
    const hasFile = Array.from(e.dataTransfer && e.dataTransfer.types || []).includes('Files');
    if (!hasFile) return;
    dragCrxDepth++;
    if (dragCrxDepth === 1) showCrxOverlay();
  });
  window.addEventListener('dragover', (e) => {
    // Exclude tab DnD (which also sets dataTransfer) - only handle files
    if (draggingTabId) return;
    const types = Array.from(e.dataTransfer && e.dataTransfer.types || []);
    if (types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    dragCrxDepth = Math.max(0, dragCrxDepth - 1);
    if (dragCrxDepth === 0) hideCrxOverlay();
  });
  window.addEventListener('drop', async (e) => {
    // Don't swallow tab drops - tabs handle their own via stopPropagation
    const wasCrx = dragCrxDepth > 0;
    dragCrxDepth = 0;
    hideCrxOverlay();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const crxs = Array.from(files).filter(f => /\.crx$/i.test(f.name || ''));
    if (!crxs.length) return;
    e.preventDefault();
    // Use File-based path via nova.installCrx
    for (const f of crxs) {
      try {
        // Electron File objects have a `.path` property on the renderer side when sandbox=false
        const p = f.path;
        if (!p) { alert('无法读取扩展文件路径，请通过设置里的"选择 .crx 安装"按钮安装'); continue; }
        const entry = await window.nova.installCrx({ crxPath: p });
        alert(`已安装扩展：${entry.name} v${entry.version}`);
      } catch (err) {
        alert(`安装 ${f.name} 失败：` + (err.message || err));
      }
    }
    // Refresh extensions UI if settings panel visible
    if (!settingsPage.classList.contains('hidden')) renderExtensionsList();
  });
}
function showCrxOverlay() {
  let el = document.querySelector('.drop-crx-overlay');
  if (!el) {
    el = document.createElement('div');
    el.className = 'drop-crx-overlay';
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
}
function hideCrxOverlay() {
  const el = document.querySelector('.drop-crx-overlay');
  if (el) el.classList.add('hidden'), el.remove();
}

// ------------------------- Shortcuts (new tab page) -------------------------
function renderShortcuts() {
  const container = $('#shortcuts');
  if (!container) return;
  container.innerHTML = '';
  shortcuts.forEach((s, idx) => {
    const el = document.createElement('div');
    el.className = 'shortcut';
    el.title = s.url;
    el.innerHTML = `
      <button class="shortcut-edit" title="编辑">✎</button>
      <button class="shortcut-remove" title="删除">×</button>
      <div class="shortcut-icon" style="background:${s.color}">${s.letter}</div>
      <div class="shortcut-title">${s.title}</div>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.shortcut-remove') || e.target.closest('.shortcut-edit')) return;
      const tab = getActiveTab();
      if (tab) loadUrlInTab(tab, normalizeUrl(s.url) || s.url);
    });
    el.querySelector('.shortcut-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除快捷方式 "${s.title}" 吗？`)) {
        shortcuts.splice(idx, 1); saveShortcuts(); renderShortcuts();
      }
    });
    el.querySelector('.shortcut-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openShortcutModal('edit', idx);
    });
    container.appendChild(el);
  });
  // Add button
  const addEl = document.createElement('div');
  addEl.className = 'shortcut-add';
  addEl.innerHTML = `
    <div class="shortcut-icon">+</div>
    <div class="shortcut-title">添加</div>
  `;
  addEl.addEventListener('click', () => openShortcutModal('add'));
  container.appendChild(addEl);
}

function openShortcutModal(mode, idx) {
  const modal = shortcutModal; if (!modal) return;
  const titleEl = $('#shortcut-modal-title');
  const nameEl = $('#sm-name');
  const urlEl = $('#sm-url');
  const colorsEl = $('#sm-colors');
  let pickColor = SHORTCUT_COLORS[0];

  if (mode === 'edit') {
    titleEl.textContent = '编辑快捷方式';
    const s = shortcuts[idx];
    nameEl.value = s.title;
    urlEl.value = s.url;
    pickColor = s.color;
  } else {
    titleEl.textContent = '添加快捷方式';
    nameEl.value = ''; urlEl.value = '';
    pickColor = SHORTCUT_COLORS[Math.floor(Math.random() * SHORTCUT_COLORS.length)];
  }
  // Render color row
  colorsEl.innerHTML = '';
  SHORTCUT_COLORS.forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'color-chip';
    chip.style.background = c;
    if (c === pickColor) chip.classList.add('selected');
    chip.addEventListener('click', () => {
      pickColor = c;
      colorsEl.querySelectorAll('.color-chip').forEach(x => x.classList.remove('selected'));
      chip.classList.add('selected');
    });
    colorsEl.appendChild(chip);
  });
  modal.classList.remove('hidden');
  // Rebind save/cancel once
  const saveBtn = $('#sm-save');
  const cancelBtn = $('#sm-cancel');
  const close = () => modal.classList.add('hidden');
  saveBtn.onclick = () => {
    const name = nameEl.value.trim();
    const rawUrl = urlEl.value.trim();
    const u = normalizeUrl(rawUrl);
    if (!name) { alert('请填写名称'); return; }
    if (!u) { alert('请填写合法网址'); return; }
    const letter = detectLetter(name, u);
    const color = pickColor;
    if (mode === 'edit') {
      shortcuts[idx] = { title: name.slice(0, 40), url: u, color, letter };
    } else {
      shortcuts.push({ title: name.slice(0, 40), url: u, color, letter });
    }
    saveShortcuts();
    renderShortcuts();
    close();
  };
  cancelBtn.onclick = close;
  modal.querySelector('.modal-backdrop').onclick = close;
}

// ------------------------- Bookmarks UI -------------------------
function refreshBookmarkStarState() {
  if (!bookmarkStar) return;
  const tab = getActiveTab();
  const url = tab ? tab.url : null;
  if (!url || url === HOMEPAGE || url === SETTINGS) {
    bookmarkStar.classList.remove('active');
    bookmarkStar.disabled = true;
    bookmarkStar.style.opacity = 0.35;
    return;
  }
  bookmarkStar.disabled = false;
  bookmarkStar.style.opacity = 1;
  const yes = findBookmarkIndex(url) >= 0;
  bookmarkStar.classList.toggle('active', yes);
}

function toggleBookmarkForActiveTab() {
  const tab = getActiveTab();
  if (!tab) return;
  const url = tab.url;
  if (!url || url === HOMEPAGE || url === SETTINGS) return;
  const exists = findBookmarkIndex(url) >= 0;
  if (exists) {
    removeBookmarkByUrl(url);
    alert('已取消收藏');
  } else {
    addBookmark({ url, title: tab.title });
    alert('已加入收藏夹');
  }
  refreshBookmarkStarState();
  renderPanelBookmarks(); renderBookmarkListInSettings();
}

if (bookmarkStar) bookmarkStar.addEventListener('click', toggleBookmarkForActiveTab);

function faviconFor(url, fallback) {
  const f = getFaviconUrl(url);
  const letters = (fallback || '?').slice(0, 2).toUpperCase();
  if (f) return '<div class="bookmark-favicon"><img src="' + escapeHtml(f) + '" alt="" onerror="this.parentNode.innerHTML=(this.parentNode.dataset.letter||String.fromCharCode(8226));"></div>';
  return '<div class="bookmark-favicon">' + escapeHtml(letters) + '</div>';
}

function renderPanelBookmarks() {
  const list = $('#bookmarks-panel-list');
  if (!list) return;
  list.innerHTML = '';
  if (!bookmarks.length) {
    list.innerHTML = `<div class="bookmark-empty">暂无收藏<br/>点击地址栏中的 ⭐ 收藏当前网页</div>`;
    return;
  }
  bookmarks.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bookmark-item';
    const letter = (b.title || b.url || '?').charAt(0).toUpperCase();
    const favUrl = getFaviconUrl(b.url);
    const favHtml = favUrl
      ? `<img src="${escapeHtml(favUrl)}" alt="" style="width:16px;height:16px;" onerror="var s=document.createElement('span');s.textContent=this.parentNode.getAttribute('data-letter')||'•';this.parentNode.replaceChild(s,this);">`
      : `<span>${escapeHtml(letter)}</span>`;
    el.innerHTML = `
      <div class="bookmark-favicon" data-letter="${escapeHtml(letter)}">${favHtml}</div>
      <div class="bookmark-info">
        <div class="bm-title">${escapeHtml(b.title || b.url)}</div>
        <div class="bm-url">${escapeHtml(b.url)}</div>
      </div>
      <button class="settings-btn ghost">移除</button>
    `;
    el.querySelector('.bookmark-info').addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab) loadUrlInTab(tab, b.url);
      toggleBookmarksPanel(false);
    });
    el.querySelector('.settings-btn.ghost').addEventListener('click', (e) => {
      e.stopPropagation();
      if (removeBookmarkById(b.id)) {
        renderPanelBookmarks(); renderBookmarkListInSettings(); refreshBookmarkStarState();
      }
    });
    list.appendChild(el);
  });
}

function renderBookmarkListInSettings() {
  const listEl = $('#bookmark-list');
  const countEl = $('#bookmark-count');
  if (countEl) countEl.textContent = bookmarks.length;
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!bookmarks.length) {
    listEl.innerHTML = `<div class="bookmark-empty">暂无收藏</div>`;
    return;
  }
  bookmarks.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bookmark-item';
    const letter = (b.title || b.url || '?').charAt(0).toUpperCase();
    const favUrl = getFaviconUrl(b.url);
    const favHtml = favUrl
      ? `<img src="${escapeHtml(favUrl)}" alt="" style="width:16px;height:16px;" onerror="var s=document.createElement('span');s.textContent=this.parentNode.getAttribute('data-letter')||'•';this.parentNode.replaceChild(s,this);">`
      : `<span>${escapeHtml(letter)}</span>`;
    el.innerHTML = `
      <div class="bookmark-favicon" data-letter="${escapeHtml(letter)}">${favHtml}</div>
      <div class="bookmark-info">
        <div class="bm-title">${escapeHtml(b.title || b.url)}</div>
        <div class="bm-url">${escapeHtml(b.url)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="settings-btn ghost" data-act="open">打开</button>
        <button class="settings-btn ghost" data-act="rename">重命名</button>
        <button class="settings-btn danger small" data-act="del">删除</button>
      </div>
    `;
    const info = el.querySelector('.bookmark-info');
    info.addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab) loadUrlInTab(tab, b.url);
    });
    el.querySelector('[data-act=open]').addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab) loadUrlInTab(tab, b.url);
    });
    el.querySelector('[data-act=rename]').addEventListener('click', () => {
      const newTitle = prompt('新标题：', b.title || '');
      if (newTitle && newTitle.trim()) {
        b.title = newTitle.trim().slice(0, 200);
        saveBookmarks(); renderBookmarkListInSettings(); renderPanelBookmarks();
      }
    });
    el.querySelector('[data-act=del]').addEventListener('click', () => {
      if (confirm(`删除收藏 "${b.title || b.url}"？`)) {
        removeBookmarkById(b.id); renderBookmarkListInSettings(); renderPanelBookmarks(); refreshBookmarkStarState();
      }
    });
    listEl.appendChild(el);
  });
}

function toggleBookmarksPanel(show) {
  if (!bookmarksPanel) return;
  const shouldShow = typeof show === 'boolean' ? show : bookmarksPanel.classList.contains('hidden');
  if (shouldShow) { renderPanelBookmarks(); bookmarksPanel.classList.remove('hidden'); }
  else bookmarksPanel.classList.add('hidden');
}

// ------------------------- Context menu -------------------------
let ctxTabId = null;
function showContextMenu(x, y, tabId) {
  ctxTabId = tabId;
  ctxMenu.classList.remove('hidden');
  const rect = ctxMenu.getBoundingClientRect();
  const maxX = window.innerWidth - 190;
  const maxY = window.innerHeight - 260;
  ctxMenu.style.left = Math.min(x, maxX) + 'px';
  ctxMenu.style.top = Math.min(y, maxY) + 'px';
}
function hideContextMenu() { ctxMenu.classList.add('hidden'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ------------------------- Init order -------------------------
// All DOM refs + listeners + first tab creation are now centralized in boot().
// The script tag is at </body> so DOM is already parsed; call boot() immediately.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
