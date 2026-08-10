// تسجيل مسوّق جديد — عام (بدون تسجيل دخول)، يمنع تكرار الكود
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');
const { hashPassword } = require('./_auth');

const BOT_TOKEN = '8893054915:AAEOPsa1rX38q0vb-By1aAUvH-1rL10-nR8';
const CHAT_ID = '8485191267';
function notifyAdmin(msg) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
  }).catch(() => {});
}

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
    if (!b.password || String(b.password).length < 6) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }) };
    const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';

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
          ? 'يوجد حساب سفير مسجّل مسبقاً بنفس البريد أو الجوال، تواصل معنا عبر البريد الإلكتروني opon.netlify@gmail.com إن كنت تحتاج مساعدة.'
          : 'حسابك السابق كسفير مُعطّل حالياً بسبب عدم النشاط — تواصل مع الدعم عبر البريد الإلكتروني opon.netlify@gmail.com لإعادة تفعيله بدل التسجيل من جديد.';
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: msg }) };
      }
    }

    const loginUsername = code;
    async function nextAffiliateId() {
      for (let i = 0; i < 10; i++) {
        const cand = String(Math.floor(1000 + Math.random() * 9000));
        const exists = await sql`SELECT code FROM affiliates WHERE affiliate_id = ${cand}`;
        if (!exists.length) return cand;
      }
      return String(Date.now()).slice(-4);
    }
    const affId = await nextAffiliateId();
    const verifyToken = crypto.randomBytes(24).toString('hex');
    await sql`INSERT INTO affiliates (code, name, legal_name, country, city, email, age, phone, telegram, bank_account, agreement_accepted_at, signature_data, active, password, login_username, affiliate_id, verify_token, agreement_ip, lang)
      VALUES (${code}, ${b.name||''}, ${b.legalName||''}, ${b.country||''}, ${b.city||''}, ${b.email||''}, ${b.age?parseInt(b.age):null}, ${b.phone||''}, ${b.telegram||''}, ${b.bankAccount||''}, now(), ${b.signature||null}, false, ${hashPassword(b.password)}, ${loginUsername}, ${affId}, ${verifyToken}, ${clientIp}, ${b.lang||'ar'})`;
    await notifyAdmin('🤝 طلب تسجيل سفير جديد\nالاسم: ' + (b.name||'') + '\nالكود: ' + code + '\nتيليجرام: ' + (b.telegram||'') + '\nالدولة: ' + (b.country||''));

    if (b.email) {
      const verifyLink = 'https://opon.netlify.app/.netlify/functions/verify-email?kind=affiliate&token=' + verifyToken;
      const bodyHtml = `<div dir="rtl">مرحباً <b>${b.name}</b> 👋<br><br>يرجى تأكيد بريدك الإلكتروني لإكمال تسجيلك كسفير في O P N LIO ⚜<br><br><a href="${verifyLink}" style="display:inline-block; background:linear-gradient(120deg,#D4AF37,#f0cf6c); color:#070d18; font-weight:900; padding:12px 26px; border-radius:10px; text-decoration:none;">تأكيد البريد الإلكتروني</a></div>`;
      await sendMail(b.email, 'تأكيد بريدك الإلكتروني — O P N LIO ⚜', 'تأكيد البريد', bodyHtml, b.lang||'ar');
    }
    // لا نضيف الكود إلى ref_codes إلا بعد اعتماد الإدارة له

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
