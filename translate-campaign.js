// ترجمة نص عبر خدمة MyMemory المجانية — تستخدمها لوحة تحكم الإدارة لترجمة الحملات البريدية تلقائياً
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');

async function checkTokenAsync(event, sql) {
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!token) return false;
  const rows = await sql`SELECT key, value FROM admin_settings WHERE key IN ('active_session_token','active_session_started_at')`;
  const map = {}; rows.forEach(r => map[r.key] = r.value);
  if (!map.active_session_token || token !== map.active_session_token) return false;
  if (map.active_session_started_at) {
    const started = new Date(map.active_session_started_at).getTime();
    if (Date.now() - started > 24 * 3600 * 1000) return false;
  }
  return true;
}

async function translateOne(text, targetLang) {
  if (!text) return '';
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=ar|' + targetLang;
  const r = await fetch(url);
  const j = await r.json();
  return (j && j.responseData && j.responseData.translatedText) ? j.responseData.translatedText : text;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    await ensureTables();
    const sql = getSql();
    if (!(await checkTokenAsync(event, sql))) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'غير مصرح' }) };
    }
    const { subject, message, langs } = JSON.parse(event.body || '{}');
    const targets = (langs || []).filter(l => l && l !== 'ar');
    const result = {};
    for (const lc of targets) {
      result[lc] = {
        subject: await translateOne(subject, lc),
        message: await translateOne(message, lc)
      };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, translations: result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
