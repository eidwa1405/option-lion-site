// مزامنة يدوية مع Paddle API — يسحب آخر المعاملات ويحدّث حالات الاشتراك المطابقة
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');
const { awardCommission } = require('./_commission');

const PADDLE_API_KEY = (process.env.PADDLE_API_KEY || '').trim();
const PADDLE_API_BASE = process.env.PADDLE_SANDBOX === 'true' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

function computeStatusAndExpiry(interval, frequency) {
  let status;
  if (interval === 'month' && frequency === 1) status = 'renew_1m';
  else if (interval === 'month' && frequency === 3) status = 'renew_3m';
  else if (interval === 'month' && frequency === 6) status = 'renew_6m';
  else if (interval === 'year') status = 'renew_1y';
  else status = 'renew_1m';
  const days = { renew_1m: 30, renew_3m: 90, renew_6m: 180, renew_1y: 365 }[status];
  return { status, expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return { statusCode: 405, headers, body: 'Method not allowed' };

  if (!PADDLE_API_KEY) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'مفتاح Paddle API غير مُعرَّف (PADDLE_API_KEY) في متغيرات البيئة' }) };
  }

  if (event.queryStringParameters && event.queryStringParameters.debug === '1') {
    const testRes1 = await fetch(`${PADDLE_API_BASE}/event-types`, { headers: { Authorization: `Bearer ${PADDLE_API_KEY}` } });
    const testBody1 = await testRes1.text();
    const testRes2 = await fetch(`${PADDLE_API_BASE}/event-types`, { headers: { Authorization: PADDLE_API_KEY } });
    const testBody2 = await testRes2.text();
    return { statusCode: 200, headers, body: JSON.stringify({
      ok: true,
      keyLength: PADDLE_API_KEY.length,
      withBearer: { status: testRes1.status, body: testBody1.slice(0, 200) },
      withoutBearer: { status: testRes2.status, body: testBody2.slice(0, 200) }
    }) };
  }

  try {
    await ensureTables();
    const sql = getSql();

    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const res = await fetch(`${PADDLE_API_BASE}/transactions?billed_at[gte]=${encodeURIComponent(since)}&status=completed&per_page=100`, {
      headers: { Authorization: `Bearer ${PADDLE_API_KEY}` }
    });
    if (!res.ok) {
      const errTxt = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'فشل الاتصال بـPaddle: ' + errTxt.slice(0, 300) }) };
    }
    const data = await res.json();
    const transactions = data.data || [];

    let matched = 0, unmatched = 0;
    for (const tx of transactions) {
      const customData = tx.custom_data || {};
      const customerName = customData.customerName || null;
      const customerEmail = customData.customerEmail || (tx.customer && tx.customer.email) || null;
      if (!customerName && !customerEmail) { unmatched++; continue; }

      let rows = [];
      if (customerEmail) {
        rows = await sql`SELECT id, ref_code, self_ref_flagged FROM subscriptions WHERE lower(email) = ${String(customerEmail).toLowerCase()} ORDER BY created_at DESC LIMIT 1`;
      }
      if (!rows.length && customerName) {
        rows = await sql`SELECT id, ref_code, self_ref_flagged FROM subscriptions WHERE customer_name = ${customerName} ORDER BY created_at DESC LIMIT 1`;
      }
      if (!rows.length) { unmatched++; continue; }

      const item = (tx.items && tx.items[0]) || {};
      const billingCycle = tx.billing_period ? null : (item.price && item.price.billing_cycle) || {};
      const interval = billingCycle.interval || 'month';
      const frequency = billingCycle.frequency || 1;
      const { status, expiresAt } = computeStatusAndExpiry(interval, frequency);
      const amount = tx.details && tx.details.totals && tx.details.totals.total ? parseFloat(tx.details.totals.total) / 100 : null;

      await sql`UPDATE subscriptions SET status = ${status}, expires_at = ${expiresAt}, notified_48h = false, aff_reminder_48h_sent = false, aff_reminder_12h_sent = false, paddle_transaction_id = ${tx.id}, paddle_amount = ${amount}, last_status_source = 'paddle', updated_at = now() WHERE id = ${rows[0].id}`;
      matched++;
      if (rows[0].ref_code && tx.id) {
        await awardCommission(sql, { sendMail, refCode: rows[0].ref_code, customerName: customerName, selfRefFlagged: rows[0].self_ref_flagged, planLabel: status, txId: tx.id }).catch(function(){});
      }
    }

    await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-manual-sync', ${'مزامنة يدوية: ' + matched + ' مطابق، ' + unmatched + ' غير مطابق من ' + transactions.length}) `;

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, total: transactions.length, matched, unmatched }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
