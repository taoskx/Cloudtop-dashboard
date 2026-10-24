'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractBundledSidecar } = require('../app/desktop_runtime');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudtop-runtime-'));
try {
  const asset = path.join(root, 'bundled.exe');
  const dataDir = path.join(root, 'Local AppData', 'Cloudtop Dashboard');
  fs.writeFileSync(asset, 'MZ-test-first-build');
  const first = extractBundledSidecar(asset, dataDir);
  assert.ok(first.startsWith(dataDir + path.sep));
  const mtime = fs.statSync(first).mtimeMs;
  assert.equal(extractBundledSidecar(asset, dataDir), first);
  assert.equal(fs.statSync(first).mtimeMs, mtime, 'Repeated startup must reuse the intact cache');
  fs.writeFileSync(first, 'damaged');
  assert.equal(extractBundledSidecar(asset, dataDir), first);
  assert.equal(fs.readFileSync(first, 'utf8'), 'MZ-test-first-build', 'A damaged cache must be repaired');
  fs.writeFileSync(asset, 'MZ-test-second-build');
  const second = extractBundledSidecar(asset, dataDir);
  assert.notEqual(second, first, 'Updated engines must not reuse an old executable');
  fs.writeFileSync(asset, 'not an EXE');
  assert.throws(() => extractBundledSidecar(asset, dataDir), /内置 Windows 引擎文件无效/);
  console.log('桌面运行时缓存、更新和损坏恢复测试通过');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
