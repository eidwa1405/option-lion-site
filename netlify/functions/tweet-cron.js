// نظام التغريد الآلي — يعمل كل ساعة ويغرد في الساعات المحددة (توقيت الرياض)
// يتطلب متغيرات البيئة: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { BANK, HASHTAGS } = require('./_tweets');

function pct(s){ return encodeURIComponent(s).replace(/[!*'()]/g, function(c){ return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }

async function postTweet(text) {
  const url = 'https://api.x.com/2/tweets';
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0'
  };
  const paramStr = Object.keys(oauth).sort().map(function(k){ return pct(k) + '=' + pct(oauth[k]); }).join('&');
  const base = 'POST&' + pct(url) + '&' + pct(paramStr);
  const signKey = pct(process.env.X_API_SECRET) + '&' + pct(process.env.X_ACCESS_SECRET);
  oauth.oauth_signature = crypto.createHmac('sha1', signKey).update(base).digest('base64');
  const authHeader = 'OAuth ' + Object.keys(oauth).sort().map(function(k){ return pct(k) + '="' + pct(oauth[k]) + '"'; }).join(', ');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text })
  });
  const j = await res.json().catch(function(){ return {}; });
  if (!res.ok) throw new Error('X API ' + res.status + ': ' + JSON.stringify(j));
  return j.data && j.data.id;
}

function pickHashtags(lang, seedText) {
  const pool = HASHTAGS[lang] || [];
  const n = 1 + (seedText.length % 2); // 1 أو 2
  const shuffled = pool.slice().sort(function(){ return Math.random() - 0.5; });
  return shuffled.slice(0, n).join(' ');
}

exports.handler = async () => {
  try {
    const sql = getSql();
    await ensureTables(sql);
    // الإعدادات
    const cfgRow = await sql`SELECT value FROM admin_settings WHERE key = 'tweet_config'`;
    const cfg = cfgRow.length ? JSON.parse(cfgRow[0].value) : { enabled: false, slots: [7, 12, 16, 20, 23] };
    if (!cfg.enabled) return { statusCode: 200, body: 'paused' };
    if (!process.env.X_API_KEY) return { statusCode: 200, body: 'no keys' };
    // الساعة الحالية بتوقيت الرياض (UTC+3)
    const now = new Date(Date.now() + 3*3600*1000);
    const hour = now.getUTCHours();
    const today = now.toISOString().slice(0,10);
    const slots = cfg.slots || [7, 12, 16, 20, 23];
    const slotIdx = slots.indexOf(hour);
    if (slotIdx < 0) return { statusCode: 200, body: 'not a slot hour' };
    // هل غردنا لهذه الخانة اليوم؟
    const done = await sql`SELECT 1 FROM tweet_log WHERE slot_date = ${today} AND slot_hour = ${hour} AND error IS NULL LIMIT 1`;
    if (done.length) return { statusCode: 200, body: 'already posted this slot' };
    // أولوية ١: طابور التغريدات اليدوية
    let text = null, bankId = null;
    const q = await sql`SELECT id, body FROM tweet_queue WHERE posted = false ORDER BY id ASC LIMIT 1`;
    if (q.length) {
      text = q[0].body;
      bankId = 'queue-' + q[0].id;
      await sql`UPDATE tweet_queue SET posted = true WHERE id = ${q[0].id}`;
    } else {
      // أولوية ٢: المخزون — تناوب لغة + نسبة 4 تعليم : 1 تسويق (خانة واحدة يومياً للتسويق)
      const lang = slotIdx % 2 === 0 ? 'ar' : 'en';
      const wantPromo = slotIdx === slots.length - 1; // آخر خانة باليوم تسويقية
      const cats = wantPromo ? ['promo'] : (slotIdx === 1 || slotIdx === 3 ? ['session','edu'] : ['edu','principle']);
      const used = await sql`SELECT bank_id FROM tweet_log WHERE created_at > now() - interval '90 days'`;
      const usedIds = {};
      used.forEach(function(u){ usedIds[u.bank_id] = true; });
      let pool = BANK.filter(function(b){ return b.lang === lang && cats.indexOf(b.cat) >= 0 && !usedIds[b.id]; });
      if (!pool.length) pool = BANK.filter(function(b){ return b.lang === lang && cats.indexOf(b.cat) >= 0; });
      if (!pool.length) return { statusCode: 200, body: 'empty pool' };
      const pick = pool[Math.floor(Math.random() * pool.length)];
      bankId = pick.id;
      const tags = pickHashtags(lang, pick.t);
      text = pick.t + '\n\n' + tags;
      if (pick.cat !== 'promo') text += lang === 'ar' ? '\n\nمحتوى تعليمي — ليس توصية' : '\n\nEducational — not advice';
    }
    if (text.length > 275) text = text.slice(0, 272) + '…';
    let tweetId = null, err = null;
    try { tweetId = await postTweet(text); } catch (e) { err = String(e.message || e).slice(0, 500); }
    await sql`INSERT INTO tweet_log (bank_id, body, slot_date, slot_hour, tweet_id, error) VALUES (${bankId}, ${text}, ${today}, ${hour}, ${tweetId}, ${err})`;
    return { statusCode: 200, body: err ? 'error: ' + err : 'posted ' + tweetId };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};

exports.config = { schedule: '@hourly' };
