import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = await electron.launch({
  executablePath: path.join(projectRoot, 'node_modules', '.bin', 'electron'),
  args: [projectRoot],
  cwd: projectRoot,
  env: process.env,
});

try {
  await app.firstWindow();
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const windows = app.windows();
  let mainWindow = windows[windows.length - 1];
  for (const win of windows) {
    const titleGuess = await win.title().catch(() => '');
    if (titleGuess.includes('Codex Balance')) {
      mainWindow = win;
      break;
    }
  }

  await mainWindow.waitForLoadState('domcontentloaded');

  const before = await mainWindow.locator('body').innerText().catch(() => '');
  await mainWindow.getByRole('button', { name: /重整|更新中/ }).click({ timeout: 5000 });
  await mainWindow.waitForTimeout(3000);
  const after3s = await mainWindow.locator('body').innerText().catch(() => '');
  await mainWindow.waitForTimeout(12000);
  const after15s = await mainWindow.locator('body').innerText().catch(() => '');

  console.log(JSON.stringify({
    before,
    after3s,
    after15s,
  }, null, 2));
} finally {
  await app.close();
}
