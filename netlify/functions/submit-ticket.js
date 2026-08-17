// استقبال شكاوى/اقتراحات/استفسارات — عام بدون تسجيل دخول، ويعطي رقماً مرجعياً
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

function generateRefNumber() {
  return 'TK' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random()*900+100);
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const _ip = String((event.headers && (event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0])) || '').trim().slice(0, 45);
    if (_ip) {
      const _sqlRL = getSql();
      await _sqlRL`CREATE TABLE IF NOT EXISTS check_attempts (id serial PRIMARY KEY, ip text, kind text, created_at timestamptz DEFAULT now())`;
      const _tries = await _sqlRL`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${_ip} AND kind = 'ticket' AND created_at > now() - interval '1 hour'`;
      if (_tries[0].c >= 5) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة — حاول بعد قليل' }) };
      await _sqlRL`INSERT INTO check_attempts (ip, kind) VALUES (${_ip}, 'ticket')`;
    }
    const sql = getSql();
    const b = JSON.parse(event.body || '{}');
    const email = String(b.email || '').trim().toLowerCase();
    const message = String(b.message || '').trim();
    if (!email || !message) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البريد والوصف مطلوبان' }) };

    const refNumber = generateRefNumber();
    await sql`INSERT INTO support_tickets (ref_number, ticket_type, linked_id, name, email, message, priority)
      VALUES (${refNumber}, ${b.ticketType||'عام'}, ${b.linkedId||''}, ${b.name||''}, ${email}, ${message}, ${b.priority||'normal'})`;

    const bodyHtml = `<div dir="rtl">مرحباً <b>${b.name||''}</b> 👋<br><br>تم استلام طلبك بنجاح في O P N LIO ⚜<br><br>رقمك المرجعي: <b style="color:#D4AF37; font-size:18px;">${refNumber}</b><br>النوع: ${b.ticketType||'عام'}<br><br>سيراجع فريقنا طلبك ويردّ عليك عبر هذا البريد في أقرب وقت ممكن.<br><br>يمكنك الاحتفاظ بالرقم المرجعي أعلاه للمتابعة.</div>`;
    await sendMail(email, 'تم استلام طلبك — رقم مرجعي ' + refNumber, 'تم الاستلام', bodyHtml, 'ar');

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refNumber }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
