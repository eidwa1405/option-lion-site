// يزيد عداد استخدام كود المسوّق عند تسجيل عميل به — يُستدعى من صفحة التسجيل مباشرة (بدون تسجيل دخول)
const { getSql, ensureTables } = require('./_db');
const { sendMail, nextCustomerId } = require('./_mailer');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
function notifyAdmin(msg) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
  }).catch(() => {});
}

const WELCOME_T = {
  ar: { hi: 'مرحباً', body: n => `مرحباً <b>${n}</b> 👋<br><br>أهلاً بك في عائلة O P N LIO ⚜ — تفعيل اشتراكك جارٍ الآن.<br><br>
    <b>رقم العميل:</b> ${'{CID}'}<br>
    <b>الباقة:</b> ${'{PLAN}'}<br>
    <b>فترتك المجانية سارية حتى:</b> ${'{TRIAL}'}<br><br>
    سيصلك بريد إلكتروني آخر بمجرد تفعيل اشتراكك على <b>TradingView</b> ✅<br><br>
    يمكنك أيضاً تحميل كتيب الشرح الشامل من هنا: <a href="${'{BOOKLET}'}" style="color:#D4AF37;">فتح الكتيب</a>`, subject: 'مرحباً بك في O P N LIO ⚜' },
  en: { hi: 'Welcome', body: n => `Hi <b>${n}</b> 👋<br><br>Welcome to the O P N LIO family ⚜ — your subscription activation is underway.<br><br>
    <b>Customer ID:</b> ${'{CID}'}<br>
    <b>Plan:</b> ${'{PLAN}'}<br>
    <b>Your free trial is valid until:</b> ${'{TRIAL}'}<br><br>
    You'll receive another email once your subscription is activated on <b>TradingView</b> ✅<br><br>
    You can also download the full guide here: <a href="${'{BOOKLET}'}" style="color:#D4AF37;">Open Guide</a>`, subject: 'Welcome to O P N LIO ⚜' }
};

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
      const lang = String(body.lang || 'ar').slice(0, 2);
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const rows = await sql`SELECT id, customer_id, phone, email, plan, welcome_sent FROM subscriptions
        WHERE customer_name = ${customerName} AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1`;
      if (rows.length) {
        const row = rows[0];
        let cid = row.customer_id;
        if (!cid) cid = await nextCustomerId(sql, row.phone);
        await sql`UPDATE subscriptions SET status = 'trial', expires_at = ${expiresAt}, customer_id = ${cid}, lang = ${lang}, updated_at = now() WHERE id = ${row.id}`;
        if (!row.welcome_sent && row.email) {
          const t = WELCOME_T[lang] || WELCOME_T.ar;
          const trialStr = new Date(expiresAt).toISOString().slice(0, 10);
          const booklet = 'https://opnlio.com/booklet-' + lang + '.html';
          const verifyToken = require('crypto').randomBytes(24).toString('hex');
          await sql`UPDATE subscriptions SET verify_token = ${verifyToken}, verify_token_created_at = now() WHERE id = ${row.id}`;
          const verifyLink = 'https://opnlio.com/.netlify/functions/verify-email?kind=customer&token=' + verifyToken;
          const bodyHtml = t.body(customerName).replace('{CID}', cid).replace('{PLAN}', row.plan || '-').replace('{TRIAL}', trialStr).replace('{BOOKLET}', booklet) + '<br><br><a href="' + verifyLink + '" style="display:inline-block; background:linear-gradient(120deg,#D4AF37,#f0cf6c); color:#070d18; font-weight:900; padding:11px 22px; border-radius:10px; text-decoration:none;">' + (lang === 'ar' ? 'تأكيد بريدك الإلكتروني' : 'Verify Your Email') + '</a>';
          await sendMail(row.email, t.subject, t.hi, bodyHtml, lang);
          await sql`UPDATE subscriptions SET welcome_sent = true WHERE id = ${row.id}`;
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
    const code = String(body.code || '').trim().toUpperCase();
    const customerName = String(body.customerName || '').slice(0, 120);
    const phone = String(body.phone || '').slice(0, 60);
    const telegram = String(body.telegram || '').slice(0, 60);
    const tradingview = String(body.tradingview || '').slice(0, 60);
    const plan = String(body.plan || '').slice(0, 60);
    const email = String(body.email || '').slice(0, 160);
    const lang = String(body.lang || 'ar').slice(0, 2);
    if (!customerName) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم مطلوب' }) };
    if (!body.termsAccepted) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'يجب الموافقة على الشروط والأحكام' }) };
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البريد الإلكتروني مطلوب' }) };
    const verifRows = await sql`SELECT id FROM email_verifications WHERE email = ${email.toLowerCase()} AND verified = true ORDER BY created_at DESC LIMIT 1`;
    if (!verifRows.length) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'يجب تأكيد البريد الإلكتروني قبل إكمال التسجيل' }) };
    const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';

    let validCode = null;
    if (code) {
      const found = await sql`SELECT code FROM ref_codes WHERE code = ${code}`;
      if (found.length > 0) {
        validCode = code;
        await sql`UPDATE ref_codes SET uses = uses + 1 WHERE code = ${code}`;
        await sql`INSERT INTO events (type, page, meta) VALUES ('ref_used', 'signup', ${JSON.stringify({ code, customerName })})`;
      }
    }
    let selfRefFlagged = false;
    if (validCode) {
      const ambRow = await sql`SELECT s.email AS amb_email, s.phone AS amb_phone, s.last_ip AS amb_ip FROM ambassador_requests r JOIN academy_students s ON s.id = r.student_id WHERE r.code = ${validCode} AND r.status = 'approved' LIMIT 1`;
      if (ambRow.length) {
        const a = ambRow[0];
        const emailMatch = a.amb_email && email && a.amb_email.toLowerCase() === email.toLowerCase();
        const phoneMatch = a.amb_phone && phone && a.amb_phone.replace(/\D/g,'') === phone.replace(/\D/g,'') && phone.replace(/\D/g,'').length >= 6;
        const ipMatch = a.amb_ip && clientIp && a.amb_ip === clientIp && clientIp !== 'unknown';
        selfRefFlagged = !!(emailMatch || phoneMatch);
        if (selfRefFlagged) {
          await sql`INSERT INTO audit_log (action, details) VALUES ('self-referral-blocked', ${'اشتباه إحالة ذاتية للكود ' + validCode + ' — ' + (emailMatch?'بريد ':'') + (phoneMatch?'جوال ':'')})`;
          notifyAdmin('⚠️ اشتباه إحالة ذاتية\nالكود: ' + validCode + '\nالعميل: ' + customerName + '\nلن تُحسب عمولة لهذه الإحالة');
        } else if (ipMatch) {
          await sql`INSERT INTO audit_log (action, details) VALUES ('self-referral-ip-review', ${'تطابق IP فقط للكود ' + validCode + ' — العميل ' + customerName + ' (قد يكون تطابقاً بريئاً بشبكة مشتركة) — العمولة تُحسب عادةً وتحتاج مراجعة إدارية'})`;
          notifyAdmin('🔎 تطابق IP فقط (مراجعة يدوية)\nالكود: ' + validCode + '\nالعميل: ' + customerName + '\nالعمولة ستُحسب عادةً — راجع إن كان تطابقاً بريئاً');
        }
      }
    }
    await sql`INSERT INTO subscriptions (customer_name, ref_code, status, phone, telegram, tradingview, plan, email, lang, terms_accepted_at, terms_accepted_ip, self_ref_flagged) VALUES (${customerName}, ${validCode}, 'pending_payment', ${phone}, ${telegram}, ${tradingview}, ${plan}, ${email}, ${lang}, now(), ${clientIp}, ${selfRefFlagged})`;
    await notifyAdmin('📝 تسجيل عميل جديد\nالاسم: ' + customerName + '\nالجوال: ' + phone + '\nتيليجرام: ' + telegram + '\nكود السفير: ' + (validCode || '—'));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: !!validCode }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
