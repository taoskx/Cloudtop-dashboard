'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaultDataDir, migrateLegacyDataDir } = require('../app/data_dir');

const home = path.join(os.tmpdir(), 'cloudtop-home');
assert.equal(defaultDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Owner\\AppData\\Local' }, home }),
  path.join('C:\\Users\\Owner\\AppData\\Local', 'Cloudtop Dashboard'));
assert.equal(defaultDataDir({ platform: 'darwin', env: {}, home }),
  path.join(home, 'Library', 'Application Support', 'Cloudtop Dashboard'));
assert.equal(defaultDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/custom/data' }, home }),
  path.join('/custom/data', 'cloudtop-dashboard'));
assert.equal(defaultDataDir({ platform: 'win32', env: { CTYUN_DATA_DIR: '/explicit' }, home }), path.resolve('/explicit'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudtop-data-migration-'));
try {
  const legacy = path.join(root, 'data');
  const target = path.join(root, 'system', 'Cloudtop Dashboard');
  fs.mkdirSync(path.join(legacy, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'app_config.json'), '{"version":1}');
  fs.writeFileSync(path.join(legacy, 'logs', 'history.jsonl'), 'entry');
  assert.equal(migrateLegacyDataDir(target, legacy), true);
  assert.equal(fs.readFileSync(path.join(target, 'app_config.json'), 'utf8'), '{"version":1}');
  assert.equal(fs.readFileSync(path.join(target, 'logs', 'history.jsonl'), 'utf8'), 'entry');
  assert.equal(fs.existsSync(legacy), true);
  fs.writeFileSync(path.join(legacy, 'app_config.json'), '{"version":2}');
  assert.equal(migrateLegacyDataDir(target, legacy), false);
  assert.equal(fs.readFileSync(path.join(target, 'app_config.json'), 'utf8'), '{"version":1}');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('数据目录路径与旧数据迁移测试通过');
