// بيانات لوحة تحكم السفير (قراءة فقط) — يتطلب توكن جلسة صادر من affiliate-login
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');
const { hashPassword } = require('./_auth');

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

    // نبض حضور السفير: يحدّث آخر ظهور لسجله الطلابي (إن كان سفيراً من الأكاديمية) وجدول السفراء
    if (action === 'heartbeat' || action === 'go-offline') {
      await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`;
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`;
      const ts = action === 'heartbeat' ? "now()" : "now() - interval '10 minutes'";
      if (action === 'heartbeat') {
        await sql`UPDATE affiliates SET last_seen_at = now() WHERE code = ${affiliate.code}`;
        await sql`UPDATE academy_students SET last_seen_at = now() WHERE id IN (SELECT student_id FROM ambassador_requests WHERE code = ${affiliate.code} AND status = 'approved')`;
      } else {
        await sql`UPDATE affiliates SET last_seen_at = now() - interval '10 minutes' WHERE code = ${affiliate.code}`;
        await sql`UPDATE academy_students SET last_seen_at = now() - interval '10 minutes' WHERE id IN (SELECT student_id FROM ambassador_requests WHERE code = ${affiliate.code} AND status = 'approved')`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'my-payouts') {
      const items = await sql`SELECT i.amount, i.floor_amount, i.bonus_amount, r.month, r.id AS run_id FROM payout_items i JOIN payout_runs r ON r.id = i.run_id WHERE i.ref_code = ${affiliate.code} ORDER BY r.month DESC`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items }) };
    }

    if (event.httpMethod === 'GET' && action === 'profile') {
      const customers = await sql`SELECT s.id, s.status, s.plan, s.expires_at, s.created_at, s.aff_reminder_48h_sent, s.aff_reminder_12h_sent,
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
          id: c.id, status: c.status, plan: c.plan, expires_at: c.expires_at,
          customer_commission: c.customer_commission, customer_renewals: c.customer_renewals,
          hoursLeft: hoursLeft, reminderEligible: reminderEligible
        };
      });
      const safeAffiliate = {
        name: affiliate.name, legal_name: affiliate.legal_name, country: affiliate.country, city: affiliate.city,
        email: affiliate.email, phone: affiliate.phone, telegram: affiliate.telegram, code: affiliate.code,
        bank_account: affiliate.bank_account, agreement_accepted_at: affiliate.agreement_accepted_at, signature_data: affiliate.signature_data,
        login_username: affiliate.login_username || affiliate.code, active: affiliate.active,
        role: affiliate.role || 'affiliate', leader_code: affiliate.leader_code || null, leader_since: affiliate.leader_since || null
      };
      const activeCampaign = await sql`SELECT name, boost_amount, cap_override, ends_at FROM boost_campaigns
        WHERE now() BETWEEN starts_at AND ends_at AND (target = 'all' OR ${affiliate.code} = ANY(target_codes))
        ORDER BY boost_amount DESC LIMIT 1`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, affiliate: safeAffiliate, customers: customersOut, totalCommission: totalCommission[0].total, customerCount: customers.length, monthly, activeCampaign: activeCampaign.length ? activeCampaign[0] : null }) };
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
        ar: { subject: 'تذكير: اشتراكك في O P N LIO ينتهي قريباً ⚜', hi: 'لا تفوّت استمرارية أدواتك',
          body: `مرحباً <b>${c.customer_name}</b> 👋<br><br>باقي على انتهاء اشتراكك في O P N LIO حوالي <b style="color:#ff9b9b;">${hoursRounded} ساعة</b> فقط.<br><br>
            لا تدع أدواتك المتكاملة (منظومة O P N LIO، امبراطورية الأثرياء، Smart Pivot، King's Call) تتوقف عن خدمتك — جدّد اشتراكك الآن واستمر بالاستفادة من التحليل اللحظي والتنبيهات الذكية.<br><br>
            <a href="https://opnlio.com/signup.html" style="display:inline-block;background:linear-gradient(120deg,#D4AF37,#f0cf6c);color:#070d18;font-weight:900;padding:12px 26px;border-radius:10px;text-decoration:none;">تجديد الاشتراك الآن</a>` },
        en: { subject: 'Reminder: Your O P N LIO subscription is expiring soon ⚜', hi: "Don't lose access to your tools",
          body: `Hi <b>${c.customer_name}</b> 👋<br><br>Your O P N LIO subscription expires in about <b style="color:#ff9b9b;">${hoursRounded} hours</b>.<br><br>
            Don't let your integrated tools (O P N LIO System, Empire of the Wealthy, Smart Pivot, King's Call) stop serving you — renew now and keep benefiting from real-time analysis and smart alerts.<br><br>
            <a href="https://opnlio.com/en-signup.html" style="display:inline-block;background:linear-gradient(120deg,#D4AF37,#f0cf6c);color:#070d18;font-weight:900;padding:12px 26px;border-radius:10px;text-decoration:none;">Renew Now</a>` }
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
      await sendMail('info@opnlio.com', 'طلب تنشيط حساب سفير ⚜ ' + affiliate.code, 'طلب تنشيط', 'السفير <b>' + affiliate.name + '</b> (الكود: ' + affiliate.code + ') طلب إعادة تنشيط حسابه المجمّد من لوحة تحكمه.', 'ar');
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
        await sql`UPDATE affiliates SET password = ${hashPassword(newPassword)} WHERE code = ${affiliate.code}`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ═══ أدوات قائد السفراء 🦁 ═══
    const isLeader = affiliate.role === 'leader';

    if (event.httpMethod === 'GET' && action === 'team') {
      if (!isLeader) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const team = await sql`SELECT a.code, a.name, a.active, a.last_seen_at, a.created_at,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.ref_code = a.code)::int AS customers,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.ref_code = a.code AND s.status != 'canceled')::int AS active_customers,
          (SELECT COUNT(*) FROM commission_log c WHERE c.ref_code = a.code AND c.created_at > now() - interval '30 days')::int AS renewals_30d,
          (SELECT MAX(c.created_at) FROM commission_log c WHERE c.ref_code = a.code) AS last_sale_at
        FROM affiliates a WHERE a.leader_code = ${affiliate.code} ORDER BY renewals_30d DESC`;
      const teamOut = team.map(function(t){
        const online = t.last_seen_at && (Date.now() - new Date(t.last_seen_at).getTime()) < 5*60000;
        return { code: t.code, name: t.name, active: t.active, online: online, customers: t.customers,
          active_customers: t.active_customers, renewals_30d: t.renewals_30d, last_sale_at: t.last_sale_at, last_seen_at: t.last_seen_at };
      });
      // أجر القائد الحالي (شفاف له)
      const fromTs = affiliate.leader_since;
      const codes = team.map(function(t){ return t.code; });
      let supervision = 0, renewals = 0;
      if (codes.length && fromTs) {
        const ren = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COUNT(*)::int AS n FROM commission_log
          WHERE ref_code = ANY(${codes}) AND created_at >= ${fromTs} AND (kind IS NULL OR kind != 'clock') GROUP BY month`;
        ren.forEach(function(m){ renewals += m.n; supervision += Math.min(m.n,100)*1 + Math.min(Math.max(m.n-100,0),100)*1.5 + Math.max(m.n-200,0)*2; });
        const clk = await sql`SELECT COUNT(*)::int AS n FROM commission_log WHERE ref_code = ANY(${codes}) AND created_at >= ${fromTs} AND kind = 'clock'`;
        supervision += clk[0].n * 2;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, team: teamOut, leaderSince: affiliate.leader_since,
        earnings: { renewals: renewals, supervision: Math.round(supervision*100)/100 } }) };
    }

    if (event.httpMethod === 'POST' && action === 'team-freeze') {
      if (!isLeader) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { code, freeze } = JSON.parse(event.body || '{}');
      const c = String(code||'').trim().toUpperCase();
      const ok = await sql`SELECT code FROM affiliates WHERE code = ${c} AND leader_code = ${affiliate.code}`;
      if (!ok.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'ليس ضمن فريقك' }) };
      await sql`UPDATE affiliates SET active = ${!freeze} WHERE code = ${c}`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('leader-team-freeze', ${'القائد ' + affiliate.code + (freeze ? ' جمّد ' : ' فكّ تجميد ') + c})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'POST' && action === 'leader-request') {
      if (!isLeader) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const { type, payload } = JSON.parse(event.body || '{}');
      const allowed = ['freeze','unfreeze','remove','recruit','commission','campaign'];
      if (allowed.indexOf(type) < 0) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'نوع طلب غير معروف' }) };
      await sql`INSERT INTO leader_requests (leader_code, type, payload) VALUES (${affiliate.code}, ${type}, ${JSON.stringify(payload||{})})`;
      await sql`INSERT INTO audit_log (action, details) VALUES ('leader-request', ${'طلب من قائد السفراء ' + affiliate.code + ': ' + type})`;
      try { await sendMail('info@opnlio.com', 'طلب جديد من قائد السفراء 🦁 ' + affiliate.code, 'طلب معلق بانتظار اعتمادك',
        'القائد <b>' + affiliate.name + '</b> رفع طلب <b>' + type + '</b>.<br>التفاصيل: ' + JSON.stringify(payload||{}) + '<br><br>اعتمده أو ارفضه من لوحة الإدارة — قسم طلبات القائد.', 'ar'); } catch(e) {}
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'my-requests') {
      if (!isLeader) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
      const rows = await sql`SELECT id, type, payload, status, decision_note, created_at, decided_at FROM leader_requests WHERE leader_code = ${affiliate.code} ORDER BY created_at DESC LIMIT 50`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items: rows }) };
    }

    if (event.httpMethod === 'GET' && action === 'messages') {
      // القائد: مع أي فرد من فريقه · السفير: مع قائده فقط
      const withCode = (event.queryStringParameters.with || '').trim().toUpperCase();
      let peer = null;
      if (isLeader) {
        const ok = await sql`SELECT code FROM affiliates WHERE code = ${withCode} AND leader_code = ${affiliate.code}`;
        if (!ok.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'ليس ضمن فريقك' }) };
        peer = withCode;
      } else {
        if (!affiliate.leader_code) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items: [], noLeader: true }) };
        peer = affiliate.leader_code;
      }
      const rows = await sql`SELECT * FROM team_messages WHERE (from_code = ${affiliate.code} AND to_code = ${peer}) OR (from_code = ${peer} AND to_code = ${affiliate.code}) ORDER BY created_at ASC LIMIT 200`;
      await sql`UPDATE team_messages SET read_at = now() WHERE to_code = ${affiliate.code} AND from_code = ${peer} AND read_at IS NULL`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items: rows, peer: peer, me: affiliate.code }) };
    }

    if (event.httpMethod === 'POST' && action === 'send-message') {
      const { to, body } = JSON.parse(event.body || '{}');
      const text = String(body||'').trim().slice(0, 2000);
      if (!text) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الرسالة فارغة' }) };
      let target = null;
      if (isLeader) {
        const c = String(to||'').trim().toUpperCase();
        const ok = await sql`SELECT code FROM affiliates WHERE code = ${c} AND leader_code = ${affiliate.code}`;
        if (!ok.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'ليس ضمن فريقك' }) };
        target = c;
      } else {
        if (!affiliate.leader_code) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'لا يوجد قائد مرتبط بك' }) };
        target = affiliate.leader_code;
      }
      await sql`INSERT INTO team_messages (from_code, to_code, body) VALUES (${affiliate.code}, ${target}, ${text})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'GET' && action === 'unread-count') {
      const n = await sql`SELECT COUNT(*)::int AS n FROM team_messages WHERE to_code = ${affiliate.code} AND read_at IS NULL`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, unread: n[0].n }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
