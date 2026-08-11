// وظيفة مجدولة (كل 10 دقائق): تسلسل تذكير بريدي لمن لم يكمل الدفع — يتوقف فوراً إذا تغيّرت حالته (اشترك أو فُعّلت تجربته)
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

// كل مرحلة: بعد كم دقيقة من التسجيل تُرسل، ونص الرسالة
const STAGES = [
  { minutes: 30, key: 'reminder1' },
  { minutes: 24 * 60, key: 'reminder2' },
  { minutes: 3 * 24 * 60, key: 'reminder3' },
  { minutes: 7 * 24 * 60, key: 'reminder4' }
];

const T = {
  ar: {
    reminder1: { subject: 'لم تُكمل تسجيلك في O P N LIO ⚜', hi: 'يبدو أنك على وشك الانضمام إلينا',
      body: (n, link) => `مرحباً <b>${n}</b> 👋<br><br>لاحظنا أنك بدأت التسجيل ولم تُكمل الدفع بعد.<br><br>نحن هنا لمساعدتك على إتمام انضمامك للنخبة.<br><br>${btn(link,'إكمال الدفع الآن')}` },
    reminder2: { subject: 'فرصتك للتجربة المجانية 14 يوم لسه متاحة ⚜', hi: 'لا تفوّت التجربة المجانية',
      body: (n, link) => `مرحباً <b>${n}</b> 👋<br><br>تجربتك المجانية لمدة 14 يوماً على أدواتنا الأربعة المتكاملة لسه بانتظارك.<br><br>${btn(link,'ابدأ تجربتك الآن')}` },
    reminder3: { subject: 'انضم لآلاف المتداولين في O P N LIO ⚜', hi: 'أنت على بعد خطوة واحدة',
      body: (n, link) => `مرحباً <b>${n}</b> 👋<br><br>متداولون كثيرون يستخدمون أدواتنا يومياً لاتخاذ قرارات أوضح في السوق.<br><br>ما زال مقعدك محفوظاً — أكمل تسجيلك الآن.<br><br>${btn(link,'إكمال التسجيل')}` },
    reminder4: { subject: 'آخر تذكير — تسجيلك في O P N LIO ⚜', hi: 'هذا آخر تذكير منّا',
      body: (n, link) => `مرحباً <b>${n}</b> 👋<br><br>هذه آخر رسالة تذكير بخصوص تسجيلك غير المكتمل. إذا غيّرت رأيك، بابنا مفتوح دائماً لك.<br><br>${btn(link,'إكمال التسجيل')}` }
  },
  en: {
    reminder1: { subject: "You haven't completed your O P N LIO registration ⚜", hi: 'Looks like you were about to join us',
      body: (n, link) => `Hi <b>${n}</b> 👋<br><br>We noticed you started signing up but haven't completed payment yet.<br><br>${btn(link,'Complete Payment Now')}` },
    reminder2: { subject: 'Your 14-day free trial is still available ⚜', hi: "Don't miss your free trial",
      body: (n, link) => `Hi <b>${n}</b> 👋<br><br>Your 14-day free trial on our four integrated tools is still waiting for you.<br><br>${btn(link,'Start Your Trial Now')}` },
    reminder3: { subject: 'Join thousands of traders on O P N LIO ⚜', hi: "You're one step away",
      body: (n, link) => `Hi <b>${n}</b> 👋<br><br>Many traders use our tools daily for clearer market decisions.<br><br>Your spot is still reserved — complete your registration now.<br><br>${btn(link,'Complete Registration')}` },
    reminder4: { subject: 'Last reminder — your O P N LIO registration ⚜', hi: 'This is our last reminder',
      body: (n, link) => `Hi <b>${n}</b> 👋<br><br>This is the final reminder about your incomplete registration. If you change your mind, our door is always open.<br><br>${btn(link,'Complete Registration')}` }
  }
};

function btn(link, label) {
  return `<a href="${link}" style="display:inline-block;background:linear-gradient(120deg,#D4AF37,#f0cf6c);color:#070d18;font-weight:900;padding:12px 26px;border-radius:10px;text-decoration:none;">${label}</a>`;
}

exports.handler = async () => {
  try {
    await ensureTables();
    const sql = getSql();
    let totalSent = 0;

    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      const cutoff = new Date(Date.now() - stage.minutes * 60000).toISOString();
      // فحص الحالة لحظة الإرسال — إذا اشترك أو تغيّرت حالته، لن يظهر في هذا الاستعلام أصلاً
      const rows = await sql`SELECT id, customer_name, email, lang FROM subscriptions
        WHERE status = 'pending_payment' AND email IS NOT NULL AND email != ''
        AND created_at <= ${cutoff} AND reminder_stage = ${i}`;

      for (const r of rows) {
        // تأكيد أخير مباشر قبل الإرسال أن الحالة ما زالت pending_payment (حماية من التزامن)
        const recheck = await sql`SELECT status FROM subscriptions WHERE id = ${r.id}`;
        if (!recheck.length || recheck[0].status !== 'pending_payment') continue;

        const lang = (r.lang === 'en') ? 'en' : 'ar';
        const t = T[lang][stage.key];
        const signupUrl = lang === 'ar' ? 'https://opnlio.com/signup.html' : 'https://opnlio.com/en-signup.html';
        const res = await sendMail(r.email, t.subject, t.hi, t.body(r.customer_name, signupUrl), lang);
        if (res.ok) totalSent++;
        await sql`UPDATE subscriptions SET reminder_stage = ${i + 1} WHERE id = ${r.id} AND status = 'pending_payment'`;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: totalSent }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

exports.config = { schedule: '*/10 * * * *' };
