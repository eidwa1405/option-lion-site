// استقبال تنبيهات TradingView وتخزينها لعرضها مباشرة في لوحة تحكم العضو
const { getSql, ensureTables } = require('./_db');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false }) };
  try {
    await ensureTables();
    const sql = getSql();

    const secret = (event.queryStringParameters && event.queryStringParameters.key) || '';
    if (!process.env.TV_WEBHOOK_SECRET || secret !== process.env.TV_WEBHOOK_SECRET) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    let payload = {};
    const raw = event.body || '';
    try { payload = JSON.parse(raw); } catch (e) { payload = { message: raw }; }

    const symbol = String(payload.symbol || payload.ticker || '').toUpperCase().slice(0, 24);
    const timeframe = String(payload.timeframe || payload.interval || '').slice(0, 12);
    const script = String(payload.script || payload.indicator || '').slice(0, 64);
    const direction = /هبوط|down|put|bear/i.test(raw) ? 'down' : /صعود|up|call|bull/i.test(raw) ? 'up' : 'neutral';
    const message = String(payload.message || raw || '').slice(0, 400);

    await sql`INSERT INTO tv_alerts (symbol, timeframe, script_name, direction, message) VALUES (${symbol}, ${timeframe}, ${script}, ${direction}, ${message})`;
    await sql`DELETE FROM tv_alerts WHERE created_at < now() - interval '7 days'`;

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
