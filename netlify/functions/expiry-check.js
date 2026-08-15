// وظيفة مجدولة: تعمل كل ساعة وترسل تنبيه تيليجرام عند اقتراب انتهاء أي اشتراك خلال 48 ساعة + تذكير بريدي للسفير بعميله المُحال
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

exports.handler = async () => {
  try {
    await ensureTables();
    const sql = getSql();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600000);

    const rows = await sql`SELECT id, customer_name, plan, expires_at, ref_code, aff_owner_notified_48h FROM subscriptions
      WHERE expires_at IS NOT NULL AND expires_at > ${now.toISOString()} AND expires_at <= ${in48h.toISOString()}
      AND status NOT IN ('canceled') AND (notified_48h IS NOT TRUE)`;

    for (const r of rows) {
      const msg = '⏰ تنبيه انتهاء اشتراك خلال 48 ساعة\nالعميل: ' + r.customer_name + '\nالباقة: ' + (r.plan || '-') + '\nينتهي في: ' + new Date(r.expires_at).toLocaleString('ar-SA');
      await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      }).catch(() => {});
      await sql`UPDATE subscriptions SET notified_48h = true WHERE id = ${r.id}`;

      if (r.ref_code) {
        const ambRows = await sql`SELECT s.id AS student_id, s.email, s.name FROM ambassador_requests req JOIN academy_students s ON s.id = req.student_id WHERE req.code = ${r.ref_code} AND req.status = 'approved' LIMIT 1`;
        if (ambRows.length && ambRows[0].email) {
          const amb = ambRows[0];
          const expStr = new Date(r.expires_at).toLocaleString('ar-SA');
          await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${amb.student_id}, '⏰ اشتراك عميلك يقترب من الانتهاء', ${'اشتراك عميلك «' + r.customer_name + '» ينتهي خلال 48 ساعة (' + expStr + ') — تواصل معه لتذكيره بالتجديد وتضمن استمرار عمولتك.'})`;
          await sendMail(amb.email, '⏰ عميلك يقترب من انتهاء اشتراكه — O P N LIO', 'تذكير سفير', '<div dir="rtl">مرحباً <b>' + amb.name + '</b> 👋<br><br>عميلك المُحال <b>' + r.customer_name + '</b> ينتهي اشتراكه خلال 48 ساعة (' + expStr + ').<br><br>تواصل معه الآن لتذكيره بالتجديد — استمرار اشتراكه يعني استمرار عمولتك 💰</div>', 'ar').catch(() => {});
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, notified: rows.length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

exports.config = { schedule: '@hourly' };
