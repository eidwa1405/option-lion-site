// تسجيل مسوّق جديد — عام (بدون تسجيل دخول)، يمنع تكرار الكود
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const b = JSON.parse(event.body || '{}');
    const code = String(b.code || '').trim().toUpperCase();
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الكود مطلوب' }) };
    if (!b.agreementAccepted) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'يجب الموافقة على الاتفاقية' }) };

    const existing = await sql`SELECT code FROM affiliates WHERE code = ${code}`;
    if (existing.length > 0) {
      return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'هذا الكود مستخدم من سفير آخر، اختر كوداً مختلفاً' }) };
    }

    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim();
    const legalName = String(b.legalName || '').trim().toLowerCase();
    const bankAccount = String(b.bankAccount || '').trim();
    if (email || phone || legalName || bankAccount) {
      const dup = await sql`SELECT code, active FROM affiliates
        WHERE lower(email) = ${email} OR phone = ${phone}
        OR (lower(legal_name) = ${legalName} AND ${legalName} != '')
        OR (bank_account = ${bankAccount} AND ${bankAccount} != '') LIMIT 1`;
      if (dup.length > 0) {
        const msg = dup[0].active
          ? 'يوجد حساب سفير مسجّل مسبقاً بنفس البريد أو الجوال، تواصل معنا عبر تيليجرام @option_lion إن كنت تحتاج مساعدة.'
          : 'حسابك السابق كسفير مُعطّل حالياً بسبب عدم النشاط — تواصل مع الدعم عبر تيليجرام @option_lion لإعادة تفعيله بدل التسجيل من جديد.';
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: msg }) };
      }
    }

    await sql`INSERT INTO affiliates (code, name, legal_name, country, city, email, age, phone, telegram, bank_account, agreement_accepted_at, signature_data)
      VALUES (${code}, ${b.name||''}, ${b.legalName||''}, ${b.country||''}, ${b.city||''}, ${b.email||''}, ${b.age?parseInt(b.age):null}, ${b.phone||''}, ${b.telegram||''}, ${b.bankAccount||''}, now(), ${b.signature||null})`;
    // نضيف الكود أيضاً في جدول ref_codes حتى يعمل عند التسجيل
    await sql`INSERT INTO ref_codes (code, owner_name) VALUES (${code}, ${b.name||''}) ON CONFLICT (code) DO NOTHING`;

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
