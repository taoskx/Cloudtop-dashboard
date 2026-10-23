'use strict';
/**
 * 极简 SMTP 发信（零依赖）：支持 465 隐式 TLS 与 587/25 明文（后者仅供本地测试）。
 * 只实现本项目需要的子集：EHLO、AUTH LOGIN、MAIL FROM、RCPT TO、DATA、QUIT。
 * 凭据只从调用方传入的 config 读取，本模块不落盘、不打日志（避免密码进日志）。
 */
const tls = require('tls');
const net = require('net');

function smtpError(stage, line) {
  const err = new Error(`SMTP ${stage} 失败: ${line || '无响应'}`);
  err.stage = stage;
  return err;
}

/** 读取一条（或多行 250- 续行）SMTP 应答，返回 {code, line} */
function readReply(socket, bufState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; socket.off('data', onData); socket.off('error', onErr); fn(val); } };
    const onErr = (e) => finish(reject, e);
    const onData = (chunk) => {
      bufState.buf += chunk.toString('utf8');
      let idx;
      while ((idx = bufState.buf.indexOf('\r\n')) >= 0) {
        const line = bufState.buf.slice(0, idx);
        bufState.buf = bufState.buf.slice(idx + 2);
        bufState.lines.push(line);
        // 多行应答以 "250 "（空格）结尾，"250-" 为续行
        if (/^\d{3} /.test(line) || bufState.lines.length > 20) {
          const lines = bufState.lines.slice();
          bufState.lines = [];
          finish(resolve, { code: parseInt(line.slice(0, 3), 10), line: lines.join(' | ') });
          return;
        }
      }
    };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function sendMail(cfg, mail) {
  const host = cfg.smtpHost || 'smtp.gmail.com';
  const port = parseInt(cfg.smtpPort) || 465;
  const secure = port === 465;
  const timeoutMs = 20000;

  const socket = secure
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
  socket.setTimeout(timeoutMs);

  const bufState = { buf: '', lines: [] };
  const send = (line) => socket.write(line + '\r\n');
  const expect = async (stage, codes) => {
    const r = await readReply(socket, bufState);
    if (!codes.includes(r.code)) throw smtpError(stage, r.line);
    return r;
  };

  try {
    await new Promise((resolve, reject) => {
      const ev = secure ? 'secureConnect' : 'connect';
      socket.once(ev, resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('SMTP 连接超时')));
    });
    await expect('greeting', [220]);
    send(`EHLO ${cfg.ehloName || 'localhost'}`);
    await expect('EHLO', [250]);
    send('AUTH LOGIN');
    await expect('AUTH', [334]);
    send(Buffer.from(cfg.smtpUser, 'utf8').toString('base64'));
    await expect('AUTH user', [334]);
    send(Buffer.from(cfg.smtpPass, 'utf8').toString('base64'));
    await expect('AUTH pass', [235]);
    send(`MAIL FROM:<${cfg.smtpUser}>`);
    await expect('MAIL FROM', [250]);
    send(`RCPT TO:<${mail.to}>`);
    await expect('RCPT TO', [250, 251]);
    send('DATA');
    await expect('DATA', [354]);
    const subjectB64 = Buffer.from(mail.subject, 'utf8').toString('base64');
    const headers = [
      `From: =?UTF-8?B?${Buffer.from(cfg.fromName || 'CloudPC Dashboard', 'utf8').toString('base64')}?= <${cfg.smtpUser}>`,
      `To: <${mail.to}>`,
      `Subject: =?UTF-8?B?${subjectB64}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
    ].join('\r\n');
    const bodyB64 = Buffer.from(mail.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    socket.write(headers + '\r\n' + bodyB64 + '\r\n.\r\n');
    await expect('message', [250]);
    send('QUIT');
    socket.end();
    return { success: true };
  } catch (e) {
    try { socket.destroy(); } catch (_) {}
    throw e;
  }
}

module.exports = { sendMail };
