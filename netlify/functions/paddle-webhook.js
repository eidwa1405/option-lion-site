// يستقبل إشعارات Paddle Webhooks ويحدّث حالة الاشتراك تلقائياً بقاعدة البيانات
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  try {
    const parts = Object.fromEntries(signatureHeader.split(';').map(p => p.split('=')));
    const ts = parts.ts;
    const h1 = parts.h1;
    const signedPayload = ts + ':' + rawBody;
    const computed = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    return computed === h1;
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const sigHeader = event.headers['paddle-signature'] || event.headers['Paddle-Signature'];
    if (PADDLE_WEBHOOK_SECRET && !verifySignature(event.body, sigHeader, PADDLE_WEBHOOK_SECRET)) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'invalid signature' }) };
    }

    const payload = JSON.parse(event.body || '{}');
    const eventType = payload.event_type;
    const data = payload.data || {};

    await ensureTables();
    const sql = getSql();

    // نحاول مطابقة العميل عبر البريد أو الاسم المخزن في custom_data إن وُجد
    const customerEmail = (data.customer && data.customer.email) || (data.customer_email) || null;
    const customData = data.custom_data || {};
    const customerName = customData.customerName || null;

    let matchRow = null;
    if (customerName) {
      const rows = await sql`SELECT id FROM subscriptions WHERE customer_name = ${customerName} ORDER BY created_at DESC LIMIT 1`;
      if (rows.length) matchRow = rows[0];
    }

    if (matchRow) {
      let newStatus = null;
      let expiresAt = null;
      const billingCycle = data.billing_cycle || (data.items && data.items[0] && data.items[0].billing_cycle) || {};
      const interval = billingCycle.interval;
      const frequency = billingCycle.frequency || 1;

      if (eventType === 'subscription.created' || eventType === 'subscription.activated' || eventType === 'transaction.completed') {
        if (interval === 'month' && frequency === 1) newStatus = 'renew_1m';
        else if (interval === 'month' && frequency === 3) newStatus = 'renew_3m';
        else if (interval === 'month' && frequency === 6) newStatus = 'renew_6m';
        else if (interval === 'year') newStatus = 'renew_1y';
        else newStatus = 'renew_1m';

        const days = { renew_1m: 30, renew_3m: 90, renew_6m: 180, renew_1y: 365 }[newStatus];
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      } else if (eventType === 'subscription.canceled' || eventType === 'subscription.paused') {
        newStatus = 'canceled';
        expiresAt = null;
      }

      if (newStatus) {
        await sql`UPDATE subscriptions SET status = ${newStatus}, expires_at = ${expiresAt}, notified_48h = false, updated_at = now() WHERE id = ${matchRow.id}`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-webhook', ${'Paddle event ' + eventType + ' -> ' + newStatus + ' for customer #' + matchRow.id})`;
      }
    } else {
      await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-webhook-unmatched', ${'Event ' + eventType + ' received, no matching customer found'})`;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
