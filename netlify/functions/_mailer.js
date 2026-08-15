// أداة إرسال بريد موحّدة — Resend API (HTTPS) أولاً، ثم SMTP احتياطاً
// السبب: خوادم Netlify تُحجب أحياناً عن منافذ SMTP، وResend يعمل عبر HTTPS (443) دائماً.
const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER || 'info@opnlio.com';
const SMTP_PASS = process.env.SMTP_PASS || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_HEADER = '"O P N LIO" <' + SMTP_USER + '>';

let workingIdx = -1;
const SMTP_CONFIGS = [
  { host: 'mail.privateemail.com', port: 465, secure: true },
  { host: 'mail.privateemail.com', port: 587, secure: false, requireTLS: true }
];
function makeTransporter(cfg) {
  return nodemailer.createTransport(Object.assign({}, cfg, {
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    tls: { minVersion: 'TLSv1.2' }
  }));
}
async function smtpSend(mail) {
  const order = workingIdx >= 0 ? [workingIdx, 1 - workingIdx] : [0, 1];
  let lastErr;
  for (const i of order) {
    try {
      await makeTransporter(SMTP_CONFIGS[i]).sendMail(mail);
      workingIdx = i;
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function resendSend(mail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_HEADER, to: [mail.to], reply_to: SMTP_USER, subject: mail.subject, html: mail.html, text: mail.text })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 200));
  }
}
async function brevoSend(mail) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'O P N LIO', email: SMTP_USER }, to: [{ email: mail.to }], replyTo: { email: SMTP_USER }, subject: mail.subject, htmlContent: mail.html, textContent: mail.text })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Brevo ' + res.status + ': ' + body.slice(0, 200));
  }
}

// أيقونة CC للدولة من رمز الاتصال الهاتفي (تقريبي، يغطي الدول الأكثر استخداماً)
const CC_TO_ISO2 = {
  '+966':'sa','+971':'ae','+965':'kw','+974':'qa','+973':'bh','+968':'om','+962':'jo','+961':'lb',
  '+20':'eg','+212':'ma','+213':'dz','+216':'tn','+218':'ly','+964':'iq','+970':'ps','+249':'sd',
  '+1':'us','+44':'gb','+49':'de','+33':'fr','+34':'es','+351':'pt','+39':'it','+90':'tr',
  '+91':'in','+92':'pk','+62':'id','+60':'my','+63':'ph','+86':'cn','+81':'jp','+82':'kr',
  '+7':'ru','+380':'ua','+27':'za','+55':'br','+52':'mx','+61':'au'
};

function isoFromPhone(phone) {
  if (!phone) return 'xx';
  const match = String(phone).match(/^(\+\d{1,4})/);
  if (!match) return 'xx';
  let cc = match[1];
  while (cc.length > 1) {
    if (CC_TO_ISO2[cc]) return CC_TO_ISO2[cc];
    cc = cc.slice(0, -1);
  }
  return 'xx';
}

async function nextCustomerId(sql, phone) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const rand = String(Math.floor(1000000 + Math.random() * 9000000)); // 7 أرقام عشوائية
    const exists = await sql`SELECT id FROM subscriptions WHERE customer_id = ${rand} LIMIT 1`;
    if (exists.length === 0) return rand;
  }
  return String(Date.now()).slice(-7);
}

const BRAND = {
  logo: 'https://opnlio.com/assets/lion-logo.jpg',
  gold: '#D4AF37',
  bg: '#070d18'
};

function emailShell(lang, titleHtml, bodyHtml) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><body style="margin:0;padding:0;background:#0d1220;font-family:Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#0d1220;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" style="max-width:92%;background:linear-gradient(160deg,rgba(212,175,55,.08),rgba(255,255,255,.02));border:1px solid rgba(212,175,55,.3);border-radius:18px;overflow:hidden;">
        <tr><td style="background:#070d18;padding:26px 30px;text-align:center;border-bottom:1px solid rgba(212,175,55,.25);">
          <img src="${BRAND.logo}" width="52" height="52" style="border-radius:50%;border:2px solid ${BRAND.gold};" alt="O P N LIO">
          <div style="color:#f4f0e4;font-weight:900;font-size:17px;margin-top:10px;letter-spacing:.5px;">O P N LIO ⚜</div>
        </tr></td></tr>
        <tr><td style="padding:32px 30px;color:#e9edf5;">
          <h2 style="color:${BRAND.gold};font-size:20px;margin:0 0 16px;">${titleHtml}</h2>
          <div style="font-size:14.5px;line-height:1.9;color:#c9d2e3;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="background:#070d18;padding:20px 30px;text-align:center;border-top:1px solid rgba(255,255,255,.08);">
          <div style="font-size:12px;color:#6b7488;">© 2026 O P N LIO ⚜ — جميع الحقوق محفوظة</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendMail(to, subject, titleHtml, bodyHtml, lang) {
  if (!to) return { skipped: true };
  const html = emailShell(lang || 'ar', titleHtml, bodyHtml);
  const text = String(bodyHtml || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const mail = { to, subject, html, text };
  // 1) مزود HTTPS إن وُجد مفتاحه — لا يتأثر بحجب منافذ SMTP
  const httpsProvider = BREVO_API_KEY ? brevoSend : (RESEND_API_KEY ? resendSend : null);
  if (httpsProvider) {
    try { await httpsProvider(mail); return { ok: true }; }
    catch (e) {
      try { await smtpSend(Object.assign({ from: FROM_HEADER, replyTo: SMTP_USER }, mail)); return { ok: true }; }
      catch (e2) { return { ok: false, error: String(e) + ' | SMTP: ' + String(e2) }; }
    }
  }
  // 2) SMTP فقط (الوضع الحالي)
  try {
    await smtpSend(Object.assign({ from: FROM_HEADER, replyTo: SMTP_USER }, mail));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

module.exports = { sendMail, emailShell, nextCustomerId, isoFromPhone };
