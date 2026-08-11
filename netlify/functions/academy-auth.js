// تسجيل / دخول متدرب الأكاديمية — مستقل عن اشتراك العميل
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { verifyPassword, hashPassword, isHashed } = require('./_auth');
const { sendMail } = require('./_mailer');

const RANKS = ['مبتدئ', 'متمرّس', 'خبير', 'خرّيج O P N LIO'];
function rankForLevel(level) {
  if (level >= 20) return RANKS[3];
  if (level >= 14) return RANKS[2];
  if (level >= 7) return RANKS[1];
  return RANKS[0];
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    if (action === 'register') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      const lang = String(body.lang || 'ar');
      if (!email || !name || password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البيانات غير مكتملة أو كلمة المرور قصيرة' }) };
      }
      const existing = await sql`SELECT id FROM academy_students WHERE email = ${email}`;
      if (existing.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'هذا البريد مسجّل بالفعل' }) };
      }
      const rows = await sql`INSERT INTO academy_students (email, name, password_hash, lang, agreed_terms_at) VALUES (${email}, ${name}, ${hashPassword(password)}, ${lang}, now()) RETURNING id`;
      const verifyToken = crypto.randomBytes(24).toString('hex');
      await sql`UPDATE academy_students SET verify_token = ${verifyToken}, verify_token_created_at = now() WHERE id = ${rows[0].id}`;
      const verifyLink = 'https://opnlio.com/.netlify/functions/verify-email?kind=academy&token=' + verifyToken;
      await sql`INSERT INTO academy_progress (student_id, level_num) VALUES (${rows[0].id}, 1)`;
      sendMail(email, 'مرحباً بك في أكاديمية O P N LIO 🎓', `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;">مرحباً ${name}،<br><br>سجّلت الآن في البرنامج التدريبي المجاني لأكاديمية O P N LIO. يرجى تأكيد بريدك الإلكتروني أولاً (الرابط صالح 120 ثانية فقط):<br><br><a href="${verifyLink}" style="color:#D4AF37; font-weight:800;">تأكيد البريد الإلكتروني ⚜</a><br><br>ثم ابدأ رحلتك من المستوى الأول لتصل إلى رتبة "محترف O P N LIO".</div>`).catch(()=>{});
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const rows = await sql`SELECT * FROM academy_students WHERE email = ${email}`;
      if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
        return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
      }
      const s = rows[0];
      if (!s.email_verified) {
        return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'يرجى تأكيد بريدك الإلكتروني أولاً — تحقق من صندوق الوارد أو اطلب رابطاً جديداً.', needsVerification: true }) };
      }
      if (!isHashed(s.password_hash)) await sql`UPDATE academy_students SET password_hash = ${hashPassword(password)} WHERE id = ${s.id}`;
      await sql`UPDATE academy_students SET last_login_at = now() WHERE id = ${s.id}`;
      const progress = await sql`SELECT level_num, completed, score FROM academy_progress WHERE student_id = ${s.id} ORDER BY level_num ASC`;
      const secret = process.env.AFFILIATE_SESSION_SECRET || s.password_hash;
      const token = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + s.email).digest('hex');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, student: { id: s.id, name: s.name, email: s.email, points: s.points, current_level: s.current_level, rank: s.rank, graduated_at: s.graduated_at, discount_code: s.discount_code }, progress }) };
    }

    if (action === 'complete-level') {
      const { studentId, level, score } = body;
      if (!studentId || !level || score == null) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      if (score < 70) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'النتيجة أقل من 70% — حاول مرة أخرى' }) };

      await sql`INSERT INTO academy_progress (student_id, level_num, completed, score, completed_at) VALUES (${studentId}, ${level}, true, ${score}, now())
                ON CONFLICT (student_id, level_num) DO UPDATE SET completed = true, score = ${score}, completed_at = now()`;

      const pointsEarned = 50 + Math.round(score / 2);
      const nextLevel = Math.min(level + 1, 20);
      const newRank = rankForLevel(level);
      let graduated = level >= 20;
      let discountCode = null;

      if (graduated) {
        discountCode = process.env.PADDLE_GRADUATE_DISCOUNT_ID || 'dsc_01kzqv94x5d3t04dt15g43pths';
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank}, graduated_at = now(), discount_code = ${discountCode} WHERE id = ${studentId}`;
      } else {
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank} WHERE id = ${studentId}`;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pointsEarned, nextLevel, rank: newRank, graduated, discountCode }) };
    }

    if (action === 'forgot-password') {
      const email = String(body.email || '').trim().toLowerCase();
      const lang = String(body.lang || 'ar');
      const rows = await sql`SELECT id, name FROM academy_students WHERE email = ${email}`;
      if (rows.length > 0) {
        const tempPassword = Math.random().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(-4);
        await sql`UPDATE academy_students SET password_hash = ${hashPassword(tempPassword)} WHERE id = ${rows[0].id}`;
        sendMail(email, 'استعادة كلمة المرور — O P N LIO', `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;">مرحباً ${rows[0].name}،<br><br>كلمة مرورك الجديدة المؤقتة: <b style="color:#D4AF37; font-size:18px;">${tempPassword}</b><br><br>سجّل الدخول بها ويمكنك تغييرها لاحقاً من لوحة تحكمك.</div>`, null, lang).catch(()=>{});
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'recover-number') {
      const email = String(body.email || '').trim().toLowerCase();
      const lang = String(body.lang || 'ar');
      const rows = await sql`SELECT id, name FROM academy_students WHERE email = ${email}`;
      if (rows.length > 0) {
        sendMail(email, 'رقم عضويتك — O P N LIO', `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;">مرحباً ${rows[0].name}،<br><br>رقم عضويتك في O P N LIO هو: <b style="color:#D4AF37; font-size:18px;">${rows[0].id}</b></div>`, null, lang).catch(()=>{});
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'resend-verification') {
      const email = String(body.email || '').trim().toLowerCase();
      const rows = await sql`SELECT id, name FROM academy_students WHERE email = ${email} AND email_verified = false`;
      if (rows.length > 0) {
        const verifyToken = crypto.randomBytes(24).toString('hex');
        await sql`UPDATE academy_students SET verify_token = ${verifyToken}, verify_token_created_at = now() WHERE id = ${rows[0].id}`;
        const verifyLink = 'https://opnlio.com/.netlify/functions/verify-email?kind=academy&token=' + verifyToken;
        sendMail(email, 'رابط تأكيد جديد — O P N LIO', `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;">مرحباً ${rows[0].name}،<br><br>رابط تأكيد بريدك الإلكتروني الجديد (صالح 120 ثانية):<br><br><a href="${verifyLink}" style="color:#D4AF37; font-weight:800;">تأكيد البريد الإلكتروني ⚜</a></div>`).catch(()=>{});
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
