// أداة إرسال بريد موحّدة عبر SMTP (حساب Gmail الرسمي لأسد الأوبشن)
const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER || 'opon.netlify@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'bdqoxxskjxwcdpuo';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return transporter;
}

// أيقونة CC للدولة من رمز الاتصال الهاتفي (تقريبي، يغطي الدول الأكثر استخداماً)
const CC_TO_ISO2 = {
  '+966':'sa','+971':'ae','+965':'kw','+974':'qa','+973':'bh','+968':'om','+962':'jo','+961':'lb',
  '+20':'eg','+212':'ma','+213':'dz','+216':'tn','+218':'ly','+964':'iq','+970':'ps','+249':'sd',
  '+1':'us','+44':'gb','+49':'de','+33':'fr','+34':'es','+351':'pt','+39':'it','+90':'tr',
  '+91':'in','+92':'pk','+62':'id','+60':'my','+63':'ph','+86':'cn','+81':'jp','+82':'kr',
  '+7':'ru','+380':'ua','+27':'za','+55':'br','+52':'mx','+61':'au'
};

function isoFromPhone(phone) {
  if (!phone) return 'xx';
  const match = String(phone).match(/^(\+\d{1,4})/);
  if (!match) return 'xx';
  let cc = match[1];
  while (cc.length > 1) {
    if (CC_TO_ISO2[cc]) return CC_TO_ISO2[cc];
    cc = cc.slice(0, -1);
  }
  return 'xx';
}

async function nextCustomerId(sql, phone) {
  const iso = isoFromPhone(phone);
  for (let attempt = 0; attempt < 10; attempt++) {
    const rand = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
    const cid = iso + rand;
    const exists = await sql`SELECT id FROM subscriptions WHERE customer_id = ${cid} LIMIT 1`;
    if (exists.length === 0) return cid;
  }
  // احتياطي نادر إذا تكررت كل المحاولات
  return iso + String(Date.now()).slice(-7);
}

const BRAND = {
  logo: 'https://opon.netlify.app/assets/lion-logo.jpg',
  gold: '#D4AF37',
  bg: '#070d18'
};

function emailShell(lang, titleHtml, bodyHtml) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><body style="margin:0;padding:0;background:#0d1220;font-family:Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#0d1220;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" style="max-width:92%;background:linear-gradient(160deg,rgba(212,175,55,.08),rgba(255,255,255,.02));border:1px solid rgba(212,175,55,.3);border-radius:18px;overflow:hidden;">
        <tr><td style="background:#070d18;padding:26px 30px;text-align:center;border-bottom:1px solid rgba(212,175,55,.25);">
          <img src="${BRAND.logo}" width="52" height="52" style="border-radius:50%;border:2px solid ${BRAND.gold};" alt="أسد الأوبشن">
          <div style="color:#f4f0e4;font-weight:900;font-size:17px;margin-top:10px;letter-spacing:.5px;">أسد الأوبشن ⚜ Option Lion</div>
        </tr></td></tr>
        <tr><td style="padding:32px 30px;color:#e9edf5;">
          <h2 style="color:${BRAND.gold};font-size:20px;margin:0 0 16px;">${titleHtml}</h2>
          <div style="font-size:14.5px;line-height:1.9;color:#c9d2e3;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="background:#070d18;padding:20px 30px;text-align:center;border-top:1px solid rgba(255,255,255,.08);">
          <div style="font-size:12px;color:#6b7488;">© 2026 أسد الأوبشن ⚜ Option Lion — جميع الحقوق محفوظة</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendMail(to, subject, titleHtml, bodyHtml, lang) {
  if (!to) return { skipped: true };
  const html = emailShell(lang || 'ar', titleHtml, bodyHtml);
  try {
    await getTransporter().sendMail({
      from: '"أسد الأوبشن ⚜ Option Lion" <' + SMTP_USER + '>',
      to, subject, html
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

module.exports = { sendMail, emailShell, nextCustomerId, isoFromPhone };
