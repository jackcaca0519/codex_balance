import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USAGE_URL = 'https://chatgpt.com/codex/settings/usage';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let mainWindow;
let dashboardWindow;
let refreshTimer;
let refreshInFlight = false;
let currentState = {
  status: 'loading',
  balanceText: '--',
  rawText: '',
  lastUpdated: null,
  error: null,
};

function positionWindow(win) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 340;
  const height = 180;
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
    width: 340,
    height: 180,
    resizable: false,
    maximizable: false,
    minimizable: true,
    show: false,
    title: 'Codex Balance',
    alwaysOnTop: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
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
    title: 'Codex Usage Dashboard',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:codex-balance',
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL(USAGE_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function extractBalanceText(rawText) {
  const text = rawText.replace(/\r/g, '').trim();
  if (!text) return { balanceText: '--', reason: 'empty' };

  const moneyMatch = text.match(/(?:USD\s*)?\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (moneyMatch) return { balanceText: `$${moneyMatch[1]}`, reason: 'money' };

  const creditsMatch = text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:credits?|credit)/i);
  if (creditsMatch) return { balanceText: `${creditsMatch[1]} credits`, reason: 'credits' };

  const balanceLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /balance|credits?|remaining|available/i.test(line));

  return {
    balanceText: balanceLine ? balanceLine : text.replace(/\s+/g, ' ').slice(0, 60),
    reason: 'fallback',
  };
}

async function readDashboardText() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }

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

async function refreshBalance({ silent = false } = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow();
    }

    const rawText = await readDashboardText();
    const { balanceText } = extractBalanceText(rawText);

    currentState = {
      status: rawText ? 'ok' : 'empty',
      balanceText,
      rawText,
      lastUpdated: new Date().toISOString(),
      error: null,
    };
    await saveState();
    mainWindow?.webContents.send('state-update', currentState);
  } catch (error) {
    currentState = {
      ...currentState,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      lastUpdated: new Date().toISOString(),
    };
    await saveState();
    mainWindow?.webContents.send('state-update', currentState);
    if (!silent) console.error(error);
  } finally {
    refreshInFlight = false;
  }
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
  void refreshBalance({ silent: true });

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
  await refreshBalance();
  return currentState;
});

ipcMain.handle('get-state', async () => currentState);

ipcMain.handle('open-dashboard', async () => {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }
  dashboardWindow.show();
  dashboardWindow.focus();
  return true;
});

ipcMain.handle('open-usage-url', async () => {
  await shell.openExternal(USAGE_URL);
  return true;
});
