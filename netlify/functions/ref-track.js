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

    if (body.activate) {
      const customerName = String(body.customerName || '').slice(0, 120);
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
      await sql`UPDATE subscriptions SET status = 'trial', expires_at = ${expiresAt}, updated_at = now()
        WHERE id = (SELECT id FROM subscriptions WHERE customer_name = ${customerName} AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1)`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
    const code = String(body.code || '').trim().toUpperCase();
    const customerName = String(body.customerName || '').slice(0, 120);
    const phone = String(body.phone || '').slice(0, 60);
    const telegram = String(body.telegram || '').slice(0, 60);
    const tradingview = String(body.tradingview || '').slice(0, 60);
    const plan = String(body.plan || '').slice(0, 60);
    if (!customerName) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم مطلوب' }) };

    let validCode = null;
    if (code) {
      const found = await sql`SELECT code FROM ref_codes WHERE code = ${code}`;
      if (found.length > 0) {
        validCode = code;
        await sql`UPDATE ref_codes SET uses = uses + 1 WHERE code = ${code}`;
        await sql`INSERT INTO events (type, page, meta) VALUES ('ref_used', 'signup', ${JSON.stringify({ code, customerName })})`;
      }
    }
    await sql`INSERT INTO subscriptions (customer_name, ref_code, status, phone, telegram, tradingview, plan) VALUES (${customerName}, ${validCode}, 'pending_payment', ${phone}, ${telegram}, ${tradingview}, ${plan})`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: !!validCode }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
