'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Executable assets cannot be spawned from pkg's virtual filesystem.
// Cache the bundled sidecar inside AppData, away from the distributed EXE.
function extractBundledSidecar(assetPath, dataDir) {
  const bytes = fs.readFileSync(assetPath);
  if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('内置 Windows 引擎文件无效');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const dir = path.join(dataDir, 'runtime', hash.slice(0, 20));
  const target = path.join(dir, 'cloudtop-sidecar.exe');
  const matches = () => fs.existsSync(target) && crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === hash;
  if (matches()) return target;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o700 });
    try { fs.renameSync(temp, target); } catch (error) { if (!matches()) throw error; }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return target;
}

module.exports = { extractBundledSidecar };
