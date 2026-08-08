// يزيد عداد استخدام كود المسوّق عند تسجيل عميل به — يُستدعى من صفحة التسجيل مباشرة (بدون تسجيل دخول)
const { getSql, ensureTables } = require('./_db');
const { sendMail, nextCustomerId } = require('./_mailer');

const WELCOME_T = {
  ar: { hi: 'مرحباً', body: n => `مرحباً <b>${n}</b> 👋<br><br>أهلاً بك في عائلة أسد الأوبشن ⚜ — تفعيل اشتراكك جارٍ الآن.<br><br>
    <b>رقم العميل:</b> ${'{CID}'}<br>
    <b>الباقة:</b> ${'{PLAN}'}<br>
    <b>فترتك المجانية سارية حتى:</b> ${'{TRIAL}'}<br><br>
    سيصلك بريد إلكتروني آخر بمجرد تفعيل اشتراكك على <b>TradingView</b> ✅<br><br>
    يمكنك أيضاً تحميل كتيب الشرح الشامل من هنا: <a href="${'{BOOKLET}'}" style="color:#D4AF37;">فتح الكتيب</a>`, subject: 'مرحباً بك في أسد الأوبشن ⚜' },
  en: { hi: 'Welcome', body: n => `Hi <b>${n}</b> 👋<br><br>Welcome to the Option Lion family ⚜ — your subscription activation is underway.<br><br>
    <b>Customer ID:</b> ${'{CID}'}<br>
    <b>Plan:</b> ${'{PLAN}'}<br>
    <b>Your free trial is valid until:</b> ${'{TRIAL}'}<br><br>
    You'll receive another email once your subscription is activated on <b>TradingView</b> ✅<br><br>
    You can also download the full guide here: <a href="${'{BOOKLET}'}" style="color:#D4AF37;">Open Guide</a>`, subject: 'Welcome to Option Lion ⚜' }
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
          const booklet = 'https://opon.netlify.app/booklet.html#' + lang + '-section';
          const bodyHtml = t.body(customerName).replace('{CID}', cid).replace('{PLAN}', row.plan || '-').replace('{TRIAL}', trialStr).replace('{BOOKLET}', booklet);
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

    let validCode = null;
    if (code) {
      const found = await sql`SELECT code FROM ref_codes WHERE code = ${code}`;
      if (found.length > 0) {
        validCode = code;
        await sql`UPDATE ref_codes SET uses = uses + 1 WHERE code = ${code}`;
        await sql`INSERT INTO events (type, page, meta) VALUES ('ref_used', 'signup', ${JSON.stringify({ code, customerName })})`;
      }
    }
    await sql`INSERT INTO subscriptions (customer_name, ref_code, status, phone, telegram, tradingview, plan, email, lang) VALUES (${customerName}, ${validCode}, 'pending_payment', ${phone}, ${telegram}, ${tradingview}, ${plan}, ${email}, ${lang})`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: !!validCode }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
