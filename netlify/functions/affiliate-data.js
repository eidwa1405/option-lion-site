// بيانات لوحة تحكم السفير (قراءة فقط) — يتطلب توكن جلسة صادر من affiliate-login
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

async function checkAffiliateToken(event, sql) {
  const token = event.headers['x-affiliate-token'] || event.headers['X-Affiliate-Token'];
  const code = event.headers['x-affiliate-code'] || event.headers['X-Affiliate-Code'];
  if (!token || !code) return null;
  const cleanCode = String(code).trim().toUpperCase();
  const rows = await sql`SELECT * FROM affiliates WHERE code = ${cleanCode}`;
  if (rows.length === 0) return null;
  const a = rows[0];
  if (!a.approved_at || !a.password) return null;
  const secret = process.env.AFFILIATE_SESSION_SECRET || a.password;
  const expected = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + cleanCode).digest('hex');
  if (token !== expected) return null;
  return a;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const affiliate = await checkAffiliateToken(event, sql);
    if (!affiliate) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح — سجّل الدخول مرة أخرى' }) };

    const action = event.queryStringParameters && event.queryStringParameters.action;

    if (event.httpMethod === 'GET' && action === 'profile') {
      const customers = await sql`SELECT s.id, s.customer_name, s.status, s.plan, s.expires_at, s.created_at, s.aff_reminder_48h_sent, s.aff_reminder_12h_sent,
          COALESCE((SELECT SUM(c.amount) FROM commission_log c WHERE c.ref_code = ${affiliate.code} AND c.customer_name = s.customer_name), 0)::numeric AS customer_commission,
          COALESCE((SELECT COUNT(*) FROM commission_log c WHERE c.ref_code = ${affiliate.code} AND c.customer_name = s.customer_name), 0)::int AS customer_renewals
        FROM subscriptions s WHERE s.ref_code = ${affiliate.code} ORDER BY s.created_at DESC`;
      const totalCommission = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE ref_code = ${affiliate.code}`;
      const monthly = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, SUM(amount)::numeric AS total
        FROM commission_log WHERE ref_code = ${affiliate.code} AND created_at > now() - interval '6 months'
        GROUP BY month ORDER BY month ASC`;
      const now = Date.now();
      const customersOut = customers.map(function(c) {
        let hoursLeft = null;
        if (c.expires_at) hoursLeft = (new Date(c.expires_at).getTime() - now) / 3600000;
        let reminderEligible = false;
        if (c.status !== 'canceled' && hoursLeft !== null) {
          if (hoursLeft <= 48 && hoursLeft > 12 && !c.aff_reminder_48h_sent) reminderEligible = true;
          else if (hoursLeft <= 12 && hoursLeft > 0 && !c.aff_reminder_12h_sent) reminderEligible = true;
        }
        return {
          id: c.id, customer_name: c.customer_name, status: c.status, plan: c.plan, expires_at: c.expires_at,
          customer_commission: c.customer_commission, customer_renewals: c.customer_renewals,
          hoursLeft: hoursLeft, reminderEligible: reminderEligible
        };
      });
      const safeAffiliate = {
        name: affiliate.name, legal_name: affiliate.legal_name, country: affiliate.country, city: affiliate.city,
        email: affiliate.email, phone: affiliate.phone, telegram: affiliate.telegram, code: affiliate.code,
        bank_account: affiliate.bank_account, agreement_accepted_at: affiliate.agreement_accepted_at, signature_data: affiliate.signature_data,
        login_username: affiliate.login_username || affiliate.code, active: affiliate.active
      };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, affiliate: safeAffiliate, customers: customersOut, totalCommission: totalCommission[0].total, customerCount: customers.length, monthly }) };
    }

    if (event.httpMethod === 'POST' && action === 'send-customer-reminder') {
      const { id } = JSON.parse(event.body || '{}');
      const rows = await sql`SELECT * FROM subscriptions WHERE id = ${id} AND ref_code = ${affiliate.code}`;
      if (rows.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'العميل غير موجود ضمن قائمتك' }) };
      const c = rows[0];
      if (!c.email || !c.expires_at || c.status === 'canceled') return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا يمكن إرسال تذكير لهذا العميل' }) };
      const hoursLeft = (new Date(c.expires_at).getTime() - Date.now()) / 3600000;
      let stage = null;
      if (hoursLeft <= 48 && hoursLeft > 12 && !c.aff_reminder_48h_sent) stage = '48h';
      else if (hoursLeft <= 12 && hoursLeft > 0 && !c.aff_reminder_12h_sent) stage = '12h';
      if (!stage) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'هذا العميل غير مؤهل لتذكير حالياً' }) };

      const hoursRounded = Math.max(1, Math.round(hoursLeft));
      const lang = c.lang === 'en' ? 'en' : 'ar';
      const T = {
        ar: { subject: 'تذكير: اشتراكك في أسد الأوبشن ينتهي قريباً ⚜', hi: 'لا تفوّت استمرارية أدواتك',
          body: `مرحباً <b>${c.customer_name}</b> 👋<br><br>باقي على انتهاء اشتراكك في أسد الأوبشن حوالي <b style="color:#ff9b9b;">${hoursRounded} ساعة</b> فقط.<br><br>
            لا تدع أدواتك المتكاملة (منظومة أسد الأوبشن، امبراطورية الأثرياء، Smart Pivot، King's Call) تتوقف عن خدمتك — جدّد اشتراكك الآن واستمر بالاستفادة من التحليل اللحظي والتنبيهات الذكية.<br><br>
            <a href="https://opon.netlify.app/signup.html" style="display:inline-block;background:linear-gradient(120deg,#D4AF37,#f0cf6c);color:#070d18;font-weight:900;padding:12px 26px;border-radius:10px;text-decoration:none;">تجديد الاشتراك الآن</a>` },
        en: { subject: 'Reminder: Your Option Lion subscription is expiring soon ⚜', hi: "Don't lose access to your tools",
          body: `Hi <b>${c.customer_name}</b> 👋<br><br>Your Option Lion subscription expires in about <b style="color:#ff9b9b;">${hoursRounded} hours</b>.<br><br>
            Don't let your integrated tools (Option Lion System, Empire of the Wealthy, Smart Pivot, King's Call) stop serving you — renew now and keep benefiting from real-time analysis and smart alerts.<br><br>
            <a href="https://opon.netlify.app/en-signup.html" style="display:inline-block;background:linear-gradient(120deg,#D4AF37,#f0cf6c);color:#070d18;font-weight:900;padding:12px 26px;border-radius:10px;text-decoration:none;">Renew Now</a>` }
      };
      const t = T[lang];
      const res = await sendMail(c.email, t.subject, t.hi, t.body, lang);
      if (!res.ok) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: res.error }) };
      if (stage === '48h') await sql`UPDATE subscriptions SET aff_reminder_48h_sent = true WHERE id = ${id}`;
      else await sql`UPDATE subscriptions SET aff_reminder_12h_sent = true WHERE id = ${id}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'request-activation') {
      const lastReq = await sql`SELECT value FROM admin_settings WHERE key = ${'activation_req_' + affiliate.code}`;
      if (lastReq.length && (Date.now() - new Date(lastReq[0].value).getTime()) < 24 * 3600000) {
        return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'تم إرسال طلب مؤخراً، يرجى الانتظار 24 ساعة قبل إرسال طلب آخر.' }) };
      }
      await sql`INSERT INTO admin_settings (key, value) VALUES (${'activation_req_' + affiliate.code}, ${new Date().toISOString()})
        ON CONFLICT (key) DO UPDATE SET value = ${new Date().toISOString()}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('affiliate-activation-request', ${'طلب تنشيط من السفير: ' + affiliate.code + ' (' + affiliate.name + ')'})`;
      await sendMail('oponlio@hotmail.com', 'طلب تنشيط حساب سفير ⚜ ' + affiliate.code, 'طلب تنشيط', 'السفير <b>' + affiliate.name + '</b> (الكود: ' + affiliate.code + ') طلب إعادة تنشيط حسابه المجمّد من لوحة تحكمه.', 'ar');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'update-credentials') {
      const { newUsername, newPassword } = JSON.parse(event.body || '{}');
      if (newUsername && newUsername.trim().length >= 3) {
        const cleanUsername = newUsername.trim();
        const dup = await sql`SELECT code FROM affiliates WHERE login_username = ${cleanUsername} AND code != ${affiliate.code}`;
        if (dup.length > 0) return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'اسم المستخدم هذا مستخدم بالفعل' }) };
        await sql`UPDATE affiliates SET login_username = ${cleanUsername} WHERE code = ${affiliate.code}`;
      }
      if (newPassword && newPassword.length >= 6) {
        await sql`UPDATE affiliates SET password = ${newPassword} WHERE code = ${affiliate.code}`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
