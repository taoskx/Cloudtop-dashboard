'use strict';

const tls = require('node:tls');
const net = require('node:net');
const { normalizeMailConfig } = require('./mail_config');

function smtpError(stage, line) {
  const error = new Error(`SMTP ${stage} 失败: ${line || '无响应'}`);
  error.stage = stage;
  return error;
}

// Keep a reply queue so split packets, multi-line replies and early greetings
// are consumed exactly once. A timeout/disconnect rejects the active command.
function connectSmtp(cfg) {
  const secure = cfg.smtpPort === 465;
  const socket = secure
    ? tls.connect({ host: cfg.smtpHost, port: cfg.smtpPort, servername: cfg.smtpHost, rejectUnauthorized: true })
    : net.connect({ host: cfg.smtpHost, port: cfg.smtpPort });
  const replies = [], waiters = [];
  let buffer = '', lines = [], failed = null;
  let rejectConnect;
  const connected = new Promise((resolve, reject) => {
    rejectConnect = reject;
    socket.once(secure ? 'secureConnect' : 'connect', resolve);
  });
  const fail = (error) => {
    if (failed) return;
    failed = error;
    rejectConnect(error);
    while (waiters.length) waiters.shift().reject(error);
    socket.destroy();
  };
  socket.setTimeout(cfg.timeoutMs || 20000);
  socket.on('timeout', () => fail(new Error('SMTP 响应超时')));
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('SMTP 连接已关闭')));
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 65536) return fail(new Error('SMTP 应答过长'));
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      lines.push(line);
      if (lines.length > 100) return fail(new Error('SMTP 应答行数过多'));
      if (/^\d{3} /.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), line: lines.join(' | ') };
        lines = [];
        if (waiters.length) waiters.shift().resolve(reply);
        else replies.push(reply);
      }
    }
  });
  return {
    socket, connected,
    send: (line) => socket.write(line + '\r\n'),
    async expect(stage, codes) {
      if (failed) throw failed;
      const reply = replies.length ? replies.shift() : await new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      if (!codes.includes(reply.code)) throw smtpError(stage, reply.line);
      return reply;
    },
  };
}

async function authenticatedSession(config, action) {
  const cfg = normalizeMailConfig(config);
  if (!cfg.smtpUser || !cfg.smtpPass) throw new Error('SMTP 邮箱和授权码不能为空');
  if (/[\r\n]/.test(cfg.smtpUser)) throw new Error('SMTP 邮箱格式不正确');
  const session = connectSmtp(cfg);
  try {
    await session.connected;
    await session.expect('greeting', [220]);
    session.send(`EHLO ${String(cfg.ehloName || 'localhost').replace(/[\r\n]/g, '')}`);
    await session.expect('EHLO', [250]);
    session.send('AUTH LOGIN');
    await session.expect('AUTH', [334]);
    session.send(Buffer.from(cfg.smtpUser, 'utf8').toString('base64'));
    await session.expect('AUTH user', [334]);
    session.send(Buffer.from(cfg.smtpPass, 'utf8').toString('base64'));
    await session.expect('AUTH pass', [235]);
    const result = await action(session, cfg);
    session.send('QUIT');
    session.socket.end();
    return result;
  } finally {
    session.socket.destroy();
  }
}

function verifySmtp(config) {
  return authenticatedSession(config, async (_, cfg) => ({ success: true, host: cfg.smtpHost, port: cfg.smtpPort }));
}

function sendMail(config, mail) {
  return authenticatedSession(config, async (session, cfg) => {
    if (!mail.to || /[\r\n]/.test(mail.to)) throw new Error('收件邮箱格式不正确');
    session.send(`MAIL FROM:<${cfg.smtpUser}>`);
    await session.expect('MAIL FROM', [250]);
    session.send(`RCPT TO:<${mail.to}>`);
    await session.expect('RCPT TO', [250, 251]);
    session.send('DATA');
    await session.expect('DATA', [354]);
    const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
    const headers = [
      `From: =?UTF-8?B?${encode(cfg.fromName || 'Cloudtop Dashboard')}?= <${cfg.smtpUser}>`,
      `To: <${mail.to}>`,
      `Subject: =?UTF-8?B?${encode(mail.subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
    ].join('\r\n');
    const body = encode(mail.text).replace(/(.{76})/g, '$1\r\n');
    session.socket.write(headers + '\r\n' + body + '\r\n.\r\n');
    await session.expect('message', [250]);
    return { success: true };
  });
}

module.exports = { sendMail, verifySmtp };
