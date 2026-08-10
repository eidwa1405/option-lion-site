// استعادة كلمة مرور لوحة تحكم الإدارة — يولّد كلمة مرور مؤقتة جديدة ويرسلها لبريد الإدارة الثابت
const { getSql, ensureTables } = require('./_db');
const { hashPassword } = require('./_auth');
const { sendMail } = require('./_mailer');

const ADMIN_RECOVERY_EMAIL = 'eidwa@hotmail.com';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();

    const tempPassword = Math.random().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(-4);
    await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_password', ${hashPassword(tempPassword)}) ON CONFLICT (key) DO UPDATE SET value = ${hashPassword(tempPassword)}`;

    const userRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_username'`;
    const adminUsername = userRow.length ? userRow[0].value : 'admin';

    await sql`INSERT INTO audit_log (action, details) VALUES ('admin-password-reset', 'إعادة تعيين كلمة مرور الإدارة عبر الاستعادة')`;

    const bodyHtml = `<div dir="rtl">تنبيه أمني: تم طلب استعادة كلمة مرور لوحة تحكم الإدارة في O P N LIO ⚜<br><br>اسم المستخدم: <b style="color:#D4AF37; font-size:16px;">${adminUsername}</b><br>كلمة المرور الجديدة المؤقتة: <b style="color:#D4AF37; font-size:18px;">${tempPassword}</b><br><br>يمكنك تغييرها من داخل لوحة التحكم (الإعدادات) بعد الدخول.<br><br>إن لم تكن أنت من طلب ذلك، تحقق من أمان الوصول للوحة التحكم فوراً.</div>`;
    await sendMail(ADMIN_RECOVERY_EMAIL, 'استعادة كلمة مرور لوحة تحكم الإدارة — O P N LIO ⚜', 'كلمة مرور جديدة', bodyHtml, 'ar');

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, message: 'تم إرسال بيانات دخول جديدة إلى البريد المسجّل للإدارة.' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
