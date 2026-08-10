// تسجيل دخول السفير — يتحقق من اسم المستخدم وكلمة المرور، ويرفض إن كان الحساب غير نشط
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

const { verifyPassword, hashPassword, isHashed } = require('./_auth');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const attempts = await sql`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${ip} AND kind = 'affiliate-login' AND created_at > ${oneHourAgo}`;
    if (attempts[0].c >= 10) {
      return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة جداً، حاول بعد ساعة' }) };
    }
    const { username, password } = JSON.parse(event.body || '{}');
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername || !password) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' }) };

    const rows = await sql`SELECT * FROM affiliates WHERE affiliate_id = ${cleanUsername} OR login_username = ${cleanUsername} OR code = ${cleanUsername.toUpperCase()}`;
    if (rows.length === 0) { await sql`INSERT INTO check_attempts (ip, kind) VALUES (${ip}, 'affiliate-login')`; return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) }; }
    const a = rows[0];
    if (!a.password || !verifyPassword(password, a.password)) { await sql`INSERT INTO check_attempts (ip, kind) VALUES (${ip}, 'affiliate-login')`; return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) }; }
    if (!isHashed(a.password)) {
      await sql`UPDATE affiliates SET password = ${hashPassword(password)} WHERE code = ${a.code}`;
    }

    if (!a.approved_at) {
      return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'حسابك كسفير قيد المراجعة — لا يمكنك الدخول إلا بعد التفعيل من الإدارة.' }) };
    }

    await sql`UPDATE affiliates SET last_login_at = now() WHERE code = ${a.code}`;

    const secret = process.env.AFFILIATE_SESSION_SECRET || a.password;
    const token = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + a.code).digest('hex');
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, code: a.code, name: a.name, frozen: !a.active, affiliateId: a.affiliate_id }) };
  } catch (e) {
    try { const sql = getSql(); await sql`INSERT INTO audit_log (action, details) VALUES ('error-affiliate-login', ${String(e).slice(0,500)})`; } catch(e2){}
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
