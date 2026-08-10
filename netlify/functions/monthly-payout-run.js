// توليد دفعة صرف شهرية تلقائياً في 00:00 من أول كل شهر ميلادي — يحسب عمولات الشهر المنتهي لكل سفير
const { getSql, ensureTables } = require('./_db');

exports.handler = async () => {
  try {
    await ensureTables();
    const sql = getSql();

    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthKey = prevMonthDate.getFullYear() + '-' + String(prevMonthDate.getMonth() + 1).padStart(2, '0');

    const existing = await sql`SELECT id FROM payout_runs WHERE month = ${monthKey}`;
    if (existing.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, month: monthKey }) };
    }

    const rows = await sql`SELECT a.code, a.name, a.legal_name, a.bank_account, COALESCE(SUM(c.amount),0)::numeric AS amount, COALESCE(SUM(c.floor_amount),0)::numeric AS floor_amount, COALESCE(SUM(c.bonus_amount),0)::numeric AS bonus_amount
      FROM affiliates a JOIN commission_log c ON c.ref_code = a.code
      WHERE to_char(c.created_at, 'YYYY-MM') = ${monthKey}
      GROUP BY a.code, a.name, a.legal_name, a.bank_account`;

    const positiveRows = [];
    for (const r of rows) {
      let amt = parseFloat(r.amount);
      const floorAmt = parseFloat(r.floor_amount);
      const bonusAmt = parseFloat(r.bonus_amount);
      const carryRows = await sql`SELECT value FROM admin_settings WHERE key = ${'carry_negative_' + r.code}`;
      const carry = carryRows.length ? parseFloat(carryRows[0].value) : 0;
      if (carry < 0) { amt += carry; }
      if (amt <= 0) {
        await sql`INSERT INTO admin_settings (key, value) VALUES (${'carry_negative_' + r.code}, ${String(amt)}) ON CONFLICT (key) DO UPDATE SET value = ${String(amt)}`;
        continue;
      }
      await sql`DELETE FROM admin_settings WHERE key = ${'carry_negative_' + r.code}`;
      positiveRows.push({ code: r.code, name: r.name, legal_name: r.legal_name, bank_account: r.bank_account, amount: amt, floor_amount: floorAmt, bonus_amount: bonusAmt });
    }

    if (!positiveRows.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no commissions', month: monthKey }) };
    }

    const runRows = await sql`INSERT INTO payout_runs (month) VALUES (${monthKey}) RETURNING id`;
    const runId = runRows[0].id;
    for (const r of positiveRows) {
      await sql`INSERT INTO payout_items (run_id, ref_code, name, legal_name, bank_account, amount, floor_amount, bonus_amount) VALUES (${runId}, ${r.code}, ${r.name}, ${r.legal_name||''}, ${r.bank_account||''}, ${r.amount}, ${r.floor_amount}, ${r.bonus_amount})`;
    }
    await sql`INSERT INTO audit_log (action, details) VALUES ('monthly-payout-run', ${'تم توليد دفعة صرف لشهر ' + monthKey + ' — ' + positiveRows.length + ' سفير'})`;

    return { statusCode: 200, body: JSON.stringify({ ok: true, month: monthKey, count: positiveRows.length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};

exports.config = { schedule: '0 0 1 * *' };
