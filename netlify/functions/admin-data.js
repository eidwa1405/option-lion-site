const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

function checkToken(event) {
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!token) return false;
  // التوكن موقّع بكلمة المرور الحالية أو المتغير البيئي القديم — نتحقق لاحقاً داخل الدالة نفسها بعد قراءة القاعدة
  return token; // فحص فعلي أدق يتم أدناه في checkTokenAsync
}

async function checkTokenAsync(event, sql) {
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!token) return false;
  const row = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
  const ADMIN_PASS = row.length ? row[0].value : 'A.e.e.s1405@';
  const secret = process.env.ADMIN_SESSION_SECRET || ADMIN_PASS;
  const daySig = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0,10)).digest('hex');
  return token === daySig;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    if (!(await checkTokenAsync(event, sql))) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح — سجّل الدخول مرة أخرى' }) };
    }
    const action = event.queryStringParameters && event.queryStringParameters.action;

    if (event.httpMethod === 'GET' && action === 'overview') {
      const prices = await sql`SELECT * FROM prices ORDER BY amount ASC`;
      const refCodes = await sql`SELECT * FROM ref_codes ORDER BY created_at DESC`;
      const totalViews = await sql`SELECT COUNT(*)::int AS c FROM events WHERE type = 'pageview'`;
      const totalClicks = await sql`SELECT COUNT(*)::int AS c FROM events WHERE type = 'click_join'`;
      const viewsByLang = await sql`SELECT lang, COUNT(*)::int AS c FROM events WHERE type='pageview' GROUP BY lang ORDER BY c DESC`;
      const viewsByPage = await sql`SELECT page, COUNT(*)::int AS c FROM events WHERE type='pageview' GROUP BY page ORDER BY c DESC LIMIT 15`;
      const last14days = await sql`SELECT to_char(created_at,'YYYY-MM-DD') AS day, COUNT(*)::int AS c
        FROM events WHERE type='pageview' AND created_at > now() - interval '14 days'
        GROUP BY day ORDER BY day ASC`;
      const recentEvents = await sql`SELECT type, page, lang, meta, created_at FROM events ORDER BY created_at DESC LIMIT 30`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, prices, refCodes, totalViews: totalViews[0].c, totalClicks: totalClicks[0].c, viewsByLang, viewsByPage, last14days, recentEvents }) };
    }

    if (event.httpMethod === 'POST' && action === 'update-price') {
      const { id, label, amount } = JSON.parse(event.body || '{}');
      await sql`UPDATE prices SET label = ${label}, amount = ${amount} WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('update-price', ${'الباقة ' + id + ' → ' + label + ' ($' + amount + ')'})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'add-ref-code') {
      const { code, owner_name } = JSON.parse(event.body || '{}');
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الكود فارغ' }) };
      await sql`INSERT INTO ref_codes (code, owner_name) VALUES (${cleanCode}, ${owner_name || ''}) ON CONFLICT (code) DO NOTHING`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('add-ref-code', ${'إضافة كود ' + cleanCode})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'delete-ref-code') {
      const { code } = JSON.parse(event.body || '{}');
      await sql`DELETE FROM ref_codes WHERE code = ${String(code || '').toUpperCase()}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('delete-ref-code', ${'حذف كود ' + code})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'add-customer') {
      const { customer_name, phone, telegram, tradingview, plan, ref_code, status, expires_at } = JSON.parse(event.body || '{}');
      if (!customer_name || !customer_name.trim()) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم مطلوب' }) };
      const durationDays = { trial: 14, renew_1m: 30, renew_3m: 90, renew_6m: 180, renew_1y: 365 };
      const days = durationDays[status];
      const expiresAt = expires_at ? new Date(expires_at).toISOString() : (days ? new Date(Date.now() + days * 86400000).toISOString() : null);
      const code = ref_code ? String(ref_code).trim().toUpperCase() : null;
      await sql`INSERT INTO subscriptions (customer_name, ref_code, status, expires_at, phone, telegram, tradingview, plan)
        VALUES (${customer_name.trim()}, ${code}, ${status || 'pending_payment'}, ${expiresAt}, ${phone||''}, ${telegram||''}, ${tradingview||''}, ${plan||''})`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('add-customer', ${'إضافة عميل يدوياً: ' + customer_name})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'customers') {
      const rows = await sql`SELECT id, customer_name, ref_code, status, expires_at, phone, telegram, tradingview, plan, updated_at, created_at FROM subscriptions ORDER BY created_at DESC LIMIT 200`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customers: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'update-customer-info') {
      const { id, phone, telegram, tradingview, plan } = JSON.parse(event.body || '{}');
      await sql`UPDATE subscriptions SET phone = ${phone||''}, telegram = ${telegram||''}, tradingview = ${tradingview||''}, plan = ${plan||''}, updated_at = now() WHERE id = ${id}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'update-status') {
      const { id, status, plan } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT * FROM subscriptions WHERE id = ${id}`;
      if (rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const row = rows[0];
      const durationDays = { trial: 14, renew_1m: 30, renew_3m: 90, renew_6m: 180, renew_1y: 365, canceled: null };
      const days = durationDays[status];
      const newExpiry = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
      await sql`UPDATE subscriptions SET status = ${status}, expires_at = ${newExpiry}, notified_48h = false, updated_at = now() WHERE id = ${id}`;
      if (status && status.indexOf('renew_') === 0 && row.status !== status) {
        if (row.ref_code) {
          await sql`INSERT INTO commission_log (ref_code, customer_name, plan, amount) VALUES (${row.ref_code}, ${row.customer_name}, ${plan || status}, 4)`;
        }
        const planMap = { renew_1m: 'monthly', renew_3m: '3months', renew_6m: '6months', renew_1y: 'yearly' };
        const priceId = planMap[status];
        if (priceId) {
          const priceRows = await sql`SELECT amount FROM prices WHERE id = ${priceId}`;
          const amount = priceRows.length ? priceRows[0].amount : 0;
          await sql`INSERT INTO revenue_log (customer_name, plan, amount) VALUES (${row.customer_name}, ${status}, ${amount})`;
        }
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('update-status', ${'العميل ' + row.customer_name + ' → ' + status})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'affiliates') {
      // تعطيل تلقائي: مضى 14 يوم على التسجيل وما عنده أي تجديد مدفوع
      await sql`UPDATE affiliates a SET active = false
        WHERE a.active = true AND a.created_at < now() - interval '14 days'
        AND NOT EXISTS (SELECT 1 FROM commission_log c WHERE c.ref_code = a.code)`;
      const affiliates = await sql`SELECT a.*, COALESCE(SUM(c.amount),0)::numeric AS total_commission, COUNT(c.id)::int AS renewals
        FROM affiliates a LEFT JOIN commission_log c ON c.ref_code = a.code
        GROUP BY a.code ORDER BY a.active DESC, total_commission DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, affiliates }) };
    }

    if (event.httpMethod === 'POST' && action === 'reactivate-affiliate') {
      const { code } = JSON.parse(event.body || '{}');
      await sql`UPDATE affiliates SET active = true, created_at = now() WHERE code = ${String(code||'').toUpperCase()}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'export-customers') {
      const rows = await sql`SELECT customer_name, ref_code, status, expires_at, phone, telegram, tradingview, plan, created_at FROM subscriptions ORDER BY created_at DESC`;
      let csv = 'الاسم,كود المسوق,الحالة,تاريخ الانتهاء,الجوال,تيليجرام,TradingView,الباقة,تاريخ التسجيل\n';
      rows.forEach(function(r){
        csv += '"'+(r.customer_name||'')+'","'+(r.ref_code||'')+'","'+(r.status||'')+'","'+(r.expires_at?new Date(r.expires_at).toISOString():'')+'","'+(r.phone||'')+'","'+(r.telegram||'')+'","'+(r.tradingview||'')+'","'+(r.plan||'')+'","'+new Date(r.created_at).toISOString()+'"\n';
      });
      return { statusCode: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=customers.csv' }, body: csv };
    }

    if (event.httpMethod === 'GET' && action === 'export-affiliates') {
      const rows = await sql`SELECT a.name, a.legal_name, a.code, a.country, a.city, a.email, a.phone, a.telegram, a.bank_account, a.active,
        COALESCE(SUM(c.amount),0)::numeric AS total_commission, COUNT(c.id)::int AS renewals
        FROM affiliates a LEFT JOIN commission_log c ON c.ref_code = a.code GROUP BY a.code ORDER BY total_commission DESC`;
      let csv = 'الاسم,الاسم القانوني,الكود,الدولة,المدينة,البريد,الجوال,تيليجرام,الحساب البنكي,نشط,عدد التجديدات,إجمالي العمولة\n';
      rows.forEach(function(r){
        csv += '"'+(r.name||'')+'","'+(r.legal_name||'')+'","'+(r.code||'')+'","'+(r.country||'')+'","'+(r.city||'')+'","'+(r.email||'')+'","'+(r.phone||'')+'","'+(r.telegram||'')+'","'+(r.bank_account||'')+'","'+(r.active?'نعم':'لا')+'","'+r.renewals+'","'+r.total_commission+'"\n';
      });
      return { statusCode: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=affiliates.csv' }, body: csv };
    }

    if (event.httpMethod === 'GET' && action === 'audit-log') {
      const rows = await sql`SELECT action, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, logs: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'change-password') {
      const { newPassword } = JSON.parse(event.body || '{}');
      if (!newPassword || newPassword.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }) };
      }
      await sql`UPDATE admin_settings SET value = ${newPassword} WHERE key = 'admin_password'`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'change-username') {
      const { newUsername } = JSON.parse(event.body || '{}');
      if (!newUsername || newUsername.trim().length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' }) };
      }
      await sql`UPDATE admin_settings SET value = ${newUsername.trim()} WHERE key = 'admin_username'`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'affiliate-detail') {
      const code = (event.queryStringParameters && event.queryStringParameters.code || '').toUpperCase();
      const rows = await sql`SELECT * FROM affiliates WHERE code = ${code}`;
      if (rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, affiliate: rows[0] }) };
    }

    if (event.httpMethod === 'GET' && action === 'revenue') {
      const rows = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, SUM(amount)::numeric AS total
        FROM revenue_log WHERE created_at > now() - interval '12 months'
        GROUP BY month ORDER BY month ASC`;
      const totalAll = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM revenue_log`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, monthly: rows, totalAll: totalAll[0].total }) };
    }

    if (event.httpMethod === 'GET' && action === 'pending-reviews') {
      const rows = await sql`SELECT * FROM pending_reviews WHERE status = 'pending' ORDER BY created_at ASC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, reviews: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'approve-review') {
      const { id } = JSON.parse(event.body || '{}');
      await sql`UPDATE pending_reviews SET status = 'approved' WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('approve-review', ${'اعتماد رأي #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'reject-review') {
      const { id } = JSON.parse(event.body || '{}');
      await sql`UPDATE pending_reviews SET status = 'rejected' WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('reject-review', ${'رفض رأي #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
