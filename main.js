import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USAGE_URL = 'https://chatgpt.com/codex/settings/usage';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TEST_MODE = process.env.CODEX_BALANCE_TEST_MODE === '1';

let mainWindow;
let dashboardWindow;
let refreshTimer;
let refreshInFlight = false;
let refreshPromise = null;
let pendingForceReloadCount = 0;
let lastRefreshStartedAt = null;
let currentState = {
  status: 'loading',
  balanceText: '--',
  resetAtText: null,
  rawText: '',
  lastUpdated: null,
  error: null,
};

function positionWindow(win) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 430;
  const height = 220;
  const x = Math.max(workArea.x + 12, workArea.x + workArea.width - width - 18);
  const y = Math.max(workArea.y + 12, workArea.y + workArea.height - height - 60);
  win.setBounds({ x, y, width, height });
}

function getStateFile() {
  return path.join(app.getPath('userData'), 'app-state.json');
}

async function loadSavedState() {
  try {
    const raw = await fs.readFile(getStateFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      currentState = { ...currentState, ...parsed, status: parsed.status || currentState.status };
    }
  } catch {
    // First run or invalid state. Keep defaults.
  }
}

async function saveState() {
  try {
    await fs.writeFile(getStateFile(), JSON.stringify(currentState, null, 2), 'utf8');
  } catch {
    // Ignore persistence failures; the widget still works.
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 430,
    height: 220,
    resizable: false,
    maximizable: false,
    minimizable: true,
    show: false,
    title: TEST_MODE ? 'Codex Balance Test' : 'Codex Balance',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    positionWindow(win);
    win.show();
  });
  win.on('focus', () => win.webContents.send('app-focus'));
  win.on('restore', () => positionWindow(win));
  return win;
}

function createDashboardWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 960,
    show: false,
    center: true,
    title: 'Codex Usage Dashboard',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:codex-balance',
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadURL(USAGE_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => {
    void refreshBalance({ silent: true });
  });
  win.on('closed', () => {
    if (dashboardWindow === win) dashboardWindow = null;
  });
  return win;
}

function extractBalanceText(rawText) {
  const text = rawText.replace(/\r/g, '').trim();
  if (!text) return { balanceText: '--', resetAtText: null, reason: 'empty' };

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let resetAtText = null;
  const resetLineIndex = lines.findIndex((line) => /重設時間|reset time/i.test(line));
  if (resetLineIndex !== -1) {
    const resetLine = lines[resetLineIndex];
    const inlineMatch = resetLine.match(/(?:重設時間|reset time)\s*:?\s*(.+)$/i);
    if (inlineMatch?.[1]) {
      resetAtText = inlineMatch[1].trim();
    } else if (lines[resetLineIndex + 1]) {
      resetAtText = lines[resetLineIndex + 1].trim();
    }
  }

  const percentRemainingLine = lines.find((line) => /(\d+(?:\.\d+)?)%\s*剩餘/.test(line));
  if (percentRemainingLine) {
    const match = percentRemainingLine.match(/(\d+(?:\.\d+)?)%\s*剩餘/);
    if (match) return { balanceText: `${match[1]}% 剩餘`, resetAtText, reason: 'percent-zh' };
  }

  const limitCardLine = lines.find((line) => /每週用量上限|weekly usage limit/i.test(line));
  if (limitCardLine) {
    const nearby = lines.slice(Math.max(0, lines.indexOf(limitCardLine)), Math.min(lines.length, lines.indexOf(limitCardLine) + 4)).join(' ');
    const match = nearby.match(/(\d+(?:\.\d+)?)%\s*剩餘/);
    if (match) return { balanceText: `${match[1]}% 剩餘`, resetAtText, reason: 'limit-card' };
  }

  const creditsRemainingIndex = lines.findIndex((line) => /剩餘積分|remaining credits?/i.test(line));
  if (creditsRemainingIndex !== -1) {
    const windowText = lines.slice(creditsRemainingIndex, creditsRemainingIndex + 3).join(' ');
    const match = windowText.match(/(?:剩餘積分|remaining credits?)\s*:?\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
      || windowText.match(/\b([0-9]+(?:\.[0-9]{1,2})?)\b/);
    if (match) return { balanceText: `${match[1]} 積分`, resetAtText, reason: 'credits-zh' };
  }

  const moneyMatch = text.match(/(?:USD\s*)?\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (moneyMatch) return { balanceText: `$${moneyMatch[1]}`, resetAtText, reason: 'money' };

  const creditsMatch = text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:credits?|credit)/i);
  if (creditsMatch) return { balanceText: `${creditsMatch[1]} credits`, resetAtText, reason: 'credits' };

  const errorLine = lines.find((line) => /web server is returning an unknown error/i.test(line));
  if (errorLine) return { balanceText: '頁面錯誤', resetAtText, reason: 'page-error' };

  const loginLine = lines.find((line) => /登入或註冊|log in|sign up/i.test(line));
  if (loginLine) return { balanceText: '請先登入', resetAtText, reason: 'login-required' };

  const balanceLine = lines.find((line) => /balance|credits?|remaining|available|剩餘|積分/i.test(line));

  return {
    balanceText: balanceLine ? balanceLine : text.replace(/\s+/g, ' ').slice(0, 60),
    resetAtText,
    reason: 'fallback',
  };
}

async function readDashboardSnapshot() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    return { rawText: '', balanceText: '--', resetAtText: null, reason: 'empty' };
  }

  const rawText = await dashboardWindow.webContents.executeJavaScript(`
    (() => {
      return document.body ? document.body.innerText : '';
    })()
  `);
  const parsed = extractBalanceText(rawText || '');
  return { rawText: rawText || '', ...parsed };
}

async function readDashboardText() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return '';

  if (dashboardWindow.webContents.isLoadingMainFrame()) {
    await new Promise((resolve) => {
      const done = () => resolve();
      dashboardWindow.webContents.once('did-finish-load', done);
      dashboardWindow.webContents.once('did-fail-load', done);
    });
  }

  const rawText = await dashboardWindow.webContents.executeJavaScript(`
    (() => {
      return document.body ? document.body.innerText : '';
    })()
  `);
  return rawText || '';
}

async function ensureDashboardWindow() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }
  return dashboardWindow;
}

async function reloadDashboardWindow() {
  await ensureDashboardWindow();
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;

  await dashboardWindow.webContents.executeJavaScript(`
    (() => {
      window.location.reload();
      return true;
    })()
  `).catch(() => {
    dashboardWindow?.webContents.reloadIgnoringCache();
  });

  await Promise.race([
    new Promise((resolve) => {
      const done = () => resolve('loaded');
      dashboardWindow.webContents.once('did-finish-load', done);
      dashboardWindow.webContents.once('did-fail-load', done);
    }),
    new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), 12000);
    }),
  ]);
}

function isPreferredBalanceReason(reason) {
  return reason === 'percent-zh' || reason === 'limit-card';
}

function isTerminalBalanceReason(reason) {
  return isPreferredBalanceReason(reason) || reason === 'login-required' || reason === 'page-error';
}

async function waitForUsefulDashboardState(timeoutMs = 6000, intervalMs = 400, { allowFallback = true } = {}) {
  const startedAt = Date.now();
  let lastSeen = { rawText: '', balanceText: '--', reason: 'empty' };
  let fallbackSeen = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastSeen = await readDashboardSnapshot();
    if (isTerminalBalanceReason(lastSeen.reason)) {
      return lastSeen;
    }
    if (allowFallback && ['credits-zh', 'money', 'credits'].includes(lastSeen.reason)) {
      fallbackSeen = lastSeen;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return fallbackSeen || lastSeen;
}

async function performRefresh({ silent = false, forceReload = false } = {}) {
  refreshInFlight = true;
  lastRefreshStartedAt = new Date().toISOString();
  mainWindow?.webContents.send('refresh-started', { startedAt: lastRefreshStartedAt, forceReload });
  try {
    await ensureDashboardWindow();

    let snapshot;
    if (forceReload) {
      await reloadDashboardWindow();
      snapshot = await waitForUsefulDashboardState(12000, 400, { allowFallback: true });
    } else {
      snapshot = await waitForUsefulDashboardState(6000, 400, { allowFallback: true });
    }

    const { rawText, balanceText, resetAtText, reason } = snapshot;

    currentState = {
      status: rawText && reason !== 'page-error' ? 'ok' : rawText ? 'error' : 'empty',
      balanceText: rawText ? balanceText : '--',
      resetAtText: rawText ? resetAtText : null,
      rawText,
      lastUpdated: new Date().toISOString(),
      error: reason === 'page-error' ? '分析頁目前回傳錯誤頁面' : null,
    };
    await saveState();
    mainWindow?.webContents.send('state-update', currentState);
    return currentState;
  } catch (error) {
    currentState = {
      ...currentState,
      status: 'error',
      balanceText: '--',
      resetAtText: null,
      rawText: '',
      error: error instanceof Error ? error.message : String(error),
      lastUpdated: new Date().toISOString(),
    };
    await saveState();
    mainWindow?.webContents.send('state-update', currentState);
    if (!silent) console.error(error);
    return currentState;
  } finally {
    refreshInFlight = false;
  }
}

async function refreshBalance(options = {}) {
  const requestedOptions = {
    silent: options.silent ?? false,
    forceReload: options.forceReload ?? false,
  };

  if (requestedOptions.forceReload && refreshInFlight) {
    pendingForceReloadCount += 1;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    let nextOptions = requestedOptions;
    let result = currentState;

    do {
      const queuedForceReloads = pendingForceReloadCount;
      const shouldForceReload = nextOptions.forceReload || queuedForceReloads > 0;
      pendingForceReloadCount = 0;
      result = await performRefresh({
        silent: nextOptions.silent,
        forceReload: shouldForceReload,
      });
      nextOptions = { silent: true, forceReload: false };
      if (queuedForceReloads > 1) {
        pendingForceReloadCount += queuedForceReloads - 1;
      }
    } while (pendingForceReloadCount > 0);

    return result;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function refreshBalanceWithTimeout(options = {}, timeoutMs = 15000) {
  return await Promise.race([
    refreshBalance(options),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`refresh timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function startPolling() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    void refreshBalance({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
    });
  }

  await loadSavedState();
  mainWindow = createMainWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('state-update', currentState);
  });
  startPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('refresh-now', async () => {
  const requestStartedAt = new Date().toISOString();
  try {
    await refreshBalanceWithTimeout({ forceReload: true }, 30000);
  } catch (error) {
    if (currentState.lastUpdated && currentState.lastUpdated >= requestStartedAt && currentState.balanceText && currentState.balanceText !== '--') {
      return currentState;
    }
    currentState = {
      ...currentState,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      lastUpdated: new Date().toISOString(),
    };
    await saveState();
    mainWindow?.webContents.send('state-update', currentState);
  }
  return currentState;
});

ipcMain.handle('get-state', async () => currentState);

ipcMain.handle('open-dashboard', async () => {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }
  app.focus({ steal: true });
  dashboardWindow.center();
  if (dashboardWindow.isMinimized()) dashboardWindow.restore();
  dashboardWindow.show();
  dashboardWindow.focus();
  dashboardWindow.webContents.focus();
  app.dock?.show();
  app.dock?.bounce('critical');
  void refreshBalance({ silent: true });
  return true;
});

ipcMain.handle('open-usage-url', async () => {
  await shell.openExternal(USAGE_URL);
  return true;
});
