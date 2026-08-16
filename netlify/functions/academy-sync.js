// مزامنة رسوم الأكاديمية مع Paddle — تعمل تلقائياً كل ساعة وتفعّل أي دفعة فاتت الويبهوك
const { getSql, ensureTables } = require('./_db');

const PADDLE_API_KEY = (process.env.PADDLE_API_KEY || '').trim();
const PADDLE_ENV = (process.env.PADDLE_ENV || 'production').trim();
const API_BASE = PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
const ACADEMY_PRICE_ID = process.env.PADDLE_ACADEMY_PRICE_ID || 'pri_01kzsw7et11f5r4nf08ea7yz5p';

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const debug = !!(event && event.queryStringParameters && event.queryStringParameters.debug);
  try {
    if (!PADDLE_API_KEY) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'PADDLE_API_KEY غير مضبوط في متغيرات البيئة' }) };
    await ensureTables();
    const sql = getSql();
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paddle_transaction_id text`;

    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const url = API_BASE + '/transactions?status=completed&per_page=100&created_at[GTE]=' + encodeURIComponent(since);
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + PADDLE_API_KEY } });
    const json = await res.json();
    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Paddle API رفض الطلب', status: res.status, detail: json && json.error ? json.error : json }) };
    const rows = (json && json.data) || [];
    const seen = [];

    let activated = 0, checked = 0;
    for (const tx of rows) {
      const items = tx.items || [];
      const isAcademy = (tx.custom_data && tx.custom_data.product === 'academy') || items.some(function (it) {
        const p = it && (it.price || it.price_id);
        const pid = typeof p === 'string' ? p : (p && p.id);
        return pid === ACADEMY_PRICE_ID;
      });
      if (debug) seen.push({ id: tx.id, custom: tx.custom_data || null, prices: items.map(function (it) { const p = it && (it.price || it.price_id); return typeof p === 'string' ? p : (p && p.id); }), isAcademy: isAcademy });
      if (!isAcademy) continue;
      checked++;
      const emails = [];
      if (tx.custom_data && tx.custom_data.email) emails.push(String(tx.custom_data.email).trim().toLowerCase());
      if (tx.customer && tx.customer.email) emails.push(String(tx.customer.email).trim().toLowerCase());
      if (tx.billing_details && tx.billing_details.email) emails.push(String(tx.billing_details.email).trim().toLowerCase());
      for (const em of emails) {
        if (!em) continue;
        const upd = await sql`UPDATE academy_students SET paid_at = COALESCE(paid_at, now()), paddle_transaction_id = COALESCE(paddle_transaction_id, ${tx.id})
          WHERE lower(email) = ${em} AND paid_at IS NULL RETURNING id`;
        if (upd.length) {
          activated++;
          await sql`INSERT INTO audit_log (action, details) VALUES ('academy-fee-synced', ${'تفعيل تلقائي بالمزامنة — الطالب #' + upd[0].id + ' (' + em + ') عملية ' + tx.id})`;
          break;
        }
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, scanned: rows.length, academyTx: checked, activated, priceId: ACADEMY_PRICE_ID, transactions: debug ? seen : undefined }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
