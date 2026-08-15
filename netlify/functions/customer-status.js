// يبحث عن حالة اشتراك عميل برقم العميل وحساب TradingView معاً (تطابق حرفي تام) — عام بدون تسجيل دخول
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const attempts = await sql`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${ip} AND created_at > ${oneHourAgo}`;
    if (attempts[0].c >= 15) {
      return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'too many attempts, try later' }) };
    }
    await sql`INSERT INTO check_attempts (ip) VALUES (${ip})`;
    const cid = String((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
    const tv = String((event.queryStringParameters && event.queryStringParameters.tv) || '').trim();
    const email = String((event.queryStringParameters && event.queryStringParameters.email) || '').trim().toLowerCase();

    let rows;
    if (email) {
      rows = await sql`SELECT customer_name, status, plan, expires_at FROM subscriptions WHERE email = ${email} ORDER BY created_at DESC LIMIT 1`;
    } else {
      if (!cid || !tv) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'both fields required' }) };
      const cleanTv = tv.replace(/^@/, '');
      rows = await sql`SELECT customer_name, status, plan, expires_at FROM subscriptions
        WHERE customer_id = ${cid} AND tradingview = ${cleanTv}
        ORDER BY created_at DESC LIMIT 1`;
    }
    if (rows.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customer: null }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customer: rows[0] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
