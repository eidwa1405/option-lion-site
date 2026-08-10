// يفعّل تحقق البريد الإلكتروني للعميل أو السفير عبر رابط مرسَل بالبريد
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  try {
    await ensureTables();
    const sql = getSql();
    const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
    const kind = (event.queryStringParameters && event.queryStringParameters.kind) || 'customer';
    if (!token) return { statusCode: 400, headers, body: '<h2>رابط غير صالح</h2>' };

    if (kind === 'affiliate') {
      const rows = await sql`SELECT code FROM affiliates WHERE verify_token = ${token}`;
      if (!rows.length) return { statusCode: 200, headers, body: '<h2 style="font-family:sans-serif; text-align:center; margin-top:80px;">⚠️ الرابط غير صالح أو مستخدم مسبقاً</h2>' };
      await sql`UPDATE affiliates SET email_verified = true, verify_token = NULL WHERE code = ${rows[0].code}`;
    } else {
      const rows = await sql`SELECT id FROM subscriptions WHERE verify_token = ${token}`;
      if (!rows.length) return { statusCode: 200, headers, body: '<h2 style="font-family:sans-serif; text-align:center; margin-top:80px;">⚠️ الرابط غير صالح أو مستخدم مسبقاً</h2>' };
      await sql`UPDATE subscriptions SET email_verified = true, verify_token = NULL WHERE id = ${rows[0].id}`;
    }

    return { statusCode: 200, headers, body: '<html dir="rtl" lang="ar"><body style="font-family:Tajawal,Arial,sans-serif; background:#070d18; color:#e9edf5; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="text-align:center;"><div style="font-size:50px;">✅</div><h2>تم تأكيد بريدك الإلكتروني بنجاح</h2><p style="color:#aab3c5;">يمكنك إغلاق هذه الصفحة الآن.</p></div></body></html>' };
  } catch (e) {
    return { statusCode: 500, headers, body: '<h2>خطأ: ' + String(e) + '</h2>' };
  }
};
