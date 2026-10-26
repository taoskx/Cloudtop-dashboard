'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.CTYUN_DATA_DIR) return path.resolve(env.CTYUN_DATA_DIR);
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || env.APPDATA || path.join(home, 'AppData', 'Local'), 'Cloudtop Dashboard');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cloudtop Dashboard');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'cloudtop-dashboard');
}

function migrateLegacyDataDir(targetDir, legacyDir) {
  if (path.resolve(targetDir) === path.resolve(legacyDir) || fs.existsSync(targetDir) || !fs.existsSync(legacyDir)) return false;
  fs.cpSync(legacyDir, targetDir, { recursive: true, errorOnExist: true, force: false });
  return true;
}

module.exports = { defaultDataDir, migrateLegacyDataDir };
