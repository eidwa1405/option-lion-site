const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { AGREEMENT_TITLE, AGREEMENT_HTML, getAgreement } = require('./_agreement.js');
const { awardCommission, PLAN_BASE, TIERS, tierFor, round2 } = require('./_commission.js');
const { sendMail } = require('./_mailer');
const { hashPassword } = require('./_auth');

function checkToken(event) {
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!token) return false;
  // التوكن موقّع بكلمة المرور الحالية أو المتغير البيئي القديم — نتحقق لاحقاً داخل الدالة نفسها بعد قراءة القاعدة
  return token; // فحص فعلي أدق يتم أدناه في checkTokenAsync
}

async function checkTokenAsync(event, sql) {
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!token) return false;
  const rows = await sql`SELECT key, value FROM admin_settings WHERE key IN ('active_session_token','active_session_started_at')`;
  const map = {}; rows.forEach(r => map[r.key] = r.value);
  if (!map.active_session_token || token !== map.active_session_token) return false;
  if (map.active_session_started_at) {
    const started = new Date(map.active_session_started_at).getTime();
    if (Date.now() - started > 24 * 3600 * 1000) return false;
  }
  return true;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const action = event.queryStringParameters && event.queryStringParameters.action;
    // page-visibility تُقرأ علنياً (يحتاجها page-guard في كل الصفحات)
    if (!(event.httpMethod === 'GET' && action === 'page-visibility')) {
      if (!(await checkTokenAsync(event, sql))) {
        return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح — سجّل الدخول مرة أخرى' }) };
      }
    }

    if (event.httpMethod === 'GET' && action === 'broadcast-langs') {
      const audience = event.queryStringParameters && event.queryStringParameters.audience;
      let rows;
      if (audience === 'affiliates') {
        rows = await sql`SELECT DISTINCT COALESCE(lang,'ar') AS lang FROM affiliates WHERE email IS NOT NULL AND email != ''`;
      } else if (audience === 'academy') {
        rows = await sql`SELECT DISTINCT COALESCE(lang,'ar') AS lang FROM academy_students WHERE email IS NOT NULL AND email != ''`;
      } else {
        rows = await sql`SELECT DISTINCT lang FROM subscriptions WHERE email IS NOT NULL AND email != '' AND email_verified = true`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, langs: rows.map(r => r.lang || 'ar') }) };
    }

    if (event.httpMethod === 'GET' && action === 'notifications') {
      const pendingAff = await sql`SELECT COUNT(*)::int AS c FROM affiliates WHERE approved_at IS NULL`;
      const newCustomers = await sql`SELECT id, customer_name, created_at FROM subscriptions WHERE created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 20`;
      const newAffiliates = await sql`SELECT code, name, created_at FROM affiliates WHERE approved_at IS NULL ORDER BY created_at DESC LIMIT 20`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: pendingAff[0].c + newCustomers.length, newCustomers, newAffiliates }) };
    }

    if (event.httpMethod === 'GET' && action === 'heartbeat') {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'tv-alerts') {
      const alerts = await sql`SELECT symbol, timeframe, script_name, direction, message, created_at FROM tv_alerts ORDER BY created_at DESC LIMIT 50`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alerts }) };
    }

    if (event.httpMethod === 'POST' && action === 'logout') {
      await sql`DELETE FROM admin_settings WHERE key IN ('active_session_token','active_session_started_at')`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'analytics') {
      const monthlySignups = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*)::int AS c FROM subscriptions WHERE created_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const statusDist = await sql`SELECT status, COUNT(*)::int AS c FROM subscriptions GROUP BY status ORDER BY c DESC`;
      const affiliateGrowth = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*)::int AS c FROM affiliates WHERE created_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const cancellations = await sql`SELECT to_char(updated_at,'YYYY-MM') AS month, COUNT(*)::int AS c FROM subscriptions WHERE status = 'canceled' AND updated_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const totalSignups = await sql`SELECT COUNT(*)::int AS c FROM subscriptions`;
      const totalPaid = await sql`SELECT COUNT(*)::int AS c FROM subscriptions WHERE status LIKE 'renew_%'`;
      const avgCommissionPerAff = await sql`SELECT COALESCE(AVG(t.total),0)::numeric AS avg FROM (SELECT ref_code, SUM(amount) AS total FROM commission_log GROUP BY ref_code) t`;
      const topAffiliates = await sql`SELECT a.name, a.code, COALESCE(SUM(c.amount),0)::numeric AS total FROM affiliates a LEFT JOIN commission_log c ON c.ref_code = a.code GROUP BY a.code ORDER BY total DESC LIMIT 5`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, monthlySignups, statusDist, affiliateGrowth, cancellations, totalSignups: totalSignups[0].c, totalPaid: totalPaid[0].c, avgCommissionPerAff: avgCommissionPerAff[0].avg, topAffiliates }) };
    }

    if (event.httpMethod === 'GET' && action === 'affiliate-report') {
      const code = String((event.queryStringParameters && event.queryStringParameters.code) || '').toUpperCase();
      const rows = await sql`SELECT * FROM affiliates WHERE code = ${code}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const a = rows[0];
      const totalCount = await sql`SELECT COUNT(*)::int AS c FROM commission_log WHERE ref_code = ${code}`;
      const lifetimeTotal = totalCount[0].c;
      const tierNow = tierFor(lifetimeTotal);
      const nextT = TIERS.slice().reverse().find(function (t) { return t.min > lifetimeTotal; });
      const currentAmp = round2(PLAN_BASE.renew_1m * tierNow.mult);
      const milestoneFloor = tierNow.mult;
      const monthlyBalanceRows = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE ref_code = ${code} AND created_at >= date_trunc('month', now())`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, report: {
        amp: currentAmp, floor: milestoneFloor, tierMult: tierNow.mult, tierMin: tierNow.min, nextTierMin: nextT ? nextT.min : null, nextTierMult: nextT ? nextT.mult : null, renewalsToNext: nextT ? (nextT.min - lifetimeTotal) : null, planTable: { renew_1m: round2(PLAN_BASE.renew_1m * tierNow.mult), renew_3m: round2(PLAN_BASE.renew_3m * tierNow.mult), renew_6m: round2(PLAN_BASE.renew_6m * tierNow.mult), renew_1y: round2(PLAN_BASE.renew_1y * tierNow.mult) }, customerCount: lifetimeTotal, monthlyBalance: monthlyBalanceRows[0].total,
        createdAt: a.created_at, lastLoginAt: a.last_login_at, name: a.name, email: a.email
      } }) };
    }

    if (event.httpMethod === 'GET' && action === 'payout-runs') {
      const runs = await sql`SELECT r.id, r.month, r.created_at, COALESCE(SUM(i.amount),0)::numeric AS total, COUNT(i.id)::int AS affiliate_count
        FROM payout_runs r LEFT JOIN payout_items i ON i.run_id = r.id GROUP BY r.id ORDER BY r.month DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, runs }) };
    }

    if (event.httpMethod === 'GET' && action === 'payout-run-detail') {
      const runId = parseInt((event.queryStringParameters && event.queryStringParameters.runId) || '0', 10);
      const run = await sql`SELECT * FROM payout_runs WHERE id = ${runId}`;
      if (!run.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const items = await sql`SELECT * FROM payout_items WHERE run_id = ${runId} ORDER BY amount DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, month: run[0].month, items }) };
    }

    if (event.httpMethod === 'POST' && action === 'generate-payout-now') {
      const { month } = JSON.parse(event.body || '{}');
      const monthKey = month || (function(){ const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth()-1, 1); return p.getFullYear()+'-'+String(p.getMonth()+1).padStart(2,'0'); })();
      const existingRun = await sql`SELECT id FROM payout_runs WHERE month = ${monthKey}`;
      if (existingRun.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'دفعة صرف هذا الشهر موجودة مسبقاً' }) };
      const rows = await sql`SELECT a.code, a.name, a.legal_name, a.bank_account, COALESCE(SUM(c.amount),0)::numeric AS amount, COALESCE(SUM(c.floor_amount),0)::numeric AS floor_amount, COALESCE(SUM(c.bonus_amount),0)::numeric AS bonus_amount
        FROM affiliates a JOIN commission_log c ON c.ref_code = a.code
        WHERE to_char(c.created_at, 'YYYY-MM') = ${monthKey}
        GROUP BY a.code, a.name, a.legal_name, a.bank_account`;
      const positiveRows = [];
      for (const r of rows) {
        let amt = parseFloat(r.amount);
        let floorAmt = parseFloat(r.floor_amount);
        let bonusAmt = parseFloat(r.bonus_amount);
        const carryRows = await sql`SELECT value FROM admin_settings WHERE key = ${'carry_negative_' + r.code}`;
        const carry = carryRows.length ? parseFloat(carryRows[0].value) : 0;
        if (carry < 0) {
          amt += carry;
          // خصم الترحيل السالب من المكافأة أولاً ثم من العمولة الأساسية حتى يبقى التفصيل مطابقاً للإجمالي
          let deficit = -carry;
          const fromBonus = Math.min(bonusAmt, deficit);
          bonusAmt -= fromBonus; deficit -= fromBonus;
          floorAmt = Math.max(0, floorAmt - deficit);
        }
        if (amt <= 0) {
          await sql`INSERT INTO admin_settings (key, value) VALUES (${'carry_negative_' + r.code}, ${String(amt)}) ON CONFLICT (key) DO UPDATE SET value = ${String(amt)}`;
          continue;
        }
        await sql`DELETE FROM admin_settings WHERE key = ${'carry_negative_' + r.code}`;
        positiveRows.push({ code: r.code, name: r.name, legal_name: r.legal_name, bank_account: r.bank_account, amount: amt, floor_amount: floorAmt, bonus_amount: bonusAmt });
      }
      if (!positiveRows.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا توجد عمولات مسجّلة لهذا الشهر' }) };
      const runRows = await sql`INSERT INTO payout_runs (month) VALUES (${monthKey}) RETURNING id`;
      const runId = runRows[0].id;
      for (const r of positiveRows) {
        await sql`INSERT INTO payout_items (run_id, ref_code, name, legal_name, bank_account, amount, floor_amount, bonus_amount) VALUES (${runId}, ${r.code}, ${r.name}, ${r.legal_name||''}, ${r.bank_account||''}, ${r.amount}, ${r.floor_amount}, ${r.bonus_amount})`;
        const ambR = await sql`SELECT student_id FROM ambassador_requests WHERE code = ${r.code} AND status = 'approved' LIMIT 1`;
        if (ambR.length) await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${ambR[0].student_id}, '💸 تم صرف عمولتك', ${'تم صرف عمولتك عن شهر ' + monthKey + ' بمبلوو' + 'ف $' + r.amount.toFixed(2) + ' ✅'})`;
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('manual-payout-run', ${'توليد يدوي لدفعة صرف شهر ' + monthKey + ' — عدد المستحقين: ' + positiveRows.length})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, month: monthKey, count: positiveRows.length }) };
    }

    if (event.httpMethod === 'GET' && action === 'tickets') {
      const tickets = await sql`SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 200`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, tickets }) };
    }

    if (event.httpMethod === 'POST' && action === 'reply-ticket') {
      const { id, reply, status } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT * FROM support_tickets WHERE id = ${id}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const t = rows[0];
      await sql`UPDATE support_tickets SET admin_reply = ${reply||t.admin_reply}, status = ${status||'resolved'}, updated_at = now() WHERE id = ${id}`;
      if (reply && t.email) {
        const bodyHtml = `<div dir="rtl">مرحباً <b>${t.name||''}</b> 👋<br><br>رد فريقنا على طلبك (رقم مرجعي <b style="color:#D4AF37;">${t.ref_number}</b>):<br><br><div style="background:rgba(212,175,55,.08); border:1px solid rgba(212,175,55,.25); border-radius:10px; padding:14px; margin:12px 0;">${reply}</div></div>`;
        await sendMail(t.email, 'رد على طلبك — ' + t.ref_number, 'رد جديد', bodyHtml, 'ar');
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'export-backup') {
      const backup = {
        subscriptions: await sql`SELECT * FROM subscriptions`,
        affiliates: await sql`SELECT * FROM affiliates`,
        commission_log: await sql`SELECT * FROM commission_log`,
        revenue_log: await sql`SELECT * FROM revenue_log`,
        prices: await sql`SELECT * FROM prices`,
        ref_codes: await sql`SELECT * FROM ref_codes`,
        boost_campaigns: await sql`SELECT * FROM boost_campaigns`,
        payout_runs: await sql`SELECT * FROM payout_runs`,
        payout_items: await sql`SELECT * FROM payout_items`,
        admin_settings: await sql`SELECT * FROM admin_settings`,
        _exported_at: new Date().toISOString()
      };
      return { statusCode: 200, headers: { ...headers, 'Content-Disposition': 'attachment; filename="opnlio-backup.json"' }, body: JSON.stringify(backup) };
    }

    if (event.httpMethod === 'GET' && action === 'error-log') {
      const logs = await sql`SELECT * FROM audit_log WHERE action LIKE 'error-%' ORDER BY created_at DESC LIMIT 100`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, logs }) };
    }

    if (event.httpMethod === 'GET' && action === 'campaigns') {
      const rows = await sql`SELECT * FROM boost_campaigns ORDER BY starts_at DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, campaigns: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'create-campaign') {
      const { name, boost_amount, cap_override, target, target_codes, starts_at, ends_at } = JSON.parse(event.body || '{}');
      if (!boost_amount || !starts_at || !ends_at) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الحقول المطلوبة ناقصة' }) };
      await sql`INSERT INTO boost_campaigns (name, boost_amount, cap_override, target, target_codes, starts_at, ends_at)
        VALUES (${name||''}, ${boost_amount}, ${cap_override||null}, ${target||'all'}, ${target === 'specific' ? (target_codes||[]) : null}, ${starts_at}, ${ends_at})`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('create-campaign', ${'حملة تحفيزية جديدة: ' + (name||'') + ' (+' + boost_amount + '$)'})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'delete-campaign') {
      const { id } = JSON.parse(event.body || '{}');
      await sql`DELETE FROM boost_campaigns WHERE id = ${id}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'unmatched-paddle') {
      const rows = await sql`SELECT * FROM paddle_unmatched WHERE resolved = false ORDER BY created_at DESC LIMIT 50`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, unmatched: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'resolve-unmatched') {
      const { id } = JSON.parse(event.body || '{}');
      await sql`UPDATE paddle_unmatched SET resolved = true WHERE id = ${id}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'page-visibility') {
      const rows = await sql`SELECT key, value FROM admin_settings WHERE key LIKE 'page_hidden_%'`;
      const hidden = {}; rows.forEach(r => { hidden[r.key.replace('page_hidden_', '')] = r.value === 'true'; });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, hidden }) };
    }

    if (event.httpMethod === 'POST' && action === 'set-page-visibility') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { page, hidden } = JSON.parse(event.body || '{}');
      if (!page) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الصفحة غير محددة' }) };
      const key = 'page_hidden_' + page;
      if (hidden) {
        await sql`INSERT INTO admin_settings (key, value) VALUES (${key}, 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'`;
      } else {
        await sql`DELETE FROM admin_settings WHERE key = ${key}`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

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

    if (event.httpMethod === 'POST' && action === 'add-affiliate') {
      const { name, legal_name, country, city, email, age, phone, telegram, code, bank_account, password } = JSON.parse(event.body || '{}');
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode || !name) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم والكود مطلوبان' }) };
      const existing = await sql`SELECT code FROM affiliates WHERE code = ${cleanCode}`;
      if (existing.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الكود مستخدم مسبقاً' }) };
      const rows = await sql`INSERT INTO affiliates (name, legal_name, country, city, email, age, phone, telegram, code, bank_account, password, active, approved_at, created_at)
        VALUES (${name}, ${legal_name||''}, ${country||''}, ${city||''}, ${email||''}, ${age||null}, ${phone||''}, ${telegram||''}, ${cleanCode}, ${bank_account||''}, ${hashPassword(password||Math.random().toString(36).slice(-8))}, true, now(), now()) RETURNING code`;
      await sql`INSERT INTO ref_codes (code, owner_name) VALUES (${cleanCode}, ${name}) ON CONFLICT (code) DO NOTHING`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('add-affiliate-manual', ${'إضافة سفير يدوياً: ' + name + ' (' + cleanCode + ')'})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code: rows[0].code }) };
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
      const { customer_name, email, phone, telegram, tradingview, plan, ref_code, status, expires_at } = JSON.parse(event.body || '{}');
      if (!customer_name || !customer_name.trim()) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم مطلوب' }) };
      const durationDays = { trial: 14, renew_1m: 30, renew_3m: 90, renew_6m: 180, renew_1y: 365 };
      const days = durationDays[status];
      const expiresAt = expires_at ? new Date(expires_at).toISOString() : (days ? new Date(Date.now() + days * 86400000).toISOString() : null);
      const code = ref_code ? String(ref_code).trim().toUpperCase() : null;
      await sql`INSERT INTO subscriptions (customer_name, email, ref_code, status, expires_at, phone, telegram, tradingview, plan)
        VALUES (${customer_name.trim()}, ${email||''}, ${code}, ${status || 'pending_payment'}, ${expiresAt}, ${phone||''}, ${telegram||''}, ${tradingview||''}, ${plan||''})`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('add-customer', ${'إضافة عميل يدوياً: ' + customer_name})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'delete-customer') {
      const { id } = JSON.parse(event.body || '{}');
      await sql`DELETE FROM subscriptions WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('delete-customer', ${'حذف عميل #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'customers') {
      const rows = await sql`SELECT id, customer_name, ref_code, status, expires_at, phone, telegram, tradingview, plan, email, customer_id, last_status_source, paddle_transaction_id, paddle_amount, email_verified, updated_at, created_at FROM subscriptions ORDER BY created_at DESC LIMIT 200`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, customers: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'send-activation-email') {
      const { id } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT * FROM subscriptions WHERE id = ${id}`;
      if (rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const row = rows[0];
      if (!row.email) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا يوجد بريد إلكتروني لهذا العميل' }) };
      const lang = row.lang === 'en' ? 'en' : 'ar';
      const T = {
        ar: { subject: 'تم تفعيل اشتراكك على TradingView ✅', hi: 'اشتراكك أصبح فعّالاً الآن',
          body: `مرحباً <b>${row.customer_name}</b> 👋<br><br>تم تفعيل صلاحية اشتراكك بنجاح على <b>TradingView</b> ✅<br><br>
            يمكنك الآن استخدام أدواتنا الأربعة المتكاملة من حسابك <b>${row.tradingview || ''}</b> على TradingView مباشرة.<br><br>
            رقم عميلك: <b>${row.customer_id || '-'}</b>` },
        en: { subject: 'Your TradingView subscription is now active ✅', hi: 'Your subscription is now active',
          body: `Hi <b>${row.customer_name}</b> 👋<br><br>Your access has been successfully activated on <b>TradingView</b> ✅<br><br>
            You can now use our four integrated tools directly from your TradingView account <b>${row.tradingview || ''}</b>.<br><br>
            Your customer ID: <b>${row.customer_id || '-'}</b>` }
      };
      const t = T[lang];
      const res = await sendMail(row.email, t.subject, t.hi, t.body, lang);
      if (!res.ok) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: res.error }) };
      await sql`INSERT INTO audit_log (action, details) VALUES ('send-activation-email', ${'إرسال بريد تفعيل إلى ' + row.customer_name})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'broadcast-email') {
      const { subject, message, audience, codes, translations } = JSON.parse(event.body || '{}');
      if (!subject || !message) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الموضوع والرسالة مطلوبان' }) };
      let rows;
      if (audience === 'affiliates') {
        rows = (codes && codes.length)
          ? await sql`SELECT email, COALESCE(lang,'ar') AS lang FROM affiliates WHERE email IS NOT NULL AND email != '' AND code = ANY(${codes})`
          : await sql`SELECT email, COALESCE(lang,'ar') AS lang FROM affiliates WHERE email IS NOT NULL AND email != ''`;
      } else if (audience === 'academy') {
        rows = await sql`SELECT email, COALESCE(lang,'ar') AS lang FROM academy_students WHERE email IS NOT NULL AND email != ''`;
      } else {
        rows = await sql`SELECT email, lang FROM subscriptions WHERE email IS NOT NULL AND email != '' AND email_verified = true`;
      }
      let sent = 0;
      for (const r of rows) {
        const lc = r.lang || 'ar';
        const tr = (translations && translations[lc]) ? translations[lc] : null;
        const finalSubject = tr && tr.subject ? tr.subject : subject;
        const finalMessage = tr && tr.message ? tr.message : message;
        const res = await sendMail(r.email, finalSubject, finalSubject, String(finalMessage).replace(/\n/g, '<br>'), lc);
        if (res.ok) sent++;
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('broadcast-email', ${'إرسال حملة بريدية (' + (audience === 'affiliates' ? 'سفراء' : audience === 'academy' ? 'أعضاء الأكاديمية' : 'عملاء') + '): ' + subject + ' — إلى ' + sent})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent, total: rows.length }) };
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
      await sql`UPDATE subscriptions SET status = ${status}, expires_at = ${newExpiry}, notified_48h = false, aff_reminder_48h_sent = false, aff_reminder_12h_sent = false, updated_at = now() WHERE id = ${id}`;
      if (status && status.indexOf('renew_') === 0 && row.status !== status) {
        if (row.ref_code && row.self_ref_flagged) {
          await sql`INSERT INTO audit_log (action, details) VALUES ('self-referral-commission-skipped', ${'تم تجديد العميل ' + row.customer_name + ' بكود ' + row.ref_code + ' بلا عمولة — موسوم كإحالة ذاتية'})`;
        } else if (row.ref_code) {
          await awardCommission(sql, { sendMail, refCode: row.ref_code, customerName: row.customer_name, selfRefFlagged: row.self_ref_flagged, planLabel: status, txId: 'manual-' + row.id + '-' + Date.now() });
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
      // تعطيل تلقائي: مضى 14 يوم على التسجيل وما عنده أي تجديد مدفوع (فقط للحسابات المُعتمدة سابقاً)
      await sql`UPDATE affiliates a SET active = false
        WHERE a.active = true AND a.approved_at IS NOT NULL AND a.created_at < now() - interval '14 days'
        AND NOT EXISTS (SELECT 1 FROM commission_log c WHERE c.ref_code = a.code)`;
      const affiliates = await sql`SELECT a.*, COALESCE(SUM(c.amount),0)::numeric AS total_commission, COUNT(c.id)::int AS renewals
        FROM affiliates a LEFT JOIN commission_log c ON c.ref_code = a.code
        GROUP BY a.code ORDER BY (a.approved_at IS NULL) DESC, a.active DESC, total_commission DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, affiliates }) };
    }

    if (event.httpMethod === 'POST' && action === 'approve-affiliate') {
      const { code } = JSON.parse(event.body || '{}');
      const cleanCode = String(code||'').toUpperCase();
      const rows = await sql`SELECT * FROM affiliates WHERE code = ${cleanCode}`;
      if (rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const row = rows[0];
      if (!row.email_verified) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا يمكن تفعيل هذا السفير — بريده الإلكتروني غير مؤكَّد بعد.' }) };
      await sql`UPDATE affiliates SET active = true, approved_at = now() WHERE code = ${cleanCode}`;
      await sql`INSERT INTO ref_codes (code, owner_name) VALUES (${cleanCode}, ${row.name||''}) ON CONFLICT (code) DO NOTHING`;
      if (row.email) {
        const refLink = 'https://opnlio.com/?ref=' + cleanCode;
        const bodyHtml = `<div dir="rtl">مرحباً <b>${row.name}</b> 👋<br><br>تم تفعيل كودك <b style="color:#D4AF37;">${cleanCode}</b> رسمياً كسفير لO P N LIO ⚜<br><br>رقم السفير الخاص بك لدخول لوحة تحكمك: <b style="color:#D4AF37; font-size:18px;">${row.affiliate_id || cleanCode}</b><br><br><b>خطواتك الأولى:</b><br>1️⃣ سجّل الدخول إلى لوحة تحكمك الخاصة عبر الرابط أدناه باستخدام رقم السفير أعلاه وكلمة المرور التي اخترتها، لتتابع أداءك وعمولاتك.<br>2️⃣ شارك <b>رابطك الخاص</b> مع متابعينك وعملائك المحتملين — يُسجَّل كودك تلقائياً عند فتحه، بلا حاجة لكتابة الكود يدوياً: <br><b style="color:#D4AF37; direction:ltr; display:inline-block; margin:6px 0;">${refLink}</b><br>3️⃣ عند اشتراك أي عميل فعلياً عبر رابطك أو كودك، تُحسب عمولتك تلقائياً وتبدأ من 4$ وتتصاعد مع نشاطك (حتى 9$).<br><br>يمكنك الدخول للوحة تحكمك الخاصة عبر: <a href="https://opnlio.com/affiliate-login.html" style="color:#D4AF37;">affiliate-login</a><br><br>فريق الدعم جاهز دائماً لمساعدتك في أي استفسار.</div><hr style="border-color:rgba(255,255,255,.1); margin:18px 0;"><div dir="ltr">Hi <b>${row.name}</b> 👋<br><br>Your code <b style="color:#D4AF37;">${cleanCode}</b> has been officially activated as an O P N LIO Ambassador ⚜<br><br>Your Ambassador ID to log in to your dashboard: <b style="color:#D4AF37; font-size:18px;">${row.affiliate_id || cleanCode}</b><br><br><b>Your first steps:</b><br>1️⃣ Log in to your dashboard below using the Ambassador ID above and the password you chose, to track your performance and commissions.<br>2️⃣ Share <b>your personal link</b> with your audience — your code is captured automatically when it's opened, no manual entry needed: <br><b style="color:#D4AF37; direction:ltr; display:inline-block; margin:6px 0;">${refLink}</b><br>3️⃣ Once a customer subscribes via your link or code, your commission is calculated automatically, starting at $4 and scaling up with your activity (up to $9).<br><br>You can access your dashboard at: <a href="https://opnlio.com/affiliate-login.html" style="color:#D4AF37;">affiliate-login</a><br><br>Our support team is always ready to help with any question.</div>`;
        await sendMail(row.email, 'تم تفعيل كودك كسفير O P N LIO ⚜ Your Ambassador Code is Active', 'تفعيل ناجح ✅ Activated', bodyHtml, 'ar');
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('approve-affiliate', ${'اعتماد سفير: ' + cleanCode})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
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
      await sql`UPDATE admin_settings SET value = ${hashPassword(newPassword)} WHERE key = 'admin_password'`;
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

    if (event.httpMethod === 'GET' && action === 'finance-analytics') {
      const rev = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COALESCE(SUM(amount),0)::numeric AS total FROM revenue_log WHERE created_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const com = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE created_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const plans = await sql`SELECT status, COUNT(*)::int AS c FROM subscriptions WHERE status LIKE 'renew_%' GROUP BY status`;
      const acad = await sql`SELECT to_char(paid_at,'YYYY-MM') AS month, COUNT(*)::int AS c FROM academy_students WHERE paid_at IS NOT NULL AND paid_at > now() - interval '12 months' GROUP BY month ORDER BY month ASC`;
      const payouts = await sql`SELECT r.month, COALESCE(SUM(i.amount),0)::numeric AS total FROM payout_runs r JOIN payout_items i ON i.run_id = r.id GROUP BY r.month ORDER BY r.month ASC`;
      const totRev = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS t FROM revenue_log`;
      const totCom = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS t FROM commission_log`;
      const paidAcad = await sql`SELECT COUNT(*)::int AS c FROM academy_students WHERE paid_at IS NOT NULL`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, revenue: rev, commissions: com, plans, academy: acad, payouts, totals: { revenue: totRev[0].t, commissions: totCom[0].t, academyPaid: paidAcad[0].c } }) };
    }

    if (event.httpMethod === 'GET' && action === 'revenue') {
      const rows = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, SUM(amount)::numeric AS total
        FROM revenue_log WHERE created_at > now() - interval '12 months'
        GROUP BY month ORDER BY month ASC`;
      const totalAll = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM revenue_log`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, monthly: rows, totalAll: totalAll[0].total }) };
    }

    if (event.httpMethod === 'GET' && action === 'academy-students') {
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS phone text`;
      const rows = await sql`SELECT s.id, s.name, s.email, s.phone, s.paid_at, s.lang, s.points, s.current_level, s.rank, s.graduated_at,
        s.discount_code, s.email_verified, s.created_at, s.last_login_at,
        (SELECT COUNT(*)::int FROM academy_progress p WHERE p.student_id = s.id AND p.completed = true) AS levels_done
        FROM academy_students s ORDER BY s.created_at DESC LIMIT 300`;
      const stats = await sql`SELECT COUNT(*)::int AS total,
        COUNT(CASE WHEN graduated_at IS NOT NULL THEN 1 END)::int AS graduates,
        COUNT(CASE WHEN email_verified = true THEN 1 END)::int AS verified,
        COALESCE(AVG(current_level),0)::numeric(10,1) AS avg_level FROM academy_students`;
      const levelDist = await sql`SELECT current_level AS lvl, COUNT(*)::int AS c FROM academy_students GROUP BY current_level ORDER BY current_level`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, students: rows, stats: stats[0], levelDist }) };
    }

    if (event.httpMethod === 'GET' && action === 'academy-student-detail') {
      const id = parseInt((event.queryStringParameters && event.queryStringParameters.id) || '0', 10);
      const rows = await sql`SELECT * FROM academy_students WHERE id = ${id}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const progress = await sql`SELECT level_num, completed, score, completed_at FROM academy_progress WHERE student_id = ${id} ORDER BY level_num`;
      const st = rows[0]; delete st.password_hash; delete st.verify_token;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, student: st, progress }) };
    }

    if (event.httpMethod === 'POST' && action === 'academy-set-paid') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { id, paid } = JSON.parse(event.body || '{}');
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
      if (paid) await sql`UPDATE academy_students SET paid_at = now() WHERE id = ${id}`;
      else await sql`UPDATE academy_students SET paid_at = NULL WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('academy-set-paid', ${(paid ? 'تفعيل يدوي لدفع البرنامج التدريبي' : 'إلغاء تفعيل دفع البرنامج التدريبي') + ' — متدرب #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'academy-verify-student') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { id } = JSON.parse(event.body || '{}');
      await sql`UPDATE academy_students SET email_verified = true, verify_token = NULL WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('academy-verify', ${'تفعيل يدوي لمتدرب #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'academy-update-student') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { id, name, email, current_level, points, rank } = JSON.parse(event.body || '{}');
      await sql`UPDATE academy_students SET name = ${name||''}, email = ${String(email||'').toLowerCase()},
        current_level = ${parseInt(current_level||1,10)}, points = ${parseInt(points||0,10)}, rank = ${rank||'مبتدئ'} WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('academy-update', ${'تعديل بيانات متدرب #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'academy-delete-student') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { id } = JSON.parse(event.body || '{}');
      await sql`DELETE FROM academy_progress WHERE student_id = ${id}`;
      await sql`DELETE FROM academy_students WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('academy-delete', ${'حذف متدرب #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'academy-reset-progress') {
      if (!(await checkTokenAsync(event, sql))) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { id } = JSON.parse(event.body || '{}');
      await sql`DELETE FROM academy_progress WHERE student_id = ${id}`;
      await sql`INSERT INTO academy_progress (student_id, level_num) VALUES (${id}, 1)`;
      await sql`UPDATE academy_students SET current_level = 1, points = 0, rank = 'مبتدئ', graduated_at = NULL, discount_code = NULL WHERE id = ${id}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('academy-reset', ${'تصفير تقدّم متدرب #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'export-academy') {
      const rows = await sql`SELECT name, email, lang, points, current_level, rank, graduated_at, discount_code, created_at FROM academy_students ORDER BY created_at DESC`;
      let csv = 'الاسم,البريد,اللغة,النقاط,المستوى,الرتبة,تاريخ التخرج,كود الخصم,تاريخ التسجيل\n';
      rows.forEach(r => { csv += [r.name, r.email, r.lang, r.points, r.current_level, r.rank, r.graduated_at||'', r.discount_code||'', r.created_at].map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',') + '\n'; });
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' }, body: '\uFEFF' + csv };
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

    if (event.httpMethod === 'GET' && action === 'ambassador-requests') {
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS signature text`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS agreement_at timestamptz`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_name text`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_iban text`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_bank text`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_swift text`;
      await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_addr text`;
      const rows = await sql`SELECT r.id, r.student_id, r.status, r.created_at, r.signature, r.agreement_at, r.bank_name, r.bank_iban, r.bank_bank, r.bank_swift, r.bank_addr, s.name, s.email, s.lang FROM ambassador_requests r JOIN academy_students s ON s.id = r.student_id WHERE r.status = 'pending' ORDER BY r.created_at ASC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, requests: rows }) };
    }

    if (event.httpMethod === 'POST' && action === 'approve-ambassador-request') {
      const { id } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT r.id, r.student_id, r.bank_name, r.bank_iban, r.bank_bank, r.bank_swift, r.bank_addr, s.name, s.email, s.lang FROM ambassador_requests r JOIN academy_students s ON s.id = r.student_id WHERE r.id = ${id}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الطلب غير موجود' }) };
      const r = rows[0];
      let code = String(r.name || 'LION').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').slice(0, 8).toUpperCase() + Math.floor(100 + Math.random() * 900);
      code = code.replace(/[\u0600-\u06FF]/g, '') || ('AMB' + Math.floor(1000 + Math.random() * 9000));
      const dup = await sql`SELECT code FROM ref_codes WHERE code = ${code}`;
      if (dup.length) code = code + Math.floor(Math.random() * 9);
      await sql`INSERT INTO affiliates (name, email, code, active, approved_at, created_at) VALUES (${r.name}, ${r.email}, ${code}, true, now(), now()) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO ref_codes (code, owner_name) VALUES (${code}, ${r.name}) ON CONFLICT (code) DO NOTHING`;
      await sql`UPDATE ambassador_requests SET status = 'approved', code = ${code}, decided_at = now() WHERE id = ${id}`;
      const refLink = 'https://opnlio.com/?ref=' + code;
      await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${r.student_id}, '🎉 تمت الموافقة على طلبك كسفير', ${'مبروك! كودك الخاص: <b>' + code + '</b><br>رابطك الجاهز: <b dir="ltr">' + refLink + '</b><br>شاركه وابدأ كسب العمولات فوراً.'})`;
      if (r.email) {
        const _agr = getAgreement(r.lang || 'ar');
        await sendMail(r.email, '🎉 تمت الموافقة على طلبك كسفير O P N LIO — نسخة اتفاقيتك بالداخل', 'مبروك!', `<div dir="rtl">مرحباً <b>${r.name}</b> 👋<br><br>تمت الموافقة على طلبك رسمياً كسفير O P N LIO ⚜<br><br>كودك الخاص: <b style="color:#D4AF37; font-size:18px;">${code}</b><br><br>رابطك الجاهز للمشاركة (يُسجَّل كودك تلقائياً عند فتحه):<br><b style="color:#D4AF37; direction:ltr; display:inline-block;">${refLink}</b><br><br>وأي عميل يشترك عبره تُحسب عمولتك تلقائياً عن كل تجديد فعلي.<br><br>يمكنك تنزيل نسخة PDF من اتفاقيتك في أي وقت: <a href="https://opnlio.com/ambassador-agreement.html" style="color:#D4AF37;">صفحة الاتفاقية — زر تنزيل PDF</a><br><br><hr style="border:none; border-top:1px solid #ddd; margin:18px 0;"><b style="color:#8a6d1f;">🏦 بيانات حساب استلام العمولات المسجّلة باتفاقيتك:</b><br><div style="font-size:12.5px; line-height:1.9; background:#faf7ec; border:1px solid #e6d9a8; border-radius:8px; padding:12px; margin:8px 0 18px;">صاحب الحساب: <b>${r.bank_name || '—'}</b><br>رقم الحساب / IBAN: <b style="direction:ltr; display:inline-block;">${r.bank_iban || '—'}</b><br>البنك والدولة: <b>${r.bank_bank || '—'}</b><br>SWIFT / BIC: <b style="direction:ltr; display:inline-block;">${r.bank_swift || '—'}</b><br>العنوان: <b>${r.bank_addr || '—'}</b><br><span style="color:#a33;">أقررتَ بصحة هذه البيانات وتتحمل وحدك مسؤولية أي خطأ فيها. لتعديلها لاحقاً راسل الإدارة.</span></div><b style="color:#8a6d1f;">📄 نسختك من الاتفاقية الموقّعة إلكترونياً بتاريخ ${new Date().toISOString().slice(0,10)}:</b><br><br><div style="font-size:12px; line-height:1.9;">${_agr.html}</div></div>`, 'ar').catch(()=>{});
      }
      try { await sql`UPDATE affiliates SET bank_name = ${r.bank_name || null}, bank_iban = ${r.bank_iban || null}, bank_swift = ${r.bank_swift || null}, bank_address = ${r.bank_addr || null} WHERE code = ${code}`; } catch(e){}
      await sql`INSERT INTO audit_log (action, details) VALUES ('approve-ambassador-request', ${'موافقة طلب سفير #' + id + ' كود ' + code})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code }) };
    }

    if (event.httpMethod === 'POST' && action === 'reject-ambassador-request') {
      const { id, reason } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT r.id, r.student_id, s.name, s.email, s.lang FROM ambassador_requests r JOIN academy_students s ON s.id = r.student_id WHERE r.id = ${id}`;
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الطلب غير موجود' }) };
      const r = rows[0];
      await sql`UPDATE ambassador_requests SET status = 'rejected', decided_at = now() WHERE id = ${id}`;
      await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${r.student_id}, 'نعتذر — تم رفض طلب السفارة', ${reason ? String(reason).slice(0,400) : 'نعتذر، لم تتم الموافقة على طلبك للانضمام كسفير في هذه المرحلة. يمكنك التواصل مع الدعم لمزيد من التفاصيل.'})`;
      if (r.email) {
        await sendMail(r.email, 'بخصوص طلبك كسفير O P N LIO', 'تحديث بخصوص طلبك', `<div dir="rtl">مرحباً <b>${r.name}</b>،<br><br>نعتذر، لم تتم الموافقة على طلبك للانضمام كسفير O P N LIO في هذه المرحلة.${reason ? '<br><br>' + String(reason).slice(0,400) : ''}<br><br>يمكنك التواصل مع فريق الدعم لمزيد من التفاصيل.</div>`, 'ar').catch(()=>{});
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('reject-ambassador-request', ${'رفض طلب سفير #' + id})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'broadcast-notification') {
      const { title, body: msgBody, sendEmail } = JSON.parse(event.body || '{}');
      if (!title || !msgBody) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'العنوان والنص مطلوبان' }) };
      await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (NULL, ${title}, ${msgBody})`;
      let emailCount = 0;
      if (sendEmail) {
        const students = await sql`SELECT email, name FROM academy_students WHERE email IS NOT NULL`;
        for (const s of students) { await sendMail(s.email, title, title, `<div dir="rtl">مرحباً <b>${s.name || ''}</b>،<br><br>${msgBody}</div>`, 'ar').catch(()=>{}); emailCount++; }
      }
      await sql`INSERT INTO audit_log (action, details) VALUES ('broadcast-notification', ${'إشعار عام: ' + title + (sendEmail ? ' + بريد لـ' + emailCount : '')})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, emailCount }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    try { const sql2 = getSql(); await sql2`INSERT INTO audit_log (action, details) VALUES ('error-admin-data', ${String(e).slice(0,500)})`; } catch(e2){}
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
