'use strict';
const assert=require('node:assert/strict');
const net=require('node:net');
const {sendMail,verifySmtp}=require('../app/smtp_mailer');
async function fixture(mode,action) {
  const commands=[]; let message='';
  const server=net.createServer(socket=>{
    socket.write('220 local test SMTP\r\n');
    let buffer='',state='command';
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8'); let end;
      while((end=buffer.indexOf('\r\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(state==='data') {if(line==='.') {state='command';socket.write('250 queued\r\n');} else message+=line+'\r\n';continue;}
        commands.push(line);
        if(line.startsWith('EHLO')) {if(mode==='timeout') continue;socket.write('250-local test\r\n250 AUTH LOGIN\r\n');}
        else if(line==='AUTH LOGIN') {if(mode==='disconnect'){socket.destroy();return;}state='user';socket.write('334 VXNlcm5hbWU6\r\n');}
        else if(state==='user') {state='password';socket.write('334 UGFzc3dvcmQ6\r\n');}
        else if(state==='password') {state='command';socket.write(mode==='reject'?'535 invalid authorization\r\n':'235 authenticated\r\n');}
        else if(line.startsWith('MAIL FROM')||line.startsWith('RCPT TO')) socket.write('250 OK\r\n');
        else if(line==='DATA') {state='data';socket.write('354 Send content\r\n');}
        else if(line==='QUIT') socket.end('221 bye\r\n');
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await action({smtpHost:'127.0.0.1',smtpPort:server.address().port,smtpUser:'sender@example.test',smtpPass:'test-secret-only',timeoutMs:300},commands,()=>message); }
  finally {await new Promise(resolve=>server.close(resolve));}
}
(async()=>{
  await fixture('normal',async(cfg,commands)=>{assert.equal((await verifySmtp(cfg)).success,true);assert.ok(!commands.some(c=>c.startsWith('MAIL FROM')),'Authentication probe must not send mail');});
  await fixture('normal',async(cfg,commands,message)=>{
    assert.equal((await sendMail(cfg,{to:'receiver@example.test',subject:'测试邮件',text:'验证码：123456'})).success,true);
    assert.ok(commands.includes('RCPT TO:<receiver@example.test>'));
    assert.ok(message().includes(Buffer.from('验证码：123456').toString('base64')));
  });
  await fixture('timeout',async cfg=>assert.rejects(verifySmtp(cfg),/响应超时/));
  await fixture('disconnect',async cfg=>assert.rejects(verifySmtp(cfg),/连接已关闭/));
  await fixture('reject',async cfg=>assert.rejects(verifySmtp(cfg),error=>error.stage==='AUTH pass'&&!error.message.includes(cfg.smtpPass)));
  console.log('SMTP 登录探测、发信、超时、断线和错误脱敏测试通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
