// جلب آخر تنبيهات TradingView — للأعضاء ذوي الاشتراك الفعّال فقط
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    await ensureTables();
    const sql = getSql();
    const qp = event.queryStringParameters || {};
    const cid = String(qp.cid || '').trim();
    const tv = String(qp.tv || '').trim().toLowerCase();
    const email = String(qp.email || '').trim().toLowerCase();

    // مسار العضو الدافع لرسم الأكاديمية (بدون اشتراك)
    if (!cid && email) {
      const st = await sql`SELECT paid_at FROM academy_students WHERE email = ${email} LIMIT 1`;
      if (!st.length || !st[0].paid_at) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'التنبيهات متاحة للمشتركين أو بعد دفع رسم الأكاديمية' }) };
      }
      const alerts0 = await sql`SELECT symbol, timeframe, script_name, direction, message, created_at FROM tv_alerts ORDER BY created_at DESC LIMIT 30`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alerts: alerts0 }) };
    }

    if (!cid || !tv) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };

    const rows = await sql`SELECT status FROM subscriptions WHERE lower(customer_id) = ${cid.toLowerCase()} AND lower(tradingview) = ${tv} LIMIT 1`;
    if (!rows.length || !['active', 'trial'].includes(rows[0].status)) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'التنبيهات المباشرة متاحة للمشتركين النشطين فقط' }) };
    }

    const alerts = await sql`SELECT symbol, timeframe, script_name, direction, message, created_at FROM tv_alerts ORDER BY created_at DESC LIMIT 30`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alerts }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
