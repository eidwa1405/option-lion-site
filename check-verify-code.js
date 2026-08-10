// يتحقق من كود التفعيل المُرسَل للبريد قبل إكمال التسجيل
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const sql = getSql();
    const { email, code } = JSON.parse(event.body || '{}');
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    if (!cleanEmail || !cleanCode) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البيانات ناقصة' }) };

    const rows = await sql`SELECT id FROM email_verifications WHERE email = ${cleanEmail} AND code = ${cleanCode} AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1`;
    if (!rows.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الكود غير صحيح أو منتهي الصلاحية' }) };

    await sql`UPDATE email_verifications SET verified = true WHERE email = ${cleanEmail}`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
