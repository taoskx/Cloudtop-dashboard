'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { version } = require('../package.json');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Cloudtop smoke 中文 '));
  const appDir = path.join(root, 'portable app');
  const appData = path.join(root, 'Local AppData');
  const workDir = path.join(root, 'working directory');
  fs.mkdirSync(appDir);
  fs.mkdirSync(workDir);
  const filename = `Cloudtop-Dashboard-v${version}-Windows-x64.exe`;
  const exe = path.join(appDir, filename);
  fs.copyFileSync(path.join(__dirname, '..', 'dist', filename), exe);
  const env = { ...process.env, LOCALAPPDATA: appData, CLOUDTOP_NO_BROWSER: '1', PORT: '18571' };
  // Explicitly remove build-machine Python overrides: the shipped EXE must be self-contained.
  delete env.CTYUN_DATA_DIR;
  delete env.ECLOUD_PYTHON;
  delete env.ECLOUD_SIDECAR;
  env.PATH = path.join(process.env.SystemRoot, 'System32');
  const selfTest = spawnSync(exe, ['--self-test'], { cwd: workDir, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(selfTest.status, 0, `${selfTest.stdout}\n${selfTest.stderr}\n${selfTest.error || ''}`);
  assert.match(selfTest.stdout, /CLOUDTOP_SELF_TEST_OK/);
  const child = spawn(exe, [], { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (bytes) => { output += bytes; });
  child.stderr.on('data', (bytes) => { output += bytes; });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch('http://127.0.0.1:18571/', { signal: AbortSignal.timeout(1000) });
        if (response.ok) { assert.match(await response.text(), /class="header-top"/); ready = true; break; }
      } catch (_) { /* Allow the packaged process time to start. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, `Packaged server did not become ready:\n${output}`);
    for (const asset of ['glass.css', 'style.css', 'app.js', 'favicon.svg']) {
      const response = await fetch(`http://127.0.0.1:18571/static/${asset}`);
      assert.equal(response.status, 200, `${asset} is missing from EXE`);
      assert.ok((await response.text()).length > 100);
    }
    assert.deepEqual(fs.readdirSync(appDir), [filename], 'EXE must not create a sibling data directory');
    assert.deepEqual(fs.readdirSync(workDir), [], 'Working directory must stay clean');
    const dataDir = path.join(appData, 'Cloudtop Dashboard');
    assert.ok(fs.existsSync(path.join(dataDir, 'app_config.json')), 'Settings must live in AppData');
    assert.ok(fs.existsSync(path.join(dataDir, 'runtime')), 'Bundled sidecar must be cached in AppData');
    console.log('WINDOWS_EXE_SMOKE_OK: single EXE, embedded engine, bundled UI, AppData storage, Unicode paths');
  } finally {
    child.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
