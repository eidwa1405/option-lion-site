// تسجيل / دخول متدرب الأكاديمية — مستقل عن اشتراك العميل
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { verifyPassword, hashPassword, isHashed } = require('./_auth');
const { sendMail } = require('./_mailer');

const RANKS = ['مبتدئ', 'متمرّس', 'خبير', 'خرّيج O P N LIO'];
function rankForLevel(level) {
  if (level >= 11) return RANKS[3];
  if (level >= 8) return RANKS[2];
  if (level >= 4) return RANKS[1];
  return RANKS[0];
}

function certNumberFor(id) {
  const secret = process.env.AFFILIATE_SESSION_SECRET || 'opnlio-cert';
  const h = crypto.createHmac('sha256', secret).update('cert:' + id).digest('hex').slice(0, 4).toUpperCase();
  return 'OPNLIO-' + String(id).padStart(6, '0') + '-' + h;
}

const QUIZ_ANSWERS = {"1":[1,1,1,1,1,1,0,1,0,1,0,0],"2":[0,1,1,1,2,0,0,1,0,1,1,0],"3":[1,1,1,1,1,0,0,1,0,0,0,0],"4":[1,1,1,1,1,0,0,0,1,0,0,0],"5":[1,1,1,0,1,2,0,0,0,0,0,0],"6":[1,1,0,1,0,1,0,0,0,0,0,0],"7":[1,1,1,1,1,0,0,0,0,0],"8":[1,0,0,1,1,1,0,0,0,0],"9":[1,0,1,1,0,1,0,0,0,0],"10":[1,1,1,1,0,1,0,0,0,0],"11":[1,1,1,0,1,0,0,1,0,0,0,0]};
const CLOCK_QUIZ_ANSWERS = {"1":[1,1,1,0,0,1],"2":[1,1,1,1,1,0],"3":[1,0,0,1,1,1],"4":[1,1,0,0,1,1],"5":[1,1,1,0,1,1],"6":[1,1,0,0,1,1],"7":[1,0,1,1,0,0],"8":[0,1,0,0,0,1],"9":[0,1,1,1,1,0],"10":[1,1,1,1,1,0]};

const FREE_QUIZ_ANSWERS = {"1":[1,2,1,0,0,0,0],"2":[2,0,3,0,0,0,0,0],"3":[3,0,1,0,0,0,0],"4":[1,0,2,1,0,0,0,0],"5":[1,1,0,1,1,1],"6":[1,0,1,0,0,1]};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    await ensureTables();
    const sql = getSql();
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS paid_at timestamptz`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS phone text`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS referred_by text`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS member_ref text`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS cert_number text`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS free_graduated_at timestamptz`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS last_ip text`;
    await sql`CREATE TABLE IF NOT EXISTS amb_messages (id serial PRIMARY KEY, code text, student_id int, sender text, body text, read_by_amb boolean DEFAULT false, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS member_messages (id serial PRIMARY KEY, student_id int, ref_code text, sender text, body text, read_by_member boolean DEFAULT false, read_by_peer boolean DEFAULT false, created_at timestamptz DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mm_student ON member_messages (student_id)`;
    await sql`CREATE TABLE IF NOT EXISTS graduation_devices (id serial PRIMARY KEY, student_id int, device_hash text, ip text, created_at timestamptz DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS academy_clock_progress (student_id int, level_num int, completed boolean DEFAULT false, score int, completed_at timestamptz, UNIQUE(student_id, level_num))`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS clock_graduated_at timestamptz`;
    await sql`CREATE TABLE IF NOT EXISTS academy_free_progress (student_id int, level_num int, completed boolean DEFAULT false, score int, completed_at timestamptz, UNIQUE(student_id, level_num))`;
    await sql`CREATE TABLE IF NOT EXISTS ambassador_requests (id serial PRIMARY KEY, student_id int, status text DEFAULT 'pending', code text, created_at timestamptz DEFAULT now(), decided_at timestamptz)`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS signature text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS agreement_at timestamptz`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_name text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_iban text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_bank text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_swift text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_addr text`;
    await sql`ALTER TABLE ambassador_requests ADD COLUMN IF NOT EXISTS bank_country text`;
    await sql`CREATE TABLE IF NOT EXISTS member_notifications (id serial PRIMARY KEY, student_id int, title text, body text, created_at timestamptz DEFAULT now(), read boolean DEFAULT false)`;
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    if (action === 'register') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      const lang = String(body.lang || 'ar');
      const phone = String(body.phone || '').trim();
      const referredBy = String(body.referredBy || '').trim().toUpperCase().slice(0, 30) || null;
      if (!email || !name || password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'البيانات غير مكتملة أو كلمة المرور قصيرة' }) };
      }
      const existing = await sql`SELECT id FROM academy_students WHERE email = ${email}`;
      if (existing.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'هذا البريد مسجّل بالفعل' }) };
      }
      const rows = await sql`INSERT INTO academy_students (email, name, password_hash, lang, agreed_terms_at, email_verified, phone, referred_by, member_ref, last_ip) VALUES (${email}, ${name}, ${hashPassword(password)}, ${lang}, now(), true, ${phone || null}, ${referredBy}, ${String(Math.floor(1000000 + Math.random()*9000000))}, ${event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || null}) RETURNING id`;
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
      await sql`UPDATE academy_students SET last_login_at = now(), last_ip = COALESCE(${event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || event.headers['x-forwarded-for'] || null}, last_ip) WHERE id = ${s.id}`;
      const progress = await sql`SELECT level_num, completed, score FROM academy_progress WHERE student_id = ${s.id} ORDER BY level_num ASC`;
      const freeProgress = await sql`SELECT level_num, completed, score FROM academy_free_progress WHERE student_id = ${s.id} ORDER BY level_num ASC`;
      const clockProgress = await sql`SELECT level_num, completed, score FROM academy_clock_progress WHERE student_id = ${s.id} ORDER BY level_num ASC`;
      let subActive = false;
      try {
        const subRows = await sql`SELECT status FROM subscriptions WHERE lower(email) = ${String(s.email).toLowerCase()} ORDER BY created_at DESC LIMIT 1`;
        if (subRows.length){ const st = String(subRows[0].status || '').toLowerCase(); subActive = st === 'active' || st === 'trial' || st.indexOf('renew_') === 0; }
      } catch(e){}
      const secret = process.env.AFFILIATE_SESSION_SECRET || s.password_hash;
      const token = crypto.createHmac('sha256', secret).update(new Date().toISOString().slice(0, 10) + s.email).digest('hex');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token, student: { id: s.id, name: s.name, email: s.email, paid: !!s.paid_at, points: s.points, current_level: s.current_level, rank: s.rank, graduated_at: s.graduated_at, discount_code: s.discount_code, cert_number: s.cert_number, referred_by: s.referred_by, member_ref: s.member_ref || s.id, free_graduated_at: s.free_graduated_at , subActive: subActive, clockPaid: !!s.clock_paid_at }, progress, freeProgress, clockProgress }) };
    }

    if (action === 'complete-level') {
      const { studentId, level, token, answers } = body;
      if (!studentId || !level || (!Array.isArray(answers) && !Array.isArray(body.picks))) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
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
      const picksArr = Array.isArray(body.picks) ? body.picks : null;
      let correctCount = 0, gradedTotal = key.length, corrections = [];
      if (picksArr) {
        if (picksArr.length < Math.min(6, key.length)) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'عدد الأسئلة غير مكتمل' }) };
        gradedTotal = picksArr.length;
        picksArr.forEach(p => { const ci = key[Number(p.i)]; if (ci !== undefined && Number(p.a) === ci) correctCount++; else corrections.push({ i: Number(p.i), correct: ci }); });
      } else {
        key.forEach((c, i) => { if (Number(answers[i]) === c) correctCount++; else corrections.push({ i: i, correct: c }); });
      }
      const score = Math.round((correctCount / gradedTotal) * 100);
      if (score < 70) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, score, error: 'النتيجة أقل من 70% — حاول مرة أخرى' }) };

      await sql`INSERT INTO academy_progress (student_id, level_num, completed, score, completed_at) VALUES (${studentId}, ${level}, true, ${score}, now())
                ON CONFLICT (student_id, level_num) DO UPDATE SET completed = true, score = ${score}, completed_at = now()`;

      const pointsEarned = 50 + Math.round(score / 2);
      const nextLevel = Math.min(level + 1, 12);
      const newRank = rankForLevel(level);
      let graduated = level >= 11;
      let discountCode = null;
      let certNumber = null;

      if (graduated) {
        const gradDevice = String(body.deviceId || '').slice(0, 64);
        const gradIp = String((event.headers && (event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0])) || '').trim().slice(0, 45);
        let discountBlocked = false;
        if (gradDevice && gradDevice !== 'dev-na') {
          const devDup = await sql`SELECT student_id FROM graduation_devices WHERE device_hash = ${gradDevice} AND student_id != ${studentId} LIMIT 1`;
          if (devDup.length) discountBlocked = true;
        }
        if (!discountBlocked && gradIp) {
          const ipDup = await sql`SELECT student_id FROM graduation_devices WHERE ip = ${gradIp} AND student_id != ${studentId} LIMIT 1`;
          if (ipDup.length) discountBlocked = true;
        }
        discountCode = discountBlocked ? null : (process.env.PADDLE_GRADUATE_DISCOUNT_ID || 'dsc_01kzqv94x5d3t04dt15g43pths');
        if (discountBlocked) await sql`INSERT INTO audit_log (action, details) VALUES ('graduate-discount-blocked', ${'حجب خصم التخرج 60% عن الطالب #' + studentId + ' — تخرج سابق من نفس الجهاز/العنوان (' + (gradDevice || '-') + ' / ' + (gradIp || '-') + ')'})`;
        await sql`INSERT INTO graduation_devices (student_id, device_hash, ip) VALUES (${studentId}, ${gradDevice || null}, ${gradIp || null})`;
        certNumber = certNumberFor(studentId);
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank}, graduated_at = now(), discount_code = ${discountCode}, cert_number = ${certNumber} WHERE id = ${studentId}`;
      } else {
        await sql`UPDATE academy_students SET points = points + ${pointsEarned}, current_level = ${nextLevel}, rank = ${newRank} WHERE id = ${studentId}`;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, score, pointsEarned, nextLevel, rank: newRank, graduated, discountCode, certNumber, corrections }) };
    }

    if (action === 'complete-free-level') {
      const { studentId, level, token, answers } = body;
      if (!studentId || !level || (!Array.isArray(answers) && !Array.isArray(body.picks))) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stRows2 = await sql`SELECT id, email, password_hash FROM academy_students WHERE id = ${studentId}`;
      if (!stRows2.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الحساب غير موجود' }) };
      const stu2 = stRows2[0];
      const secret3 = process.env.AFFILIATE_SESSION_SECRET || stu2.password_hash;
      const dates2 = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okTok2 = token && dates2.some(d => crypto.createHmac('sha256', secret3).update(d + stu2.email).digest('hex') === String(token));
      if (!okTok2) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true, error: 'انتهت الجلسة — سجّل دخولك مجدداً' }) };
      const key2 = FREE_QUIZ_ANSWERS[level];
      if (!key2) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'مستوى غير معروف' }) };
      const picksArr2 = Array.isArray(body.picks) ? body.picks : null;
      let correctCount2 = 0, gradedTotal2 = key2.length, corrections2 = [];
      if (picksArr2) {
        if (picksArr2.length < Math.min(3, key2.length)) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'عدد الأسئلة غير مكتمل' }) };
        gradedTotal2 = picksArr2.length;
        picksArr2.forEach(p => { const ci = key2[Number(p.i)]; if (ci !== undefined && Number(p.a) === ci) correctCount2++; else corrections2.push({ i: Number(p.i), correct: ci }); });
      } else {
        key2.forEach((c, i) => { if (Number(answers[i]) === c) correctCount2++; else corrections2.push({ i: i, correct: c }); });
      }
      const score2 = Math.round((correctCount2 / gradedTotal2) * 100);
      if (score2 < 70) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, score: score2, error: 'النتيجة أقل من 70% — حاول مرة أخرى' }) };
      await sql`INSERT INTO academy_free_progress (student_id, level_num, completed, score, completed_at) VALUES (${studentId}, ${level}, true, ${score2}, now())
                ON CONFLICT (student_id, level_num) DO UPDATE SET completed = true, score = ${score2}, completed_at = now()`;
      const allFree = await sql`SELECT level_num FROM academy_free_progress WHERE student_id = ${studentId} AND completed = true`;
      const doneSet = new Set(allFree.map(r => r.level_num));
      const graduatedFree = [1,2,3,4,5,6].every(n => doneSet.has(n));
      if (graduatedFree) await sql`UPDATE academy_students SET free_graduated_at = now() WHERE id = ${studentId} AND free_graduated_at IS NULL`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, score: score2, graduated: graduatedFree, corrections: corrections2 }) };
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

    if (action === 'request-ambassador') {
      const { studentId, token, agreementAccepted, signature, bankName, bankIban, bankBank, bankCountry, bankSwift, bankAddr } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stRows3 = await sql`SELECT id, name, email, password_hash, free_graduated_at FROM academy_students WHERE id = ${studentId}`;
      if (!stRows3.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الحساب الدافع غير موجود' }) };
      const stu3 = stRows3[0];
      const secret4 = process.env.AFFILIATE_SESSION_SECRET || stu3.password_hash;
      const dates3 = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okTok3 = token && dates3.some(d => crypto.createHmac('sha256', secret4).update(d + stu3.email).digest('hex') === String(token));
      if (!okTok3) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true, error: 'انتهت الجلسة' }) };
      if (!stu3.free_graduated_at) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'يجب إتمام مسار O P N LIO المجاني أولاً' }) };
      const existing2 = await sql`SELECT id, status FROM ambassador_requests WHERE student_id = ${studentId} ORDER BY created_at DESC LIMIT 1`;
      if (existing2.length && existing2[0].status === 'pending') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'pending' }) };
      if (existing2.length && existing2[0].status === 'approved') return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'approved' }) };
      const rejs = await sql`SELECT decided_at FROM ambassador_requests WHERE student_id = ${studentId} AND status = 'rejected' AND COALESCE(reject_kind,'nofit') = 'nofit' AND decided_at IS NOT NULL ORDER BY decided_at DESC`;
      if (rejs.length) {
        const waitDays = rejs.length >= 2 ? 30 : 7;
        const readyAt = new Date(rejs[0].decided_at).getTime() + waitDays * 86400000;
        if (Date.now() < readyAt) {
          const remainDays = Math.max(1, Math.ceil((readyAt - Date.now()) / 86400000));
          return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'لا يمكن إعادة التقديم الآن — متاح بعد ' + remainDays + ' يوم (' + (rejs.length >= 2 ? 'شهر كامل بعد الرفض المتكرر' : 'أسبوع بعد الرفض الأول') + ')' }) };
        }
      }
      if (!agreementAccepted || !signature || String(signature).indexOf('data:image/png') !== 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'يجب قراءة الاتفاقية والتوقيع عليها والإقرار بالموافقة قبل إرسال الطلب' }) };
      }
      const cleanSig = String(signature).slice(0, 80000);
      const bName = String(bankName || '').trim().slice(0, 120);
      const bIban = String(bankIban || '').trim().toUpperCase().slice(0, 64);
      const bBank = String(bankBank || '').trim().slice(0, 120);
      const bSwift = String(bankSwift || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
      const bAddr = String(bankAddr || '').trim().slice(0, 200);
      const bCountry = String(bankCountry || '').trim().slice(0, 60);
      if (bName.length < 6 || bIban.replace(/[^A-Z0-9]/g, '').length < 10 || bBank.length < 3 || bCountry.length < 2 || bSwift.length < 8 || bAddr.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات الحساب البنكي ناقصة أو غير صحيحة (الاسم، IBAN، البنك، SWIFT، العنوان) — تُدرَج نصاً داخل الاتفاقية ويتحمل مالك الحساب صحتها' }) };
      }
      await sql`INSERT INTO ambassador_requests (student_id, status, signature, agreement_at, bank_name, bank_iban, bank_bank, bank_country, bank_swift, bank_addr) VALUES (${studentId}, 'pending', ${cleanSig}, now(), ${bName}, ${bIban}, ${bBank}, ${bCountry}, ${bSwift}, ${bAddr})`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'pending' }) };
    }

    if (action === 'heartbeat' || action === 'go-offline') {
      const { studentId } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false }) };
      await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`;
      if (action === 'heartbeat') await sql`UPDATE academy_students SET last_seen_at = now() WHERE id = ${studentId}`;
      else await sql`UPDATE academy_students SET last_seen_at = now() - interval '10 minutes' WHERE id = ${studentId}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'get-notifications') {
      const { studentId, token } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stRows4 = await sql`SELECT id, email, password_hash FROM academy_students WHERE id = ${studentId}`;
      if (!stRows4.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, notifications: [] }) };
      const stu4 = stRows4[0];
      const secret5 = process.env.AFFILIATE_SESSION_SECRET || stu4.password_hash;
      const dates4 = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okTok4 = token && dates4.some(d => crypto.createHmac('sha256', secret5).update(d + stu4.email).digest('hex') === String(token));
      if (!okTok4) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true }) };
      const notifs = await sql`SELECT id, title, body, created_at, read FROM member_notifications WHERE student_id = ${studentId} OR student_id IS NULL ORDER BY created_at DESC LIMIT 30`;
      const ambReq = await sql`SELECT status, code FROM ambassador_requests WHERE student_id = ${studentId} ORDER BY created_at DESC LIMIT 1`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, notifications: notifs, ambassadorStatus: ambReq.length ? ambReq[0].status : null, ambassadorCode: ambReq.length ? ambReq[0].code : null }) };
    }

    if (action === 'send-amb-message' || action === 'my-amb-messages') {
      const { studentId, token } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stM = await sql`SELECT id, name, email, password_hash FROM academy_students WHERE id = ${studentId}`;
      if (!stM.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const uM = stM[0];
      const secM = process.env.AFFILIATE_SESSION_SECRET || uM.password_hash;
      const dM = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okM = token && dM.some(d => crypto.createHmac('sha256', secM).update(d + uM.email).digest('hex') === String(token));
      if (!okM) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true }) };
      const ambM = await sql`SELECT code FROM ambassador_requests WHERE student_id = ${studentId} AND status = 'approved' ORDER BY created_at DESC LIMIT 1`;
      if (!ambM.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'لست سفيراً معتمداً' }) };
      const codeM = ambM[0].code;
      if (action === 'my-amb-messages') {
        const msgs = await sql`SELECT id, sender, body, created_at FROM amb_messages WHERE code = ${codeM} ORDER BY created_at ASC LIMIT 200`;
        await sql`UPDATE amb_messages SET read_by_amb = true WHERE code = ${codeM} AND sender = 'admin'`;
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messages: msgs }) };
      }
      const textM = String(body.text || '').trim().slice(0, 2000);
      if (!textM) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الرسالة فارغة' }) };
      const recentM = await sql`SELECT COUNT(*)::int AS c FROM amb_messages WHERE code = ${codeM} AND sender = 'ambassador' AND created_at > now() - interval '5 minutes'`;
      if (recentM[0].c >= 5) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'أرسلت رسائل كثيرة — انتظر قليلاً' }) };
      const insM = await sql`INSERT INTO amb_messages (code, student_id, sender, body) VALUES (${codeM}, ${studentId}, 'ambassador', ${textM}) RETURNING id`;
      const tgTokM = process.env.TELEGRAM_BOT_TOKEN, tgChatM = process.env.TELEGRAM_CHAT_ID;
      if (tgTokM && tgChatM) {
        const noteM = '📩 رسالة من السفير ' + (uM.name || '') + ' (' + codeM + ')\n\n' + textM + '\n\n#T' + codeM + '\n↩️ ردّ على هذه الرسالة مباشرة ليصله ردّك.';
        try { await fetch('https://api.telegram.org/bot' + tgTokM + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChatM, text: noteM }) }); } catch (e) {}
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: insM[0].id }) };
    }

    if (action === 'complete-clock-level') {
      const { studentId, level, picks } = body;
      if (!studentId || !level) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const key = CLOCK_QUIZ_ANSWERS[String(level)];
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'مستوى غير معروف' }) };
      const arr = Array.isArray(picks) ? picks : [];
      let correct = 0;
      const wrong = [];
      for (let i = 0; i < key.length; i++) { if (Number(arr[i]) === key[i]) correct++; else wrong.push(i); }
      const score = Math.round((correct / key.length) * 100);
      if (score < 70) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, score, wrong, error: 'النتيجة أقل من 70% — راجع الدرس وحاول مجدداً' }) };
      await sql`INSERT INTO academy_clock_progress (student_id, level_num, completed, score, completed_at) VALUES (${studentId}, ${level}, true, ${score}, now()) ON CONFLICT (student_id, level_num) DO UPDATE SET completed = true, score = GREATEST(academy_clock_progress.score, ${score}), completed_at = now()`;
      const doneRows = await sql`SELECT COUNT(*)::int AS c FROM academy_clock_progress WHERE student_id = ${studentId} AND completed = true`;
      const graduated = doneRows[0].c >= 10;
      if (graduated) await sql`UPDATE academy_students SET clock_graduated_at = COALESCE(clock_graduated_at, now()) WHERE id = ${studentId}`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, score, wrong, nextLevel: Math.min(level + 1, 11), graduated }) };
    }

    if (action === 'member-thread' || action === 'member-chat-send') {
      const { studentId } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const meRows = await sql`SELECT id, name, email, member_ref FROM academy_students WHERE id = ${studentId} LIMIT 1`;
      if (!meRows.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'الحساب غير موجود' }) };
      const me = meRows[0];
      const myRef = me.member_ref || null;
      let peerName = null;
      if (myRef) {
        const aff = await sql`SELECT name FROM affiliates WHERE code = ${myRef} LIMIT 1`;
        peerName = aff.length ? aff[0].name : null;
      }
      if (action === 'member-thread') {
        const msgs = await sql`SELECT id, sender, body, created_at FROM member_messages WHERE student_id = ${studentId} ORDER BY created_at ASC LIMIT 200`;
        await sql`UPDATE member_messages SET read_by_member = true WHERE student_id = ${studentId} AND sender <> 'member'`;
        let peerOnline = false;
        if (myRef) {
          const po = await sql`SELECT s2.last_seen_at FROM ambassador_requests ar JOIN academy_students s2 ON s2.id = ar.student_id WHERE ar.code = ${myRef} AND ar.status = 'approved' ORDER BY ar.created_at DESC LIMIT 1`;
          peerOnline = !!(po.length && po[0].last_seen_at && (Date.now() - new Date(po[0].last_seen_at).getTime()) < 120000);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messages: msgs, hasAmbassador: !!myRef, peerName: peerName, peerOnline: peerOnline }) };
      }
      const txt = String(body.text || '').trim().slice(0, 2000);
      if (!txt) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الرسالة فارغة' }) };
      const recent = await sql`SELECT COUNT(*)::int AS c FROM member_messages WHERE student_id = ${studentId} AND sender = 'member' AND created_at > now() - interval '5 minutes'`;
      if (recent[0].c >= 5) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'أرسلت رسائل كثيرة — انتظر قليلاً' }) };
      await sql`INSERT INTO member_messages (student_id, ref_code, sender, body) VALUES (${studentId}, ${myRef}, 'member', ${txt})`;
      if (!myRef) {
        const tgT = process.env.TELEGRAM_BOT_TOKEN, tgC = process.env.TELEGRAM_CHAT_ID;
        if (tgT && tgC) {
          const note = '💬 رسالة عضو (بلا سفير)\n' + (me.name || '') + ' — ' + (me.email || '') + '\nرقم العضوية: ' + me.id + '\n\n' + txt + '\n\n#M' + me.id + '\n↩️ ردّ على هذه الرسالة مباشرة ليصله ردك بلوحته وبريده';
          await fetch('https://api.telegram.org/bot' + tgT + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgC, text: note }) }).catch(function () {});
        }
      } else {
        await sql`INSERT INTO audit_log (action, details) VALUES ('member-message', ${'رسالة من العضو #' + me.id + ' إلى سفيره ' + myRef})`;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'amb-threads' || action === 'amb-thread' || action === 'amb-thread-send') {
      const { studentId } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const ambR = await sql`SELECT code FROM ambassador_requests WHERE student_id = ${studentId} AND status = 'approved' AND code IS NOT NULL ORDER BY decided_at DESC LIMIT 1`;
      if (!ambR.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'لست سفيراً معتمداً' }) };
      const myCode = ambR[0].code;
      if (action === 'amb-threads') {
        const rows = await sql`SELECT s.id, s.name, (SELECT COUNT(*)::int FROM member_messages m WHERE m.student_id = s.id AND m.sender = 'member' AND m.read_by_peer = false) AS unread, (SELECT MAX(created_at) FROM member_messages m2 WHERE m2.student_id = s.id) AS last_at, s.last_seen_at FROM academy_students s WHERE s.member_ref = ${myCode} ORDER BY last_at DESC NULLS LAST LIMIT 100`;
      rows.forEach(r => { r.online = !!(r.last_seen_at && (Date.now() - new Date(r.last_seen_at).getTime()) < 120000); });
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, threads: rows }) };
      }
      const peerId = parseInt(body.peerId, 10);
      if (!peerId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'العضو غير محدد' }) };
      const own = await sql`SELECT id FROM academy_students WHERE id = ${peerId} AND member_ref = ${myCode} LIMIT 1`;
      if (!own.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'هذا العضو ليس من عملائك' }) };
      if (action === 'amb-thread') {
        const msgs = await sql`SELECT id, sender, body, created_at FROM member_messages WHERE student_id = ${peerId} ORDER BY created_at ASC LIMIT 200`;
        await sql`UPDATE member_messages SET read_by_peer = true WHERE student_id = ${peerId} AND sender = 'member'`;
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messages: msgs }) };
      }
      const rtxt = String(body.text || '').trim().slice(0, 2000);
      if (!rtxt) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'الرسالة فارغة' }) };
      const rc = await sql`SELECT COUNT(*)::int AS c FROM member_messages WHERE student_id = ${peerId} AND sender = 'ambassador' AND created_at > now() - interval '5 minutes'`;
      if (rc[0].c >= 10) return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: 'أرسلت رسائل كثيرة — انتظر قليلاً' }) };
      await sql`INSERT INTO member_messages (student_id, ref_code, sender, body) VALUES (${peerId}, ${myCode}, 'ambassador', ${rtxt})`;
      try { await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${peerId}, '📩 رد جديد من سفيرك', ${rtxt.slice(0, 300)})`; } catch (eN) {}
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'ambassador-stats') {
      const { studentId, token } = body;
      if (!studentId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'بيانات ناقصة' }) };
      const stRows5 = await sql`SELECT id, email, password_hash FROM academy_students WHERE id = ${studentId}`;
      if (!stRows5.length) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: 'غير موجود' }) };
      const stu5 = stRows5[0];
      const secret6 = process.env.AFFILIATE_SESSION_SECRET || stu5.password_hash;
      const dates5 = [new Date().toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
      const okTok5 = token && dates5.some(d => crypto.createHmac('sha256', secret6).update(d + stu5.email).digest('hex') === String(token));
      if (!okTok5) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, needsLogin: true }) };
      const ambRows = await sql`SELECT code FROM ambassador_requests WHERE student_id = ${studentId} AND status = 'approved' ORDER BY created_at DESC LIMIT 1`;
      if (!ambRows.length) return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'لست سفيراً معتمداً' }) };
      const code = ambRows[0].code;
      const customerCount = await sql`SELECT COUNT(*)::int AS c FROM subscriptions WHERE ref_code = ${code}`;
      const totalCommission = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE ref_code = ${code}`;
      const currentMonthKey = new Date().toISOString().slice(0, 7);
      const pending = await sql`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE ref_code = ${code} AND to_char(created_at,'YYYY-MM') = ${currentMonthKey}`;
      const monthlyRows = await sql`SELECT to_char(created_at,'YYYY-MM') AS month, COALESCE(SUM(amount),0)::numeric AS total FROM commission_log WHERE ref_code = ${code} GROUP BY month ORDER BY month DESC LIMIT 6`;
      const customers = await sql`SELECT s.status, s.plan, s.expires_at,
          COALESCE((SELECT SUM(c.amount) FROM commission_log c WHERE c.ref_code = ${code} AND c.customer_name = s.customer_name), 0)::numeric AS customer_commission
        FROM subscriptions s WHERE s.ref_code = ${code} ORDER BY s.created_at DESC LIMIT 50`;
      // ترتيب السفراء: المقياس مجموع العمولات في آخر 90 يوماً (يقيس القيمة ويتجدد)، وفكّ التعادل بالتراكمي
      const board = await sql`SELECT r.code,
          COALESCE((SELECT SUM(c.amount) FROM commission_log c WHERE c.ref_code = r.code AND c.created_at > now() - interval '90 days'), 0)::numeric AS recent,
          COALESCE((SELECT SUM(c.amount) FROM commission_log c WHERE c.ref_code = r.code), 0)::numeric AS lifetime
        FROM ambassador_requests r WHERE r.status = 'approved' AND r.code IS NOT NULL
        ORDER BY recent DESC, lifetime DESC, r.code ASC`;
      const renewRows = await sql`SELECT COUNT(*)::int AS c FROM commission_log WHERE ref_code = ${code}`;
      const renewalCount = renewRows[0].c;
      const unreadRows = await sql`SELECT COUNT(*)::int AS c FROM amb_messages WHERE code = ${code} AND sender = 'admin' AND read_by_amb = false`;
      const unreadMsgs = unreadRows[0].c;
      let rank = null;
      const myIdx = board.findIndex(function(b){ return b.code === code; });
      if (myIdx !== -1) {
        const me = board[myIdx];
        const above = myIdx > 0 ? board[myIdx - 1] : null;
        const below = myIdx < board.length - 1 ? board[myIdx + 1] : null;
        const second = board.length > 1 ? board[1] : null;
        const num = function(v){ return parseFloat(v || 0); };
        rank = { position: myIdx + 1, total: board.length,
          myRecent: num(me.recent), myLifetime: num(me.lifetime),
          aboveGap: above ? Math.max(0, num(above.recent) - num(me.recent)) : null,
          belowGap: below ? Math.max(0, num(me.recent) - num(below.recent)) : null,
          leadOverSecond: (myIdx === 0 && second) ? Math.max(0, num(me.recent) - num(second.recent)) : null };
      }
      const payouts = await sql`SELECT i.amount, r.month FROM payout_items i JOIN payout_runs r ON r.id = i.run_id WHERE i.ref_code = ${code} ORDER BY r.month DESC LIMIT 12`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code, customerCount: customerCount[0].c, totalCommission: totalCommission[0].total, pending: pending[0].total, refLink: 'https://opnlio.com/?ref=' + code, monthly: monthlyRows.reverse(), customers, payouts, rank, unreadMsgs, renewalCount }) };
    }

    if (action === 'mark-notifications-read') {
      const { studentId } = body;
      if (studentId) await sql`UPDATE member_notifications SET read = true WHERE student_id = ${studentId} OR student_id IS NULL`;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'verify-cert') {
      const num = String(body.certNumber || '').trim().toUpperCase();
      if (!num) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'أدخل رقم الشهادة' }) };
      const rows = await sql`SELECT name, graduated_at, cert_number FROM academy_students WHERE cert_number = ${num} AND graduated_at IS NOT NULL`;
      if (!rows.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: false }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, valid: true, name: rows[0].name, graduated_at: rows[0].graduated_at, cert_number: rows[0].cert_number }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'إجراء غير معروف' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
