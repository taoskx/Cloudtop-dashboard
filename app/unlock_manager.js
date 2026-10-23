'use strict';
/**
 * 应用解锁（邮箱验证码）状态机 —— 2026-10-23 用户需求：
 * 软件不免费共享：使用者在解锁页填写邮箱申请验证码，验证码只发送到作者邮箱，
 * 作者人工转交；使用者输对一次即永久解锁（免登录）。
 * 规则（用户定）：验证码 20 分钟内有效；连续输错 3 次，锁定 1 小时（期间不能再输码、也不能再申请）。
 *
 * 状态落盘 DATA_DIR/app-unlock.json（0600）：验证码只存加盐哈希，绝不存明文。
 * 发信凭据（Gmail 应用专用密码等）不在本文件、不进代码仓库：运行时从
 * DATA_DIR/mail-config.json 读取（作者在本机「作者设置」里填写），形状：
 *   { smtpHost, smtpPort, smtpUser, smtpPass, fromName, notifyTo }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODE_TTL_MS = 20 * 60 * 1000;      // 验证码有效期 20 分钟
const LOCK_MS = 60 * 60 * 1000;          // 输错 3 次锁定 1 小时
const MAX_ATTEMPTS = 3;                  // 最大输错次数
const RESEND_COOLDOWN_MS = 60 * 1000;    // 两次申请至少间隔 60 秒

function defaultState() {
  return {
    installId: crypto.randomUUID(),
    unlocked: false,
    unlockedEmail: '',
    unlockedAt: 0,
    pending: null,      // { email, codeHash, expiresAt, attempts, sentAt }
    lockedUntil: 0,
  };
}

class UnlockManager {
  /** opts: { dataDir, sendMail(cfg, mail), loadMailConfig(), now() } —— 后三者可注入便于测试 */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.stateFile = path.join(this.dataDir, 'app-unlock.json');
    this.sendMail = opts.sendMail;
    this.loadMailConfig = opts.loadMailConfig;
    this.now = opts.now || (() => Date.now());
    this.state = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return Object.assign(defaultState(), raw);
    } catch (e) {
      const st = defaultState();
      this.state = st;
      this._save();
      return st;
    }
  }

  _save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.stateFile);
    } catch (e) { /* 磁盘不可写时仅内存生效，不拖垮主流程 */ }
  }

  _hashCode(email, code) {
    return crypto.createHash('sha256')
      .update(`${this.state.installId}:${email.toLowerCase()}:${code}`)
      .digest('hex');
  }

  isUnlocked() { return this.state.unlocked === true; }

  isLocked() { return (this.state.lockedUntil || 0) > this.now(); }

  lockRemainSec() {
    return this.isLocked() ? Math.ceil((this.state.lockedUntil - this.now()) / 1000) : 0;
  }

  mailConfigured() {
    const cfg = this.loadMailConfig();
    return !!(cfg && cfg.smtpUser && cfg.smtpPass && cfg.notifyTo);
  }

  status() {
    return {
      unlocked: this.isUnlocked(),
      unlockedEmail: this.state.unlockedEmail || '',
      configured: this.mailConfigured(),
      locked: this.isLocked(),
      lockRemainSec: this.lockRemainSec(),
      hasPending: !!this.state.pending,
      pendingEmail: this.state.pending ? this.state.pending.email : '',
    };
  }

  /** 申请验证码：生成 6 位码 → 发到作者邮箱（notifyTo），请求者邮箱只出现在邮件正文里供作者辨认 */
  async requestCode(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: '请填写有效的邮箱地址' };
    }
    if (this.isUnlocked()) return { success: false, error: '应用已解锁，无需再申请' };
    if (this.isLocked()) {
      return { success: false, error: `输错次数过多，已锁定，请 ${Math.ceil(this.lockRemainSec() / 60)} 分钟后再试`, locked: true, lockRemainSec: this.lockRemainSec() };
    }
    const cfg = this.loadMailConfig();
    if (!cfg || !cfg.smtpUser || !cfg.smtpPass || !cfg.notifyTo) {
      return { success: false, error: '作者尚未配置发信邮箱，请联系作者', notConfigured: true };
    }
    const now = this.now();
    if (this.state.pending && now - this.state.pending.sentAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - this.state.pending.sentAt)) / 1000);
      return { success: false, error: `发送太频繁，请 ${wait} 秒后再申请` };
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    try {
      await this.sendMail(cfg, {
        to: cfg.notifyTo,
        subject: '【云电脑保活控制台】解锁验证码申请',
        text: [
          '有人申请解锁「云电脑保活控制台」，请核对身份后把验证码转交给他/她：',
          '',
          `申请邮箱：${email}`,
          `验证码：${code}`,
          `有效期：20 分钟（过期请对方重新申请）`,
          `设备标识：${this.state.installId.slice(0, 8)}`,
          '',
          '若不认识此申请人，请忽略本邮件，不要转交验证码。',
        ].join('\n'),
      });
    } catch (e) {
      return { success: false, error: `验证码发送失败（${e.message}），请稍后再试或联系作者` };
    }
    this.state.pending = {
      email,
      codeHash: this._hashCode(email, code),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      sentAt: now,
    };
    this._save();
    return { success: true, message: '验证码已发送到作者邮箱，请联系作者索取后输入' };
  }

  /** 输入验证码解锁：成功 → 永久解锁；错 3 次 → 锁定 1 小时 */
  verify(email, code) {
    email = String(email || '').trim();
    code = String(code || '').trim();
    if (this.isUnlocked()) return { success: false, error: '应用已解锁' };
    if (this.isLocked()) {
      return { success: false, error: `已锁定，请 ${Math.ceil(this.lockRemainSec() / 60)} 分钟后再试`, locked: true, lockRemainSec: this.lockRemainSec() };
    }
    const p = this.state.pending;
    if (!p) return { success: false, error: '请先申请验证码' };
    if (this.now() > p.expiresAt) {
      this.state.pending = null;
      this._save();
      return { success: false, error: '验证码已过期（有效期 20 分钟），请重新申请' };
    }
    if (p.email.toLowerCase() !== email.toLowerCase()) {
      return { success: false, error: '邮箱与申请时不一致' };
    }
    if (!/^\d{6}$/.test(code)) return { success: false, error: '验证码为 6 位数字' };

    if (this._hashCode(email, code) === p.codeHash) {
      this.state.unlocked = true;
      this.state.unlockedEmail = email;
      this.state.unlockedAt = this.now();
      this.state.pending = null;
      this.state.lockedUntil = 0;
      this._save();
      return { success: true, message: '解锁成功' };
    }
    p.attempts += 1;
    if (p.attempts >= MAX_ATTEMPTS) {
      this.state.pending = null;
      this.state.lockedUntil = this.now() + LOCK_MS;
      this._save();
      return { success: false, error: '验证码连续输错 3 次，已锁定 1 小时', locked: true, lockRemainSec: this.lockRemainSec() };
    }
    this._save();
    return { success: false, error: `验证码不正确，还可尝试 ${MAX_ATTEMPTS - p.attempts} 次`, attemptsLeft: MAX_ATTEMPTS - p.attempts };
  }
}

module.exports = { UnlockManager, CODE_TTL_MS, LOCK_MS, MAX_ATTEMPTS };
