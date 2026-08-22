// يستقبل إشعارات Paddle Webhooks ويحدّث حالة الاشتراك تلقائياً بقاعدة البيانات
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');
const { awardCommission } = require('./_commission');

const ADMIN_ALERT_EMAIL = process.env.ADMIN_EMAIL || process.env.SMTP_USER || '';

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

    // رسوم الأكاديمية ($1) — تُعالج وتُنهى هنا حتى لا تختلط بمطابقة الاشتراكات
    const acadCustom = data.custom_data || {};
    const ACADEMY_PRICE_ID = process.env.PADDLE_ACADEMY_PRICE_ID || 'pri_01kzsw7et11f5r4nf08ea7yz5p';
    const _items = (data.items || data.line_items || []);
    const _hasAcadPrice = _items.some(function (it) {
      const p = it && (it.price || it.price_id || (it.product && it.product.id));
      const pid = typeof p === 'string' ? p : (p && p.id);
      return pid === ACADEMY_PRICE_ID;
    });
    if (acadCustom.product === 'academy' || _hasAcadPrice) {
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paddle_transaction_id text`;
      const acadEmail = String(acadCustom.email || (data.customer && data.customer.email) || '').trim().toLowerCase();
      if (eventType === 'transaction.completed' && acadEmail) {
        const _alt = String((data.customer && data.customer.email) || (data.billing_details && data.billing_details.email) || '').trim().toLowerCase();
        let upd = await sql`UPDATE academy_students SET paid_at = now(), paddle_transaction_id = ${data.id || null} WHERE lower(email) = ${acadEmail} RETURNING id`;
        if (!upd.length && _alt && _alt !== acadEmail) {
          upd = await sql`UPDATE academy_students SET paid_at = now(), paddle_transaction_id = ${data.id || null} WHERE lower(email) = ${_alt} RETURNING id`;
        }
        if (upd.length) {
          await sql`INSERT INTO audit_log (action, details) VALUES ('academy-fee-paid', ${'دفع رسم تسجيل الأكاديمية — الطالب #' + upd[0].id + ' (' + acadEmail + ')'})`;
        } else {
          await sql`INSERT INTO paddle_unmatched (event_type, customer_email, customer_name, raw_payload) VALUES (${eventType || ''}, ${acadEmail || null}, ${null}, ${JSON.stringify(payload)})`;
          if (ADMIN_ALERT_EMAIL) await sendMail(ADMIN_ALERT_EMAIL, '⚠️ دفع أكاديمية بلا مطابقة', 'تنبيه', `<div dir="rtl">دفعة رسم أكاديمية لم تُطابق أي عضو.<br>البريد: <b>${acadEmail || '—'}</b><br>بريد بديل: <b>${_alt || '—'}</b><br>رقم العملية: ${data.id || '—'}<br><br>فعّلها يدوياً من لوحة الإدارة.</div>`, 'ar').catch(function(){});
        }
      } else if ((eventType === 'transaction.refunded' || eventType === 'adjustment.created') && acadEmail) {
        await sql`UPDATE academy_students SET paid_at = NULL WHERE lower(email) = ${acadEmail}`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('academy-fee-refunded', ${'استرجاع رسم تسجيل الأكاديمية — ' + acadEmail})`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, academy: true }) };
    }

    // 🎓 أداة التحضير التلقائي — شراء سنوي يولّد رمز ترخيص ويرسله
    const SCRIPT_PRICE_ID = process.env.PADDLE_SCRIPT_PRICE_ID || 'pri_01m0ktck9j286xssq9s4dzjfca';
    const _hasScriptPrice = SCRIPT_PRICE_ID && _items.some(function (it) {
      const p = it && (it.price || it.price_id || (it.product && it.product.id));
      const pid = typeof p === 'string' ? p : (p && p.id);
      return pid === SCRIPT_PRICE_ID;
    });
    if (acadCustom.product === 'script' || _hasScriptPrice) {
      const sEmail = String(acadCustom.email || acadCustom.customerEmail || (data.customer && data.customer.email) || '').trim().toLowerCase();
      const sUser = String(acadCustom.madrasatiUser || acadCustom.madrasati_user || '').trim().toLowerCase();
      const sName = String(acadCustom.name || '').trim();
      if (eventType === 'transaction.completed' && sEmail) {
        await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS madrasati_user TEXT`;
        await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS madrasati_email TEXT`;
        // تجديد لمشترك قائم؟ نمدّد سنة بدل إصدار رمز جديد
        const prev = await sql`SELECT code, valid_until FROM script_licenses WHERE lower(email) = ${sEmail} ORDER BY valid_until DESC LIMIT 1`;
        if (prev.length) {
          const base = new Date(prev[0].valid_until) > new Date() ? new Date(prev[0].valid_until) : new Date();
          const until = new Date(base.getTime() + 365 * 86400000).toISOString().slice(0, 10);
          await sql`UPDATE script_licenses SET valid_until = ${until}, active = true, reminded_at = NULL WHERE code = ${prev[0].code}`;
          await sql`INSERT INTO audit_log (action, details) VALUES ('script-renewed', ${'تجديد ترخيص ' + prev[0].code + ' حتى ' + until})`;
          await sendMail(sEmail, 'تم تجديد اشتراكك — OPN LIO', 'تجديد حتى ' + until,
            '<div dir="rtl" style="font-family:Tahoma,Arial;background:#070d18;color:#e9edf5;padding:24px;border-radius:14px">' +
            '<h2 style="color:#D4AF37;margin:0 0 12px">تم تجديد اشتراكك ✅</h2>' +
            '<p>رمزك كما هو: <b style="direction:ltr;color:#D4AF37">' + prev[0].code + '</b></p>' +
            '<p>صالح حتى: <b>' + until + '</b></p></div>', 'ar').catch(function () {});
        } else {
          const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          const seg = function () { return Array.from({ length: 4 }, function () { return AL[Math.floor(Math.random() * AL.length)]; }).join(''); };
          let code = '';
          for (let i = 0; i < 6; i++) {
            code = 'OPN-' + seg() + '-' + seg();
            const dup = await sql`SELECT 1 FROM script_licenses WHERE code = ${code}`;
            if (!dup.length) break;
          }
          const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
          await sql`INSERT INTO script_licenses (code, email, name, valid_until, madrasati_user) VALUES (${code}, ${sEmail}, ${sName}, ${until}, ${sUser || null})`;
          await sql`INSERT INTO audit_log (action, details) VALUES ('script-purchased', ${'شراء ترخيص ' + code + ' لـ' + sEmail + ' حتى ' + until})`;
          await sendMail(sEmail, 'رمز تفعيل أداة التحضير — OPN LIO', 'رمز التفعيل: ' + code,
            '<div dir="rtl" style="font-family:Tahoma,Arial;background:#070d18;color:#e9edf5;padding:24px;border-radius:14px">' +
            '<h2 style="color:#D4AF37;margin:0 0 12px">رمز تفعيل أداة التحضير</h2>' +
            '<p>شكراً لاشتراكك' + (sName ? ' يا ' + sName : '') + '،</p>' +
            '<div style="background:#0f1830;border:1px solid rgba(212,175,55,.5);border-radius:10px;padding:14px;text-align:center;font-size:22px;font-weight:900;letter-spacing:2px;color:#D4AF37;direction:ltr">' + code + '</div>' +
            '<p style="margin-top:14px">صالح حتى: <b>' + until + '</b></p>' +
            (sUser ? '<p style="background:rgba(255,140,0,.12);border:1px solid rgba(255,140,0,.35);border-radius:8px;padding:10px;color:#ffc07a;font-size:13px">⚠️ يعمل <b>فقط</b> مع حساب مدرستي: <b style="direction:ltr">' + sUser + '</b></p>' : '') +
            '<p style="background:rgba(212,175,55,.08);border-radius:8px;padding:10px;font-size:12.5px">💾 احتفظ بالرمز — تحتاجه عند تغيير الجهاز أو مسح بيانات المتصفح.</p>' +
            '<p style="margin-top:16px"><a href="https://opnlio.com/teacher-script.html" style="background:#D4AF37;color:#070d18;padding:12px 24px;border-radius:10px;font-weight:900;text-decoration:none">تحميل الأداة وخطوات التثبيت</a></p></div>', 'ar').catch(function () {});
        }
      } else if ((eventType === 'transaction.refunded' || eventType === 'adjustment.created') && sEmail) {
        await sql`UPDATE script_licenses SET active = false WHERE lower(email) = ${sEmail}`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('script-refunded', ${'استرجاع ترخيص أداة — ' + sEmail})`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, script: true }) };
    }

    // ⏱ ساعة الجلسة الذكية — شراء لمرة واحدة يفتح المؤشر ومسار الأكاديمية
    const CLOCK_PRICE_ID = process.env.PADDLE_CLOCK_PRICE_ID || 'pri_01m04rf4x0d06y0aeb4m74230v';
    const _hasClockPrice = _items.some(function (it) {
      const p = it && (it.price || it.price_id || (it.product && it.product.id));
      const pid = typeof p === 'string' ? p : (p && p.id);
      return pid === CLOCK_PRICE_ID;
    });
    if (acadCustom.product === 'clock' || _hasClockPrice) {
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS clock_paid_at timestamptz`;
      const clockEmail = String(acadCustom.email || acadCustom.customerEmail || (data.customer && data.customer.email) || '').trim().toLowerCase();
      if (eventType === 'transaction.completed' && clockEmail) {
        const upd = await sql`UPDATE academy_students SET clock_paid_at = now() WHERE lower(email) = ${clockEmail} RETURNING id`;
        if (upd.length) {
          await sql`INSERT INTO audit_log (action, details) VALUES ('clock-paid', ${'شراء ساعة الجلسة — الطالب #' + upd[0].id + ' (' + clockEmail + ')'})`;
          // 💰 عمولة السفير عن بيعة الساعة: $4 ثابتة (kind = clock)
          try {
            const subMatch = await sql`SELECT ref_code, customer_name, self_ref_flagged FROM subscriptions WHERE lower(email) = ${clockEmail} AND ref_code IS NOT NULL AND ref_code <> '' ORDER BY created_at DESC LIMIT 1`;
            if (subMatch.length && subMatch[0].ref_code) {
              if (subMatch[0].self_ref_flagged) {
                await sql`INSERT INTO audit_log (action, details) VALUES ('self-referral-commission-skipped', ${'بيعة ساعة بكود ' + subMatch[0].ref_code + ' بلا عمولة — إحالة ذاتية'})`;
              } else {
                const txClockId = data.id || null;
                const dupe = txClockId ? await sql`SELECT 1 FROM commission_log WHERE paddle_transaction_id = ${txClockId} LIMIT 1` : [];
                if (!dupe.length) {
                  await sql`INSERT INTO commission_log (ref_code, customer_name, plan, amount, floor_amount, bonus_amount, paddle_transaction_id, kind)
                    VALUES (${subMatch[0].ref_code}, ${subMatch[0].customer_name || clockEmail}, 'clock_99', 4, 4, 0, ${txClockId}, 'clock')`;
                  await sql`INSERT INTO audit_log (action, details) VALUES ('clock-commission', ${'عمولة $4 للسفير ' + subMatch[0].ref_code + ' عن بيعة ساعة الجلسة (' + clockEmail + ')'})`;
                }
              }
            }
          } catch (e) {}
        } else {
          await sql`INSERT INTO paddle_unmatched (event_type, customer_email, customer_name, raw_payload) VALUES (${eventType || ''}, ${clockEmail || null}, ${acadCustom.customerName || null}, ${JSON.stringify(payload)})`;
        }
      } else if ((eventType === 'transaction.refunded' || eventType === 'adjustment.created') && clockEmail) {
        await sql`UPDATE academy_students SET clock_paid_at = NULL WHERE lower(email) = ${clockEmail}`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('clock-refunded', ${'استرجاع ساعة الجلسة — ' + clockEmail})`;
        // عكس عمولة الساعة إن وُجدت
        try {
          const cSub = await sql`SELECT ref_code, customer_name FROM subscriptions WHERE lower(email) = ${clockEmail} AND ref_code IS NOT NULL AND ref_code <> '' ORDER BY created_at DESC LIMIT 1`;
          if (cSub.length && cSub[0].ref_code) {
            const last = await sql`SELECT id, amount FROM commission_log WHERE ref_code = ${cSub[0].ref_code} AND kind = 'clock' AND amount > 0 ORDER BY created_at DESC LIMIT 1`;
            if (last.length) {
              await sql`INSERT INTO commission_log (ref_code, customer_name, plan, amount, floor_amount, bonus_amount, kind)
                VALUES (${cSub[0].ref_code}, ${cSub[0].customer_name || clockEmail}, 'استرجاع ساعة', ${-last[0].amount}, ${-last[0].amount}, 0, 'clock')`;
              await sql`INSERT INTO audit_log (action, details) VALUES ('clock-commission-clawback', ${'عكس عمولة $' + last[0].amount + ' للسفير ' + cSub[0].ref_code + ' — استرجاع ساعة الجلسة'})`;
            }
          }
        } catch (e) {}
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, clock: true }) };
    }

    // حماية خصم الخريجين: عملية بخصم 60% من بريد غير خريج → تنبيه إداري + تسجيل
    const GRAD_DSC = process.env.PADDLE_GRADUATE_DISCOUNT_ID || 'dsc_01kzqv94x5d3t04dt15g43pths';
    const txDiscount = data.discount_id || (data.details && data.details.discount && data.details.discount.id) || null;
    if (eventType === 'transaction.completed' && txDiscount === GRAD_DSC) {
      const payerEmail = String(acadCustom.customerEmail || acadCustom.email || (data.customer && data.customer.email) || '').trim().toLowerCase();
      let isGrad = false;
      if (payerEmail) {
        const g = await sql`SELECT id FROM academy_students WHERE email = ${payerEmail} AND graduated_at IS NOT NULL LIMIT 1`;
        isGrad = g.length > 0;
      }
      if (!isGrad) {
        await sql`INSERT INTO paddle_unmatched (event_type, customer_email, customer_name, raw_payload) VALUES ('grad-discount-abuse', ${payerEmail || null}, ${acadCustom.customerName || null}, ${JSON.stringify(payload)})`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('grad-discount-abuse', ${'⚠️ استخدام خصم الخريجين من بريد غير خريج: ' + (payerEmail || 'مجهول')})`;
        if (ADMIN_ALERT_EMAIL) {
          try {
            await sendMail(ADMIN_ALERT_EMAIL, '⚠️ استخدام مشبوه لخصم الخريجين — O P N LIO', 'تنبيه', '<div dir="rtl">عملية دفع استخدمت خصم الخريجين 60% من بريد <b>' + (payerEmail || 'مجهول') + '</b> وهو ليس خريجاً مسجلاً في الأكاديمية.<br><br>راجع Paddle لإلغاء العملية واسترجاع المبلغ إن لزم — العملية مسجّلة في لوحة التحكم → بانر العمليات غير المطابقة.</div>', 'ar');
          } catch (mailErr2) {}
        }
      }
    }

    if (eventType === 'transaction.refunded' || eventType === 'adjustment.created' || eventType === 'transaction.payment_failed') {
      const custData = data.custom_data || (data.transaction && data.transaction.custom_data) || {};
      const refundCustomerName = custData.customerName || null;
      const refundCustomerEmail = custData.customerEmail || (data.customer && data.customer.email) || (data.transaction && data.transaction.customer && data.transaction.customer.email) || null;
      let refundMatch = null;
      if (refundCustomerEmail) {
        const rows = await sql`SELECT id, ref_code, customer_name FROM subscriptions WHERE lower(email) = ${String(refundCustomerEmail).toLowerCase()} ORDER BY created_at DESC LIMIT 1`;
        if (rows.length) refundMatch = rows[0];
      }
      if (!refundMatch && refundCustomerName) {
        const rows = await sql`SELECT id, ref_code, customer_name FROM subscriptions WHERE customer_name = ${refundCustomerName} ORDER BY created_at DESC LIMIT 1`;
        if (rows.length) refundMatch = rows[0];
      }
      if (refundMatch && refundMatch.ref_code) {
        const lastCommission = await sql`SELECT id, amount, floor_amount, bonus_amount FROM commission_log WHERE ref_code = ${refundMatch.ref_code} AND customer_name = ${refundMatch.customer_name} ORDER BY created_at DESC LIMIT 1`;
        if (lastCommission.length) {
          const c = lastCommission[0];
          await sql`INSERT INTO commission_log (ref_code, customer_name, plan, amount, floor_amount, bonus_amount) VALUES (${refundMatch.ref_code}, ${refundMatch.customer_name}, ${'استرجاع Paddle'}, ${-c.amount}, ${-c.floor_amount}, ${-c.bonus_amount})`;
          await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-refund-clawback', ${'تم عكس عمولة $' + c.amount + ' للسفير ' + refundMatch.ref_code + ' بسبب استرجاع Paddle (' + eventType + ')'})`;
        }
      } else {
        await sql`INSERT INTO paddle_unmatched (event_type, customer_email, customer_name, raw_payload) VALUES (${eventType||''}, ${null}, ${refundCustomerName||null}, ${JSON.stringify(payload)})`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refundHandled: true }) };
    }

    // نحاول مطابقة العميل عبر البريد أو الاسم المخزن في custom_data إن وُجد
    const customData = data.custom_data || {};
    const customerEmail = customData.customerEmail || (data.customer && data.customer.email) || (data.customer_email) || null;
    const customerName = customData.customerName || null;

    let matchRow = null;
    if (customerEmail) {
      const rows = await sql`SELECT id, ref_code, customer_name, status, self_ref_flagged FROM subscriptions WHERE lower(email) = ${String(customerEmail).toLowerCase()} ORDER BY created_at DESC LIMIT 1`;
      if (rows.length) matchRow = rows[0];
    }
    if (!matchRow && customerName) {
      const rows = await sql`SELECT id, ref_code, customer_name, status, self_ref_flagged FROM subscriptions WHERE customer_name = ${customerName} ORDER BY created_at DESC LIMIT 1`;
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
        const txId = data.id || (data.transaction_id) || null;
        const amountRaw = (data.details && data.details.totals && data.details.totals.total) || (data.items && data.items[0] && data.items[0].price && data.items[0].price.unit_price && data.items[0].price.unit_price.amount) || null;
        const amount = amountRaw ? (parseFloat(amountRaw) / 100) : null;
        await sql`UPDATE subscriptions SET status = ${newStatus}, expires_at = ${expiresAt}, notified_48h = false, aff_reminder_48h_sent = false, aff_reminder_12h_sent = false, paddle_transaction_id = ${txId}, paddle_amount = ${amount}, last_status_source = 'paddle', updated_at = now() WHERE id = ${matchRow.id}`;
        await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-webhook', ${'Paddle event ' + eventType + ' -> ' + newStatus + ' for customer #' + matchRow.id})`;
        if (newStatus.indexOf('renew_') === 0 && matchRow.ref_code && txId) {
          await awardCommission(sql, { sendMail, refCode: matchRow.ref_code, customerName: matchRow.customer_name, selfRefFlagged: matchRow.self_ref_flagged, planLabel: newStatus, txId: txId }).catch(function(){});
        }
      }
    } else {
      await sql`INSERT INTO audit_log (action, details) VALUES ('paddle-webhook-unmatched', ${'Event ' + eventType + ' received, no matching customer found'})`;
      await sql`INSERT INTO paddle_unmatched (event_type, customer_email, customer_name, raw_payload) VALUES (${eventType||''}, ${customerEmail||null}, ${customerName||null}, ${JSON.stringify(payload)})`;
      if (ADMIN_ALERT_EMAIL) {
        try {
          await sendMail(ADMIN_ALERT_EMAIL, '⚠️ عملية دفع Paddle غير مطابقة — O P N LIO', 'تنبيه', '<div dir="rtl">وصلت عملية دفع من Paddle (نوع: <b>' + (eventType||'-') + '</b>) ولم يتم مطابقتها مع أي عميل مسجّل.<br><br>البريد: ' + (customerEmail||'-') + '<br>الاسم: ' + (customerName||'-') + '<br><br>راجع لوحة التحكم → العملاء → بانر التنبيه لحل الحالة.</div>', 'ar');
        } catch (mailErr) {}
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
