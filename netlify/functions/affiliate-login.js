// تسجيل دخول السفير — يتحقق من اسم المستخدم وكلمة المرور، ويرفض إن كان الحساب غير نشط
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const { username, password } = JSON.parse(event.body || '{}');
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername || !password) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' }) };

    const rows = await sql`SELECT * FROM affiliates WHERE login_username = ${cleanUsername} OR code = ${cleanUsername.toUpperCase()}`;
    if (rows.length === 0) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
    const a = rows[0];
    if (!a.password || String(password) !== a.password) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };

    if (!a.approved_at) {
      return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'حسابك كسفير قيد المراجعة — لا يمكنك الدخول إلا بعد التفعيل من الإدارة.' }) };
    }

    const secret = process.env.AFFILIATE_SESSION_SECRET || a.password;
    const token = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + a.code).digest('hex');
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, code: a.code, name: a.name, frozen: !a.active }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
