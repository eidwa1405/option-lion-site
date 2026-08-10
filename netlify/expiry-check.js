// وظيفة مجدولة: تعمل كل ساعة وترسل تنبيه تيليجرام عند اقتراب انتهاء أي اشتراك خلال 48 ساعة
const { getSql, ensureTables } = require('./_db');

const BOT_TOKEN = '8893054915:AAEOPsa1rX38q0vb-By1aAUvH-1rL10-nR8';
const CHAT_ID = '8485191267';

exports.handler = async () => {
  try {
    await ensureTables();
    const sql = getSql();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600000);

    const rows = await sql`SELECT id, customer_name, plan, expires_at FROM subscriptions
      WHERE expires_at IS NOT NULL AND expires_at > ${now.toISOString()} AND expires_at <= ${in48h.toISOString()}
      AND status NOT IN ('canceled') AND (notified_48h IS NOT TRUE)`;

    for (const r of rows) {
      const msg = '⏰ تنبيه انتهاء اشتراك خلال 48 ساعة\nالعميل: ' + r.customer_name + '\nالباقة: ' + (r.plan || '-') + '\nينتهي في: ' + new Date(r.expires_at).toLocaleString('ar-SA');
      await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      }).catch(() => {});
      await sql`UPDATE subscriptions SET notified_48h = true WHERE id = ${r.id}`;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, notified: rows.length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

exports.config = { schedule: '@hourly' };
