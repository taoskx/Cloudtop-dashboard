'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { version } = require('../package.json');
const ROOT = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
async function main() {
  if (process.platform !== 'win32') throw new Error('请在 Windows x64 或 Windows 构建工作流运行');
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const { Resvg } = require('@resvg/resvg-js');
  const png = new Resvg(fs.readFileSync(path.join(ROOT, 'app/static/favicon.svg')), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(ROOT, 'build/cloudtop.ico'), Buffer.concat([ico, png]));
  run(process.env.ECLOUD_PYTHON || 'python', [
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console', '--noupx',
    '--name', 'cloudtop-sidecar', '--distpath', path.join(ROOT, 'build/sidecar'), '--workpath', path.join(ROOT, 'build/pyinstaller'), '--specpath', path.join(ROOT, 'build'),
    '--paths', path.join(ROOT, 'app/ecloud_engine'), '--collect-all', 'Crypto',
    '--add-data', `${path.join(ROOT, 'app/ecloud_engine/public_credentials.json')}${path.delimiter}.`,
    '--icon', path.join(ROOT, 'build/cloudtop.ico'), path.join(ROOT, 'app/ecloud_engine/sidecar.py'),
  ]);
  const { build, Platform } = require('electron-builder');
  await build({ targets: Platform.WINDOWS.createTarget(['portable']), config: require('../electron-builder.config.cjs') });
  const output = path.join(ROOT, 'dist', `Cloudtop-Dashboard-v${version}-Windows-x64.exe`);
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${checksum}  ${path.basename(output)}\n`);
  // This public staging archive contains no private mail profile. The author can
  // add a private profile and rebuild the portable wrapper entirely offline.
  run('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(ROOT, 'dist/win-unpacked/*').replace(/'/g,"''")}' -DestinationPath '${path.join(ROOT, 'dist/Cloudtop-desktop-staging.zip').replace(/'/g,"''")}' -Force`]);
  console.log(`Built native desktop ${version}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
