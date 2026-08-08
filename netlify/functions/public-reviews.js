// يعرض الآراء المعتمدة فقط، حسب اللغة — عام بدون تسجيل دخول
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const lang = String((event.queryStringParameters && event.queryStringParameters.lang) || 'ar').slice(0, 5);
    const rows = await sql`SELECT name, nationality, city, review_text FROM pending_reviews WHERE status = 'approved' AND lang = ${lang} ORDER BY created_at DESC LIMIT 100`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, reviews: rows }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
