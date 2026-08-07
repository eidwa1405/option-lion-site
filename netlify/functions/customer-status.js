// يبحث عن حالة اشتراك عميل برقم الجوال أو حساب تيليجرام — عام بدون تسجيل دخول
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const q = String((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
    if (!q) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'query missing' }) };
    const clean = q.replace(/^@/, '');
    const rows = await sql`SELECT customer_name, status, plan, expires_at FROM subscriptions
      WHERE phone ILIKE ${'%' + clean + '%'} OR telegram ILIKE ${'%' + clean + '%'} OR tradingview ILIKE ${'%' + clean + '%'}
      ORDER BY created_at DESC LIMIT 1`;
    if (rows.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customer: null }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customer: rows[0] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
