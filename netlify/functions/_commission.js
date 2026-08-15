// حساب واعتماد عمولة السفير — النموذج المعتمد (جدول تراكمي منتظم):
// أساس الباقة: شهري 4$، 3 شهور 6$، 6 شهور 12$، سنوي 24$
// معامل المرتبة (بعدد التجديدات التراكمية، لا ينزل أبداً): <200 ×1 | 200 ×1.25 | 500 ×1.5 | 1000 ×1.75 | 2000 ×2 | 4000 ×2.25
// مكافأة الانطلاق: +50% على أول 3 عملاء خلال 14 يوماً من القبول
// جائزة الشهر: 15% / 10% / 5% لأعلى ثلاثة (تُصرف شهرياً من دفعة الصرف)
const PLAN_BASE = { renew_1m: 4, renew_3m: 6, renew_6m: 12, renew_1y: 24 };
const TIERS = [
  { min: 4000, mult: 2.25 },
  { min: 2000, mult: 2.00 },
  { min: 1000, mult: 1.75 },
  { min: 500,  mult: 1.50 },
  { min: 200,  mult: 1.25 },
  { min: 0,    mult: 1.00 }
];
function tierFor(count) { return TIERS.find(function (t) { return count >= t.min; }); }
function round2(v) { return Math.round(v * 100) / 100; }

async function awardCommission(sql, { sendMail, refCode, customerName, selfRefFlagged, planLabel, txId }) {
  if (!refCode) return null;
  if (txId) {
    const seen = await sql`SELECT 1 FROM commission_log WHERE paddle_transaction_id = ${txId} LIMIT 1`;
    if (seen.length) return null;
  }
  if (selfRefFlagged) {
    await sql`INSERT INTO audit_log (action, details) VALUES ('self-referral-commission-skipped', ${'تم تجديد العميل ' + (customerName || '') + ' بكود ' + refCode + ' بلا عمولة — موسوم كإحالة ذاتية'})`;
    return null;
  }

  const base = PLAN_BASE[planLabel] || PLAN_BASE.renew_1m;

  // المرتبة تُحسب من عدد التجديدات المسجّلة قبل هذه العملية
  const cntRows = await sql`SELECT COUNT(*)::int AS c FROM commission_log WHERE ref_code = ${refCode}`;
  const priorCount = cntRows[0].c;
  const tier = tierFor(priorCount);
  let amount = base * tier.mult;

  // مكافأة الانطلاق السريع: +50% على أول 3 عملاء مختلفين خلال 14 يوماً من تاريخ القبول
  let fastStart = 0;
  const affRows = await sql`SELECT name, email, approved_at, created_at FROM affiliates WHERE code = ${refCode} LIMIT 1`;
  if (affRows.length) {
    const startedAt = affRows[0].approved_at || affRows[0].created_at;
    if (startedAt) {
      const daysSinceStart = (Date.now() - new Date(startedAt).getTime()) / 86400000;
      if (daysSinceStart <= 14) {
        const distinct = await sql`SELECT COUNT(DISTINCT customer_name)::int AS c FROM commission_log WHERE ref_code = ${refCode} AND customer_name <> ''`;
        const isNewCustomer = customerName
          ? !(await sql`SELECT 1 FROM commission_log WHERE ref_code = ${refCode} AND customer_name = ${customerName} LIMIT 1`).length
          : false;
        if (isNewCustomer && distinct[0].c < 3) fastStart = amount * 0.5;
      }
    }
  }

  // حملات التعزيز: نسبة إضافية اختيارية من لوحة الإدارة
  let campaignBonus = 0;
  const camp = await sql`SELECT boost_amount FROM boost_campaigns
    WHERE now() BETWEEN starts_at AND ends_at AND (target = 'all' OR ${refCode} = ANY(target_codes))
    ORDER BY boost_amount DESC LIMIT 1`;
  if (camp.length && camp[0].boost_amount) campaignBonus = amount * (Number(camp[0].boost_amount) / 100);

  const total = round2(amount + fastStart + campaignBonus);
  amount = round2(amount);
  const bonusPart = round2(fastStart + campaignBonus);

  await sql`INSERT INTO commission_log (ref_code, customer_name, plan, amount, floor_amount, bonus_amount, paddle_transaction_id)
    VALUES (${refCode}, ${customerName || ''}, ${planLabel || ''}, ${total}, ${amount}, ${bonusPart}, ${txId || null})`;

  // إشعار اقتراب ترقية المرتبة
  const newCount = priorCount + 1;
  const nextTier = TIERS.slice().reverse().find(function (t) { return t.min > newCount; });
  if (nextTier && sendMail && affRows.length && affRows[0].email) {
    const remaining = nextTier.min - newCount;
    if (remaining > 0 && remaining <= 10) {
      const notified = await sql`SELECT last_tier_notified FROM affiliates WHERE code = ${refCode}`;
      if (!notified.length || notified[0].last_tier_notified !== nextTier.min) {
        const body = '<div dir="rtl">مرحباً <b>' + affRows[0].name + '</b> 👋<br><br>أنت على وشك ترقية مرتبتك! باقي <b style="color:#39FF14;">' + remaining + '</b> تجديد لترتفع عمولتك إلى <b style="color:#D4AF37;">معامل ×' + nextTier.mult + '</b> على كل باقة.<br><br>استمر — أنت قريب جداً 🚀</div>';
        await sendMail(affRows[0].email, '🚀 أنت قريب من ترقية مرتبتك — Rank Upgrade Almost Reached', 'اقترب من الترقية', body, 'ar');
        await sql`UPDATE affiliates SET last_tier_notified = ${nextTier.min} WHERE code = ${refCode}`;
      }
    }
  }

  return { amount: total, floorPart: amount, bonusPart: bonusPart, tierMult: tier.mult, fastStart: round2(fastStart) };
}
module.exports = { awardCommission, PLAN_BASE, TIERS, tierFor, round2 };
