// إرسال رأي جديد من زائر — عام بدون تسجيل دخول، يُخزّن كـ"معلّق" بانتظار موافقة الأدمن
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
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
