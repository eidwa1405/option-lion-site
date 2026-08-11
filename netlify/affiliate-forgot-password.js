// استعادة كلمة مرور السفير — يولّد كلمة مرور مؤقتة جديدة ويرسلها لبريد السفير المسجّل، مع نسخة إشعار للإدارة
const { getSql, ensureTables } = require('./_db');
const { hashPassword } = require('./_auth');
const { sendMail } = require('./_mailer');

const ADMIN_NOTIFY_EMAIL = 'eidwa@hotmail.com';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const { identifier } = JSON.parse(event.body || '{}');
    const clean = String(identifier || '').trim();
    if (!clean) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'أدخل اسم المستخدم أو الكود أو البريد الإلكتروني' }) };

    const rows = await sql`SELECT * FROM affiliates WHERE login_username = ${clean} OR code = ${clean.toUpperCase()} OR email = ${clean}`;
    // رسالة عامة دوماً لتفادي الكشف عن وجود الحساب أو عدمه
    const genericMsg = { ok: true, message: 'إذا كانت البيانات صحيحة، سيتم إرسال كلمة مرور جديدة إلى بريدك المسجّل.' };
    if (rows.length === 0) return { statusCode: 200, headers, body: JSON.stringify(genericMsg) };

    const a = rows[0];
    if (!a.email) return { statusCode: 200, headers, body: JSON.stringify(genericMsg) };

    const tempPassword = Math.random().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(-4);
    await sql`UPDATE affiliates SET password = ${hashPassword(tempPassword)} WHERE code = ${a.code}`;
    await sql`INSERT INTO audit_log (action, details) VALUES ('affiliate-password-reset', ${'إعادة تعيين كلمة مرور السفير: ' + a.code})`;

    const bodyHtml = `<div dir="rtl">مرحباً <b>${a.name}</b> 👋<br><br>تلقّينا طلباً لاستعادة بيانات دخولك كسفير في O P N LIO ⚜<br><br>اسم المستخدم: <b style="color:#D4AF37; font-size:16px;">${a.login_username || a.code}</b><br>كلمة مرورك الجديدة المؤقتة: <b style="color:#D4AF37; font-size:18px;">${tempPassword}</b><br><br>يمكنك استخدامها للدخول عبر <a href="https://opnlio.com/affiliate-login.html" style="color:#D4AF37;">affiliate-login</a>، ويُفضّل تغييرها إلى كلمة مرور من اختيارك بعد الدخول من داخل لوحة تحكمك.<br><br>إن لم تكن أنت من طلب ذلك، تواصل مع فريق الدعم فوراً.</div>`;
    await sendMail(a.email, 'استعادة بيانات دخول السفير — O P N LIO ⚜', 'بيانات دخول جديدة', bodyHtml, 'ar');

    const adminBodyHtml = `<div dir="rtl">تنبيه إداري: تم إعادة تعيين كلمة مرور السفير <b>${a.name}</b> (اسم المستخدم: ${a.login_username || a.code}) وإرسال بيانات الدخول الكاملة إلى بريده ${a.email}.<br><br>اسم المستخدم: ${a.login_username || a.code}<br>كلمة المرور الجديدة: ${tempPassword}</div>`;
    await sendMail(ADMIN_NOTIFY_EMAIL, 'إشعار: إعادة تعيين كلمة مرور سفير — ' + a.code, 'إشعار إداري', adminBodyHtml, 'ar');

    return { statusCode: 200, headers, body: JSON.stringify(genericMsg) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
