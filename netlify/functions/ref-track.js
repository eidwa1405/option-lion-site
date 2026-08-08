// يزيد عداد استخدام كود المسوّق عند تسجيل عميل به — يُستدعى من صفحة التسجيل مباشرة (بدون تسجيل دخول)
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const body = JSON.parse(event.body || '{}');
    const code = String(body.code || '').trim().toUpperCase();
    const customerName = String(body.customerName || '').slice(0, 120);
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الكود فارغ' }) };

    const found = await sql`SELECT code FROM ref_codes WHERE code = ${code}`;
    if (found.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: false }) };
    }
    await sql`UPDATE ref_codes SET uses = uses + 1 WHERE code = ${code}`;
    await sql`INSERT INTO events (type, page, meta) VALUES ('ref_used', 'signup', ${JSON.stringify({ code, customerName })})`;
    await sql`INSERT INTO subscriptions (customer_name, ref_code, status) VALUES (${customerName}, ${code}, 'trial')`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
