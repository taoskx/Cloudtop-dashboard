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
  if (process.platform !== 'win32') throw new Error('请在 Windows x64 或仓库的 Windows 构建工作流运行 npm run build:windows');
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const { Resvg } = require('@resvg/resvg-js');
  const png = new Resvg(fs.readFileSync(path.join(ROOT, 'app/static/favicon.svg')), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
  // A PNG-backed ICO is supported on Windows 10/11 and preserves the glass gradients.
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14);
  ico.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(ROOT, 'build/cloudtop.ico'), Buffer.concat([ico, png]));

  run(process.env.ECLOUD_PYTHON || 'python', [
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console', '--noupx',
    '--name', 'cloudtop-sidecar', '--distpath', path.join(ROOT, 'build/sidecar'), '--workpath', path.join(ROOT, 'build/pyinstaller'), '--specpath', path.join(ROOT, 'build'),
    '--paths', path.join(ROOT, 'app/ecloud_engine'), '--collect-all', 'Crypto',
    '--add-data', `${path.join(ROOT, 'app/ecloud_engine/public_credentials.json')}${path.delimiter}.`,
    '--icon', path.join(ROOT, 'build/cloudtop.ico'), path.join(ROOT, 'app/ecloud_engine/sidecar.py'),
  ]);
  const { exec } = require('@yao-pkg/pkg');
  const output = path.join(ROOT, 'dist', `Cloudtop-Dashboard-v${version}-Windows-x64.exe`);
  await exec(['desktop.js', '--config', 'package.json', '--targets', 'node22-win-x64', '--no-bytecode', '--public', '--public-packages', '*', '--output', output]);

  // resedit preserves the pkg payload while replacing Node's icon and product metadata.
  const ResEdit = await import('resedit');
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(output));
  const resource = ResEdit.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'build/cloudtop.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
  for (const group of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, iconFile.icons.map((item) => item.data));
  if (!groups.length) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, 1, 1033, iconFile.icons.map((item) => item.data));
  const info = ResEdit.Resource.VersionInfo.fromEntries(resource.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = version.split('.').map(Number);
  info.setFileVersion(major, minor, patch, 0, 1033);
  info.setProductVersion(major, minor, patch, 0, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Cloudtop Dashboard', ProductName: 'Cloudtop Dashboard', CompanyName: 'taoskx', FileVersion: version, ProductVersion: version, OriginalFilename: path.basename(output) });
  info.outputToResourceEntries(resource.entries);
  resource.outputResource(executable);
  fs.writeFileSync(output, Buffer.from(executable.generate()));
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${checksum}  ${path.basename(output)}\n`);
  console.log(`Built ${output} (${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
