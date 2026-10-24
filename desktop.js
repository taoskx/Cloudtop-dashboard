'use strict';

const { app, BrowserWindow, session, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { defaultDataDir, migrateLegacyDataDir } = require('./app/data_dir');
const { applyBundledMailConfig } = require('./app/mail_config');

app.setName('Cloudtop Dashboard');
const dataDir = defaultDataDir();
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
if (!process.env.CTYUN_DATA_DIR) migrateLegacyDataDir(dataDir, path.join(portableDir, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'desktop-cache'), { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'desktop-cache'));
app.setAppLogsPath(path.join(dataDir, 'logs'));
const selfTest = process.argv.includes('--self-test');
if (selfTest) app.disableHardwareAcceleration();
let mainWindow, backend;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(main).catch(fail);
}

function writeReport(report) {
  const target = process.env.CLOUDTOP_SELF_TEST_REPORT;
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(report));
  fs.renameSync(`${target}.tmp`, target);
}

function fail(error) {
  if (selfTest) writeReport({ success: false, error: error.message });
  else dialog.showErrorBox('Cloudtop 启动失败', error.message);
  app.exit(1);
}

async function main() {
  app.setAppUserModelId('com.taoskx.cloudtop');
  if (app.isPackaged) {
    process.env.ECLOUD_SIDECAR = path.join(process.resourcesPath, 'engine', 'cloudtop-sidecar.exe');
    applyBundledMailConfig(path.join(process.resourcesPath, 'private-mail-config.json'), dataDir);
  }
  process.env.ECLOUD_SESSION_FILE ||= path.join(dataDir, 'ecloud', 'sessions.json');
  process.env.ECLOUD_LOGIN_RATE_LIMIT_FILE ||= path.join(dataDir, 'ecloud', 'login_rate_limit.json');
  process.env.PYTHONIOENCODING = 'utf-8';
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));

  backend = require('./server');
  const server = backend.startServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: !app.isPackaged };
  mainWindow = new BrowserWindow({
    width: 1420, height: 940, minWidth: 880, minHeight: 640,
    title: 'Cloudtop Dashboard', backgroundColor: '#080c1b', show: false,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'cloudtop.ico') : undefined,
    autoHideMenuBar: true, webPreferences: preferences,
  });
  mainWindow.setMenu(null);
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  // Any cloud-console popups stay inside native application windows as well.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: preferences } };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => { if (!selfTest) mainWindow.show(); });
  await mainWindow.loadURL(origin);

  if (selfTest) {
    const assert = require('node:assert/strict');
    const dom = await mainWindow.webContents.executeJavaScript(`({ title: document.title, metrics: document.querySelectorAll('#main-stats-grid .stat-card').length, toolbar: !!document.querySelector('.header-top'), nodeAvailable: typeof require !== 'undefined' })`);
    assert.equal(dom.metrics, 4);
    assert.equal(dom.toolbar, true);
    assert.equal(dom.nodeAvailable, false);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal(server.address().address, '127.0.0.1');
    const { EcloudEngine } = require('./app/ecloud/ecloud_engine');
    const engine = new EcloudEngine({ requestTimeoutMs: 60000 });
    try {
      const health = await engine.start();
      assert.equal(health.importError, '', JSON.stringify(health));
      assert.equal(health.credentials, 'loaded', JSON.stringify(health));
      const target = process.env.CLOUDTOP_SELF_TEST_REPORT;
      if (target) fs.writeFileSync(`${target}.png`, (await mainWindow.webContents.capturePage()).toPNG());
      writeReport({ success: true, nativeWindow: true, windows: 1, rendererReady: true, sandbox: true, nodeIntegration: false, engineReady: true, loopbackOnly: true, externalBrowserLaunched: false });
    } finally { await engine.stop(); }
    app.exit(0);
  }
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (backend) {
    backend.taskScheduler.stop();
    backend.server.close();
  }
});
