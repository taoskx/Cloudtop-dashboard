'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { version } = require('../package.json');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Cloudtop desktop 中文 '));
  const appDir = path.join(root, 'portable app');
  const appData = path.join(root, 'Local AppData');
  const workDir = path.join(root, 'working directory');
  const report = path.join(root, 'native-window-report.json');
  fs.mkdirSync(appDir); fs.mkdirSync(workDir);
  const filename = `Cloudtop-Dashboard-v${version}-Windows-x64.exe`;
  const exe = path.join(appDir, filename);
  fs.copyFileSync(path.join(__dirname, '..', 'dist', filename), exe);
  const dataDir = path.join(appData, 'Cloudtop Dashboard');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'app-unlock.json'), JSON.stringify({ unlocked: true }));
  const env = { ...process.env, LOCALAPPDATA: appData, CLOUDTOP_SELF_TEST_REPORT: report };
  delete env.CTYUN_DATA_DIR; delete env.ECLOUD_PYTHON; delete env.ECLOUD_SIDECAR;
  env.PATH = path.join(process.env.SystemRoot, 'System32');
  const child = spawn(exe, ['--self-test'], { cwd: workDir, env, stdio: 'ignore' });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  try {
    let result;
    for (let i = 0; i < 240; i++) {
      if (spawnError) throw spawnError;
      if (fs.existsSync(report)) { result = JSON.parse(fs.readFileSync(report, 'utf8')); break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(result, 'Native desktop window did not produce its test report');
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.nativeWindow, true);
    assert.equal(result.engineReady, true);
    assert.equal(result.loopbackOnly, true);
    assert.equal(result.externalBrowserLaunched, false);
    assert.equal(result.nodeIntegration, false);
    assert.deepEqual(fs.readdirSync(appDir), [filename]);
    assert.deepEqual(fs.readdirSync(workDir), []);
    assert.ok(fs.existsSync(path.join(dataDir, 'app_config.json')));
    fs.copyFileSync(`${report}.png`, path.join(__dirname, '..', 'dist/native-desktop-preview.png'));
    console.log('WINDOWS_NATIVE_DESKTOP_OK: native window, sandboxed renderer, internal-only service, embedded engine, AppData storage');
  } finally { child.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
