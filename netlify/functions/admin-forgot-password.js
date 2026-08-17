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
    const _ip = String((event.headers && (event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0])) || '').trim().slice(0, 45);
    if (_ip) {
      const _sqlRL = getSql();
      await _sqlRL`CREATE TABLE IF NOT EXISTS check_attempts (id serial PRIMARY KEY, ip text, kind text, created_at timestamptz DEFAULT now())`;
      const _tries = await _sqlRL`SELECT COUNT(*)::int AS c FROM check_attempts WHERE ip = ${_ip} AND kind = 'adm-forgot' AND created_at > now() - interval '1 hour'`;
      if (_tries[0].c >= 3) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة — حاول بعد قليل' }) };
      await _sqlRL`INSERT INTO check_attempts (ip, kind) VALUES (${_ip}, 'adm-forgot')`;
    }
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
