import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function run(modeName, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: path.join(projectRoot, 'node_modules', '.bin', 'electron'),
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  try {
    await app.firstWindow();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const browserWindows = await app.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((win) => ({
        title: win.getTitle(),
        visible: win.isVisible(),
        destroyed: win.isDestroyed(),
        bounds: win.getBounds(),
      }));
    });
    console.log(JSON.stringify({ mode: modeName, browserWindows }, null, 2));

    const windowsBefore = app.windows();
    let mainWindow = windowsBefore[windowsBefore.length - 1];
    for (const win of windowsBefore) {
      const titleGuess = await win.title().catch(() => '');
      if (titleGuess.includes('Codex Balance')) {
        mainWindow = win;
        break;
      }
    }
    await mainWindow.waitForLoadState('domcontentloaded');
    const title = await mainWindow.title();
    const bodyText = await mainWindow.locator('body').innerText().catch(() => '');
    const apiShape = await mainWindow.evaluate(() => ({
      hasCodexBalance: typeof window.codexBalance !== 'undefined',
      openDashboardType: typeof window.codexBalance?.openDashboard,
      refreshNowType: typeof window.codexBalance?.refreshNow,
    }));
    const screenshotPath = path.join(projectRoot, 'work', `electron-${modeName}.png`);
    await mainWindow.screenshot({ path: screenshotPath }).catch(() => {});

    console.log(JSON.stringify({
      mode: modeName,
      mainWindowTitle: title,
      mainWindowText: bodyText.slice(0, 400),
      apiShape,
      windowCountBeforeClick: windowsBefore.length,
      screenshotPath,
    }, null, 2));

    await mainWindow.getByRole('button', { name: /開啟儀表板/ }).click({ timeout: 5000 });
    await mainWindow.waitForTimeout(1500);
    const bodyTextAfterClick = await mainWindow.locator('body').innerText().catch(() => '');
    const browserWindowsAfterClick = await app.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((win) => ({
        title: win.getTitle(),
        visible: win.isVisible(),
        destroyed: win.isDestroyed(),
        bounds: win.getBounds(),
      }));
    });

    const windows = app.windows();
    const details = [];
    for (const win of windows) {
      let title = '';
      try {
        title = await win.title();
      } catch {
        title = '<unavailable>';
      }
      details.push(title);
    }

    console.log(JSON.stringify({
      mode: modeName,
      windowCount: windows.length,
      browserWindowsAfterClick,
      mainWindowTextAfterClick: bodyTextAfterClick.slice(0, 400),
      windowTitles: details,
    }, null, 2));
  } finally {
    await app.close();
  }
}

await run('default');
await run('test', { CODEX_BALANCE_TEST_MODE: '1' });
