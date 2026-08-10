// تسجيل زيارة صفحة أو نقرة زر — تُستدعى من صفحات الموقع العامة (لا تحتاج تسجيل دخول)
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const body = JSON.parse(event.body || '{}');
    const type = String(body.type || 'pageview').slice(0, 40); // 'pageview' | 'click_join'
    const page = String(body.page || '').slice(0, 200);
    const lang = String(body.lang || '').slice(0, 10);
    const meta = body.meta || {};
    await sql`INSERT INTO events (type, page, lang, meta) VALUES (${type}, ${page}, ${lang}, ${JSON.stringify(meta)})`;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
