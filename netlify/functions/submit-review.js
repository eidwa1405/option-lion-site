// إرسال رأي جديد من زائر — عام بدون تسجيل دخول، يُخزّن كـ"معلّق" بانتظار موافقة الأدمن
const { getSql, ensureTables } = require('./_db');

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
      const _tries = await _sqlRL`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${_ip} AND kind = 'review' AND created_at > now() - interval '1 hour'`;
      if (_tries[0].c >= 3) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة — حاول بعد قليل' }) };
      await _sqlRL`INSERT INTO check_attempts (ip, kind) VALUES (${_ip}, 'review')`;
    }
    const sql = getSql();
    const b = JSON.parse(event.body || '{}');
    const name = String(b.name || '').trim().slice(0, 80);
    const nationality = String(b.nationality || '').trim().slice(0, 60);
    const city = String(b.city || '').trim().slice(0, 60);
    const review_text = String(b.review_text || '').trim().slice(0, 800);
    const lang = String(b.lang || 'ar').slice(0, 5);
    if (!name || !review_text) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الاسم والرأي مطلوبان' }) };
    await sql`INSERT INTO pending_reviews (name, nationality, city, review_text, lang) VALUES (${name}, ${nationality}, ${city}, ${review_text}, ${lang})`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
