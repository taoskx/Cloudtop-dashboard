'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultDataDir, migrateLegacyDataDir } = require('./app/data_dir');
const { extractBundledSidecar } = require('./app/desktop_runtime');

async function main() {
  const dataDir = defaultDataDir();
  if (process.pkg) {
    if (!process.env.CTYUN_DATA_DIR) migrateLegacyDataDir(dataDir, path.join(path.dirname(process.execPath), 'data'));
    process.env.ECLOUD_SIDECAR = extractBundledSidecar(path.join(__dirname, 'build', 'sidecar', 'cloudtop-sidecar.exe'), dataDir);
  }
  // Python's session cache and login limits must also live under AppData.
  process.env.ECLOUD_SESSION_FILE ||= path.join(dataDir, 'ecloud', 'sessions.json');
  process.env.ECLOUD_LOGIN_RATE_LIMIT_FILE ||= path.join(dataDir, 'ecloud', 'login_rate_limit.json');
  process.env.PYTHONIOENCODING = 'utf-8';

  if (process.argv.includes('--self-test')) {
    const assert = require('node:assert/strict');
    const html = fs.readFileSync(path.join(__dirname, 'app', 'static', 'index.html'), 'utf8');
    assert.match(html, /class="header-top"/);
    assert.match(fs.readFileSync(path.join(__dirname, 'app', 'static', 'glass.css'), 'utf8'), /header \.stats-grid/);
    const { EcloudEngine } = require('./app/ecloud/ecloud_engine');
    const engine = new EcloudEngine({ requestTimeoutMs: 60000 });
    try {
      const health = await engine.start();
      assert.equal(health.importError, '', JSON.stringify(health));
      assert.equal(health.credentials, 'loaded', JSON.stringify(health));
      console.log('CLOUDTOP_SELF_TEST_OK: static assets, UTF-8 IPC, bundled Python and protocol dependencies');
    } finally {
      await engine.stop();
    }
    return;
  }

  const { startServer } = require('./server');
  const server = startServer();
  server.once('listening', () => {
    if (process.platform !== 'win32' || process.env.CLOUDTOP_NO_BROWSER === '1') return;
    const url = `http://127.0.0.1:${server.address().port}`;
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (error) => console.warn(`请在浏览器打开 ${url}（自动打开失败：${error.message}）`));
    child.unref();
  });
  server.once('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `端口已被占用，请检查是否已运行 Cloudtop：${process.env.PORT || 8571}` : error);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1500);
  });
}

main().catch((error) => {
  console.error('Cloudtop 启动失败：', error.message);
  process.exitCode = 1;
});
