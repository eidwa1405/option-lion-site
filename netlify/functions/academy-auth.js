// تسجيل / دخول متدرب الأكاديمية — مستقل عن اشتراك العميل
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { verifyPassword, hashPassword, isHashed } = require('./_auth');
const { sendMail } = require('./_mailer');

const RANKS = ['مبتدئ', 'متمرّس', 'خبير', 'خرّيج O P N LIO'];
function rankForLevel(level) {
  if (level >= 13) return RANKS[3];
  if (level >= 9) return RANKS[2];
  if (level >= 5) return RANKS[1];
  return RANKS[0];
}

const QUIZ_ANSWERS = {"1":[1,1,1,1,1],"2":[0,1,1,1],"3":[1,1,1,1],"4":[1,1,1,1],"5":[1,1,1,0],"6":[1,1,0,1],"7":[1,1,1,1,1],"8":[1,0,0,1],"9":[1,0,1,1],"10":[1,1,1,1],"11":[1,1,1],"12":[1,0,1,1],"13":[1,1,1]};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS phone text`;
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    if (action === 'register') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      const lang = String(body.lang || 'ar');
      const phone = String(body.phone || '').trim();
      if (!email || !name || password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البيانات غير مكتملة أو كلمة المرور قصيرة' }) };
      }
      const existing = await sql`SELECT id FROM academy_students WHERE email = ${email}`;
      if (existing.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'هذا البريد مسجّل بالفعل' }) };
      }
      const rows = await sql`INSERT INTO academy_students (email, name, password_hash, lang, agreed_terms_at, email_verified, phone) VALUES (${email}, ${name}, ${hashPassword(password)}, ${lang}, now(), true, ${phone || null}) RETURNING id`;
      await sql`INSERT INTO academy_progress (student_id, level_num) VALUES (${rows[0].id}, 1)`;
      sendMail(email, 'مرحباً بك في أكاديمية O P N LIO 🎓', `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;">مرحباً ${name}،<br><br>تم إنشاء عضويتك في أكاديمية O P N LIO بنجاح ⚜<br><br>سجّل دخولك الآن وابدأ رحلتك من المستوى الأول — عند تسجيل الدخول سيصلك رمز تحقق سريع على هذا البريد.</div>`).catch(()=>{});
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      await sql`CREATE TABLE IF NOT EXISTS login_attempts (email text, created_at timestamptz DEFAULT now())`;
      const fails = await sql`SELECT COUNT(*)::int AS c FROM login_attempts WHERE email = ${email} AND created_at > now() - interval '15 minutes'`;
      if (fails[0].c >= 5) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'محاولات كثيرة خاطئة — انتظر 15 دقيقة ثم حاول مجدداً' }) };
      const rows = await sql`SELECT * FROM academy_students WHERE email = ${email}`;
      if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
        await sql`INSERT INTO login_attempts (email) VALUES (${email})`;
        return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'بيانات الدخول غير صحيحة' }) };
      }
      await sql`DELETE FROM login_attempts WHERE email = ${email}`;
      const s = rows[0];
      if (!isHashed(s.password_hash)) await sql`UPDATE academy_students SET password_hash = ${hashPassword(password)} WHERE id = ${s.id}`;
      await sql`UPDATE academy_students SET last_login_at = now() WHERE id = ${s.id}`;
      const progress = await sql`SELECT level_num, completed, score FROM academy_progress WHERE student_id = ${s.id} ORDER BY level_num ASC`;
      const secret = process.env.AFFILIATE_SESSION_SECRET || s.password_hash;
      const token = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + s.email).digest('hex');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, student: { id: s.id, name: s.name, email: s.email, paid: !!s.paid_at, points: s.points, current_level: s.current_level, rank: s.rank, graduated_at: s.graduated_at, discount_code: s.discount_code }, progress }) };
    }

    if (action === 'complete-level') {
      const { studentId, level, token, answers } = body;
      if (!studentId || !level || !Array.isArray(answers)) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stRows = await sql`SELECT id, email, password_hash, paid_at FROM academy_students WHERE id = ${studentId}`;
      if (!stRows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الحساب غير موجود' }) };
      const stu = stRows[0];
      const secret2 = process.env.AFFILIATE_SESSION_SECRET || stu.password_hash;
      const dates = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okTok = token && dates.some(d => crypto.createHmac('sha256', secret2).update(d + stu.email).digest('hex') === String(token));
      if (!okTok) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true, error: 'انتهت الجلسة — سجّل دخولك مجدداً' }) };
      if (!stu.paid_at) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, needsPayment: true, error: 'يجب دفع رسم التسجيل ($1 +15%) أولاً' }) };
      const key = QUIZ_ANSWERS[level];
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'مستوى غير معروف' }) };
      let correctCount = 0;
      key.forEach((c, i) => { if (Number(answers[i]) === c) correctCount++; });
      const score = Math.round((correctCount / key.length) * 100);
      if (score < 70) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, score, error: 'النتيجة أقل من 70% — حاول مرة أخرى' }) };

      await sql`INSERT INTO academy_progress (student_id, level_num, completed, score, completed_at) VALUES (${studentId}, ${level}, true, ${score}, now())
                ON CONFLICT (student_id, level_num) DO UPDATE SET completed = true, score = ${score}, completed_at = now()`;

      const pointsEarned = 50 + Math.round(score / 2);
      const nextLevel = Math.min(level + 1, 14);
      const newRank = rankForLevel(level);
      let graduated = level >= 13;
      let discountCode = null;

      if (graduated) {
        discountCode = process.env.PADDLE_GRADUATE_DISCOUNT_ID || 'dsc_01kzqv94x5d3t04dt15g43pths';
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank}, graduated_at = now(), discount_code = ${discountCode} WHERE id = ${studentId}`;
      } else {
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank} WHERE id = ${studentId}`;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, score, pointsEarned, nextLevel, rank: newRank, graduated, discountCode }) };
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

    if (action === 'check-paid') {
      const email = String(body.email || '').trim().toLowerCase();
      const rows = await sql`SELECT paid_at FROM academy_students WHERE email = ${email}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paid: rows.length > 0 && !!rows[0].paid_at }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
