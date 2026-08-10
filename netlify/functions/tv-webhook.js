// يستقبل تنبيهات TradingView (Webhook) ويرسلها فوراً لقناة تيليجرام
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!BOT_TOKEN || !CHAT_ID) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN أو TELEGRAM_CHAT_ID غير معرّفين' }) };
  }

  let text = event.body || '';
  try {
    const parsed = JSON.parse(event.body);
    text = parsed.message || parsed.text || JSON.stringify(parsed);
  } catch (e) {
    // TradingView قد يرسل نص عادي غير JSON، نستخدمه كما هو
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: `🔔 ${text}` })
    });
    const data = await res.json();
    if (!data.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, telegram: data }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
