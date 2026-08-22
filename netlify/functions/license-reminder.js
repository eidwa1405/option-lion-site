// تنبيه تجديد تراخيص أداة التحضير — يعمل يوميًا
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

exports.handler = async () => {
  try {
    const sql = getSql();
    await ensureTables(sql);
    await sql`ALTER TABLE script_licenses ADD COLUMN IF NOT EXISTS reminded_at DATE`;
    const rows = await sql`SELECT code, name, email, valid_until FROM script_licenses
      WHERE active = true AND email IS NOT NULL AND email <> ''
        AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        AND (reminded_at IS NULL OR reminded_at < CURRENT_DATE - 5)`;
    let sent = 0;
    for (const r of rows) {
      const until = String(r.valid_until).slice(0, 10);
      const days = Math.max(0, Math.round((new Date(until) - Date.now()) / 86400000));
      const html = '<div dir="rtl" style="font-family:Tahoma,Arial;background:#070d18;color:#e9edf5;padding:24px;border-radius:14px">' +
        '<h2 style="color:#D4AF37;margin:0 0 12px">تذكير بتجديد اشتراكك</h2>' +
        '<p>مرحباً ' + (r.name || '') + '،</p>' +
        '<p>اشتراكك في أداة التحضير التلقائي ينتهي خلال <b>' + days + ' يوم</b> (' + until + ').</p>' +
        '<p>بعد انتهائه يتوقف التحضير التلقائي — والتجديد يبقيك على نفس الرمز والإعدادات.</p>' +
        '<p style="margin-top:16px"><a href="https://opnlio.com/teacher-script.html" style="background:#D4AF37;color:#070d18;padding:12px 24px;border-radius:10px;font-weight:900;text-decoration:none">تجديد الاشتراك</a></p>' +
        '<p style="color:#8a93a8;font-size:12.5px;margin-top:16px">رمزك الحالي: <b style="direction:ltr">' + r.code + '</b></p></div>';
      try {
        await sendMail(r.email, 'اشتراكك ينتهي خلال ' + days + ' يوم — OPN LIO', 'اشتراكك ينتهي في ' + until, html, 'ar');
        await sql`UPDATE script_licenses SET reminded_at = CURRENT_DATE WHERE code = ${r.code}`;
        sent++;
      } catch (e) {}
    }
    return { statusCode: 200, body: 'reminded ' + sent };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};

exports.config = { schedule: '@daily' };
