// تسجيل دخول المدير — يقارن مع كلمة مرور محفوظة بقاعدة البيانات (قابلة للتعديل من لوحة التحكم)
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { verifyPassword, hashPassword, isHashed } = require('./_auth');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const sql = getSql();
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const attempts = await sql`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${ip} AND kind = 'admin-login' AND created_at > ${oneHourAgo}`;
    if (attempts[0].c >= 10) {
      return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة جداً، حاول بعد ساعة' }) };
    }
    const { username, password } = JSON.parse(event.body || '{}');
    const userRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_username'`;
    const ADMIN_USER = userRow.length ? userRow[0].value : (process.env.ADMIN_USER || 'admin');
    const row = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
    const ADMIN_PASS = row.length ? row[0].value : 'A.e.e.s1405@';
    const { otp } = JSON.parse(event.body || '{}');
    async function issueToken(){
      const token = crypto.randomBytes(24).toString('hex');
      const nowIso = new Date().toISOString();
      await sql`INSERT INTO admin_settings (key, value) VALUES ('active_session_token', ${token}) ON CONFLICT (key) DO UPDATE SET value = ${token}`;
      await sql`INSERT INTO admin_settings (key, value) VALUES ('active_session_started_at', ${nowIso}) ON CONFLICT (key) DO UPDATE SET value = ${nowIso}`;
      return token;
    }
    if (otp) {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'admin_otp'`;
      if (!rows.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا يوجد رمز مُرسل — ادخل بكلمة المرور أولاً' }) };
      let saved = {}; try { saved = JSON.parse(rows[0].value); } catch(e){}
      if (!saved.code || Date.now() - saved.ts > 5 * 60 * 1000) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'انتهت مهلة الرمز (5 دقائق) — ادخل بكلمة المرور من جديد' }) };
      if (String(otp).trim() !== String(saved.code)) {
        await sql`INSERT INTO check_attempts (ip, kind) VALUES (${ip}, 'admin-login')`;
        return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'الرمز غير صحيح' }) };
      }
      await sql`DELETE FROM admin_settings WHERE key = 'admin_otp'`;
      const token = await issueToken();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token }) };
    }
    if (username === ADMIN_USER && verifyPassword(password, ADMIN_PASS)) {
      if (!isHashed(ADMIN_PASS)) {
        await sql`UPDATE admin_settings SET value = ${hashPassword(password)} WHERE key = 'admin_password'`;
      }
      const tgToken = process.env.TELEGRAM_BOT_TOKEN, tgChat = process.env.TELEGRAM_CHAT_ID;
      if (!tgToken || !tgChat) {
        const token = await issueToken();
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, otpSkipped: true }) };
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const payload = JSON.stringify({ code: code, ts: Date.now() });
      await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_otp', ${payload}) ON CONFLICT (key) DO UPDATE SET value = ${payload}`;
      let tgOk = false, tgErr = '';
      try {
        const tgRes = await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChat, text: '🔐 رمز دخول لوحة إدارة OPN LIO: ' + code + '\nصالح 5 دقائق — إن لم تطلبه فغيّر كلمة المرور فوراً.' }) });
        const tgBody = await tgRes.text();
        try { tgOk = !!JSON.parse(tgBody).ok; } catch(e2){ tgOk = false; }
        if (!tgOk) tgErr = 'HTTP ' + tgRes.status + ' — ' + tgBody.slice(0, 300);
      } catch(e) {
        tgErr = String(e).slice(0, 300);
      }
      if (!tgOk) {
        // فشل الإرسال فعلياً: سجّل السبب ولا تحبس المدير خارج اللوحة
        try { await sql`INSERT INTO audit_log (action, details) VALUES ('admin-otp-telegram-failed', ${tgErr || 'unknown'})`; } catch(e3){}
        await sql`DELETE FROM admin_settings WHERE key = 'admin_otp'`;
        const token = await issueToken();
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, otpSkipped: true, otpError: tgErr }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, otpRequired: true, expiresInSec: 300 }) };
    }
    await sql`INSERT INTO check_attempts (ip, kind) VALUES (${ip}, 'admin-login')`;
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
  } catch (e) {
    try { const sql = getSql(); await sql`INSERT INTO audit_log (action, details) VALUES ('error-admin-login', ${String(e).slice(0,500)})`; } catch(e2){}
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

