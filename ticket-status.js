// يبحث عن حالة تذكرة دعم برقمها المرجعي — عام بدون تسجيل دخول
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    await ensureTables();
    const sql = getSql();
    const ref = String((event.queryStringParameters && event.queryStringParameters.ref) || '').trim().toUpperCase();
    if (!ref) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الرقم المرجعي مطلوب' }) };
    const rows = await sql`SELECT ref_number, ticket_type, status, admin_reply, created_at FROM support_tickets WHERE ref_number = ${ref}`;
    if (!rows.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ticket: null }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ticket: rows[0] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
