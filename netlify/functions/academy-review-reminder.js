// وظيفة مجدولة (يومياً): تُرسل اختبار مراجعة قصير للخريجين بعد 3 أيام من تخرّجهم لترسيخ المعلومة
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');
const crypto = require('crypto');

const REVIEW_QUESTIONS = [
  { q: 'ما الشرط الذي لا يصدر بدونه أي حكم شراء أو بيع في لوحة قرار الملك؟', options: ['كسر ترند على فريم الدقيقة', 'موافقة الفريم الأسبوعي — القاضي الأعلى', 'إغلاق فجوة سعرية'], a: 1 },
  { q: 'هبط RSI تحت 30 — ماذا يعني هذا غالباً؟', options: ['تشبع شرائي واحتمال تصحيح', 'تشبع بيعي واحتمال ارتداد', 'اتجاه صاعد مؤكد'], a: 1 },
  { q: 'رأس مالك 10,000$ وتلتزم بقاعدة 1-2% — أقصى مخاطرة مقبولة بصفقة واحدة؟', options: ['100-200$', '1000-2000$', '5000$'], a: 0 },
  { q: 'ما تعريف "تداول الانتقام" (Revenge Trading)؟', options: ['فتح صفقة فورية بعد خسارة للتعويض دون تحليل', 'توثيق كل صفقة بسجل', 'الانتظار 24 ساعة قبل أي صفقة'], a: 0 },
  { q: 'ما وظيفة تقاطع خطي %K و%D في الستوكاستيك؟', options: ['قياس حجم التداول', 'رسم الدعم والمقاومة', 'إعطاء إشارات دخول وخروج محتملة'], a: 2 },
  { q: 'اختراق بجسم شمعة + فوليوم مرتفع + إعادة اختبار ناجحة — ما التقييم المنهجي؟', options: ['احتمالات نجاحه أعلى لكنه يبقى غير مضمون', 'مضمون الربح تماماً', 'ضعيف ويجب تجاهله'], a: 0 },
  { q: 'دلتا عقدك 0.60 وتحرك السهم +1$ — التغير التقريبي المتوقع بسعر العقد؟', options: ['+0.06$', '+0.60$', '+6.00$'], a: 1 },
  { q: 'كلما اقترب العقد من تاريخ الانتهاء، وتيرة تآكل الثيتا؟', options: ['تتباطأ', 'تتسارع', 'تثبت تماماً'], a: 1 },
  { q: 'قفز مسار السيولة الخفية من تحت القاع البارد إلى فوق منطقة الغليان بخطوة واحدة — حسب المنظومة هذه؟', options: ['إشارة بيع فورية', 'إشارة شراء نادرة تستحق الانتباه مع تأكيد بقية الأدوات', 'عطل فني مؤكد'], a: 1 },
  { q: 'ما العلاقة الصحيحة بين أدوات المنظومة وقرار المتداول النهائي؟', options: ['الأدوات تقرأ وترجّح الاحتمالات — والقرار والمسؤولية يبقيان على المتداول', 'الأدوات تضمن الربح وتلغي المسؤولية', 'الأدوات تنفذ الصفقات تلقائياً'], a: 0 }
];

function pickRandom(arr, n) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, n);
}

exports.handler = async () => {
  try {
    await ensureTables();
    const sql = getSql();
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS review_token text`;
    await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS review_sent_at timestamptz`;

    const rows = await sql`
      SELECT id, email, name FROM academy_students
      WHERE graduated_at IS NOT NULL
        AND graduated_at <= now() - interval '3 days'
        AND graduated_at > now() - interval '4 days'
        AND review_sent_at IS NULL
    `;

    let sent = 0;
    for (const s of rows) {
      const picks = pickRandom(REVIEW_QUESTIONS, 5);
      const token = crypto.randomBytes(16).toString('hex');
      const qHtml = picks.map((item, i) =>
        `<div style="margin:14px 0; padding:14px; background:rgba(255,255,255,.04); border-radius:10px;">
          <b style="color:#D4AF37;">${i + 1}. ${item.q}</b><br>
          ${item.options.map((o, oi) => `<span style="display:block; margin-top:6px; color:#c9d2e3;">${oi === item.a ? '✅' : '▫️'} ${o}</span>`).join('')}
        </div>`
      ).join('');
      const bodyHtml = `<div dir="rtl">مرحباً <b>${s.name}</b> 👋<br><br>
        مرّت 3 أيام على تخرّجك من أكاديمية O P N LIO 🎓 — هذا اختبار ترسيخ قصير (5 أسئلة عشوائية من برنامجك) للمحافظة على ما تعلمته:<br>
        ${qHtml}
        <br>راجع إجاباتك ✅ فوق كل سؤال، وإن أخطأت بأي منها راجع الدرس المرتبط بها في لوحة تحكمك.<br><br>
        <a href="https://opnlio.com/member-login.html" style="display:inline-block; background:linear-gradient(120deg,#D4AF37,#f0cf6c); color:#070d18; font-weight:900; padding:12px 26px; border-radius:22px; text-decoration:none;">الدخول للوحة التحكم ←</a></div>`;
      const res = await sendMail(s.email, 'اختبار ترسيخ سريع — بعد 3 أيام من تخرّجك 🎓', 'مراجعة سريعة', bodyHtml, 'ar');
      if (res && res.ok) {
        await sql`UPDATE academy_students SET review_sent_at = now(), review_token = ${token} WHERE id = ${s.id}`;
        sent++;
      }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) };
  }
};

exports.config = { schedule: '@daily' };
