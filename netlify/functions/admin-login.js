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
    if (username === ADMIN_USER && verifyPassword(password, ADMIN_PASS)) {
      if (!isHashed(ADMIN_PASS)) {
        await sql`UPDATE admin_settings SET value = ${hashPassword(password)} WHERE key = 'admin_password'`;
      }
      const token = crypto.randomBytes(24).toString('hex');
      const nowIso = new Date().toISOString();
      await sql`INSERT INTO admin_settings (key, value) VALUES ('active_session_token', ${token}) ON CONFLICT (key) DO UPDATE SET value = ${token}`;
      await sql`INSERT INTO admin_settings (key, value) VALUES ('active_session_started_at', ${nowIso}) ON CONFLICT (key) DO UPDATE SET value = ${nowIso}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token }) };
    }
    await sql`INSERT INTO check_attempts (ip, kind) VALUES (${ip}, 'admin-login')`;
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
  } catch (e) {
    try { const sql = getSql(); await sql`INSERT INTO audit_log (action, details) VALUES ('error-admin-login', ${String(e).slice(0,500)})`; } catch(e2){}
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

