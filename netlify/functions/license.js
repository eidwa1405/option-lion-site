// التحقق من ترخيص سكربت التحضير — يستدعيه السكربت من متصفح المعلم
const { getSql, ensureTables } = require('./_db');

// مطابقة مرنة: البصمة "بريد|اسم|مدرسة" — يكفي تطابق جزأين أو البريد وحده
function sameTeacher(a, b) {
  if (!a || !b) return true;
  if (a === b) return true;
  const A = String(a).split('|'), B = String(b).split('|');
  const mailA = A.find((x) => x.indexOf('@') > -1), mailB = B.find((x) => x.indexOf('@') > -1);
  if (mailA && mailB) return mailA === mailB;
  let hits = 0;
  A.forEach((x) => { if (x && B.indexOf(x) > -1) hits++; });
  return hits >= 2 || (A.length === 1 && B.indexOf(A[0]) > -1);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  try {
    const q = event.queryStringParameters || {};
    const byEmail = String(q.byEmail || '').trim().toLowerCase();
    const code = String(q.code || '').trim().toUpperCase();
    const sql = getSql();
    await ensureTables(sql);
    // استعلام لوحة العضو: هل له ترخيص؟
    if (byEmail) {
      const r = await sql`SELECT code, valid_until, active FROM script_licenses WHERE lower(email) = ${byEmail} ORDER BY valid_until DESC LIMIT 1`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, license: r.length ? r[0] : null }) };
    }
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'رمز مفقود' }) };
    const acct = String((event.queryStringParameters || {}).acct || '').trim().slice(0, 120);
    const mail = String((event.queryStringParameters || {}).mail || '').trim().toLowerCase().slice(0, 120);
    const user = String((event.queryStringParameters || {}).user || '').trim().toLowerCase().slice(0, 120);
    await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS bound_account TEXT`;
    await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS madrasati_email TEXT`;
    await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS madrasati_user TEXT`;
    const rows = await sql`SELECT code, name, valid_until, active, bound_account, madrasati_email, madrasati_user FROM script_licenses WHERE code = ${code}`;
    if (!rows.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'notfound', msg: 'رمز غير معروف' }) };
    const r = rows[0];
    const until = new Date(r.valid_until);
    const expired = until.getTime() < Date.now() - 86400000;
    await sql`UPDATE script_licenses SET last_seen = now(), hits = hits + 1 WHERE code = ${code}`;
    if (!r.active) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'suspended', msg: 'الترخيص موقوف — راجع الإدارة' }) };
    if (expired) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'expired', until: r.valid_until, msg: 'انتهى اشتراكك — للتجديد opnlio.com' }) };
    // هوية مدرستي: اسم المستخدم الحكومي أولاً ثم البريد — تُقرأ آليًا من صفحة «بياناتي»
    await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS madrasati_user TEXT`;
    const savedUser = (r.madrasati_user || '').toLowerCase();
    const savedMail = (r.madrasati_email || '').toLowerCase();
    if (savedUser || savedMail) {
      const okUser = savedUser && user && savedUser === user;
      const okMail = savedMail && mail && savedMail === mail;
      if (!okUser && !okMail) {
        if (!user && !mail) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'needmail', msg: 'افتح صفحة «بياناتي» في مدرستي مرة واحدة ثم أعد المحاولة' }) };
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'mailmismatch', msg: 'هذا الرمز مسجَّل لحساب مدرستي آخر (' + (savedUser || savedMail) + ')' }) };
      }
    } else {
      // أول تفعيل: نثبّت الهوية الحقيقية كما قرأتها الأداة
      if (user) await sql`UPDATE script_licenses SET madrasati_user = ${user} WHERE code = ${code}`;
      if (mail) await sql`UPDATE script_licenses SET madrasati_email = ${mail} WHERE code = ${code}`;
    }

    // ربط الرمز بحساب مدرستي الأول — يمنع مشاركته بين المعلمين
    if (acct) {
      if (!r.bound_account) {
        await sql`UPDATE script_licenses SET bound_account = ${acct} WHERE code = ${code}`;
      } else if (!sameTeacher(r.bound_account, acct)) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'bound', msg: 'هذا الرمز مرتبط بحساب معلم آخر — لكل معلم رمزه' }) };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, name: r.name || '', until: r.valid_until }) };
  } catch (e) {
    // عند تعذّر الخادم لا نعطّل المعلم
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, soft: true }) };
  }
};
