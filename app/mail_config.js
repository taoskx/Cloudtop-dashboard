'use strict';

const fs = require('node:fs');
const path = require('node:path');

function smtpHostFor(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1];
  if (domain === 'qq.com' || domain === 'foxmail.com') return 'smtp.qq.com';
  return 'smtp.gmail.com';
}

function normalizeMailConfig(cfg = {}) {
  const smtpUser = String(cfg.smtpUser || '').trim();
  let smtpHost = String(cfg.smtpHost || '').trim();
  // Migrate the old UI's Gmail default when the account actually belongs to QQ.
  if (!smtpHost || (smtpHost === 'smtp.gmail.com' && smtpHostFor(smtpUser) === 'smtp.qq.com')) smtpHost = smtpHostFor(smtpUser);
  return { ...cfg, smtpUser, smtpHost, smtpPort: Number(cfg.smtpPort) || 465, smtpPass: String(cfg.smtpPass || '').trim(), notifyTo: String(cfg.notifyTo || '').trim() };
}

function applyBundledMailConfig(privateFile, dataDir) {
  if (!fs.existsSync(privateFile)) return false;
  const profile = normalizeMailConfig(JSON.parse(fs.readFileSync(privateFile, 'utf8')));
  if (!profile.revision || !profile.smtpUser || !profile.smtpPass || !profile.notifyTo) throw new Error('内置邮箱配置不完整');
  const target = path.join(dataDir, 'mail-config.json');
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { /* First launch. */ }
  if (previous.bundleRevision === profile.revision) return false;
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const updated = { ...profile, bundleRevision: profile.revision };
  delete updated.revision;
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(updated, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
  return true;
}

module.exports = { smtpHostFor, normalizeMailConfig, applyBundledMailConfig };
