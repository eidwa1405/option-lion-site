// يرسل كود تحقق من 6 أرقام إلى بريد العميل/السفير قبل إكمال التسجيل
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const sql = getSql();
    const { email, lang } = JSON.parse(event.body || '{}');
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بريد إلكتروني غير صحيح' }) };
    }
    const recent = await sql`SELECT id FROM email_verifications WHERE email = ${cleanEmail} AND created_at > now() - interval '1 minute'`;
    if (recent.length) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'انتظر دقيقة قبل إعادة الإرسال' }) };

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await sql`INSERT INTO email_verifications (email, code) VALUES (${cleanEmail}, ${code})`;

    const L = (lang || 'ar').slice(0,2);
    const isAr = L === 'ar';
    const subject = isAr ? 'كود تحقق بريدك الإلكتروني — O P N LIO ⚜' : 'Your Email Verification Code — O P N LIO ⚜';
    const bodyHtml = `<div dir="${isAr?'rtl':'ltr'}">${isAr ? 'مرحباً 👋<br><br>كود تحقق بريدك الإلكتروني هو:' : 'Hi 👋<br><br>Your email verification code is:'}<br><br><b style="font-size:26px; color:#D4AF37; letter-spacing:4px;">${code}</b><br><br>${isAr ? 'صالح لمدة 120 ثانية فقط.' : 'Valid for 120 seconds only.'}</div>`;
    const mailRes = await sendMail(cleanEmail, subject, subject, bodyHtml, L);
    if (!mailRes || mailRes.ok !== true) {
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'تعذّر إرسال البريد — تحقق من إعدادات SMTP (' + ((mailRes && mailRes.error) || 'unknown') + ')' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    try { const sql3 = getSql(); await sql3`INSERT INTO audit_log (action, details) VALUES ('error-send-verify', ${String(e).slice(0,500)})`; } catch(e2){}
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
