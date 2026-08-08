// تسجيل دخول المدير — يقارن مع كلمة مرور محفوظة بقاعدة البيانات (قابلة للتعديل من لوحة التحكم)
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const sql = getSql();
    const { username, password } = JSON.parse(event.body || '{}');
    const userRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_username'`;
    const ADMIN_USER = userRow.length ? userRow[0].value : (process.env.ADMIN_USER || 'admin');
    const row = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
    const ADMIN_PASS = row.length ? row[0].value : 'A.e.e.s1405@';
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const secret = process.env.ADMIN_SESSION_SECRET || ADMIN_PASS;
      const daySig = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0,10)).digest('hex');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token: daySig }) };
    }
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
