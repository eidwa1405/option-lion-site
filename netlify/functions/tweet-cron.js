// نظام النشر الآلي — يعمل كل ساعة وينشر في الساعات المحددة (توقيت الرياض)
// X: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// تلجرام: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL (مثال: @opnlio أو -1001234567890)
// فيسبوك: FB_PAGE_ID, FB_PAGE_TOKEN (توكن صفحة طويل الأجل)
// إنستقرام: IG_USER_ID (حساب Business مرتبط بالصفحة) — يستخدم FB_PAGE_TOKEN نفسه
// كل منصة مستقلة: غياب مفاتيحها يتخطاها بلا تعطيل الباقي
const crypto = require('crypto');
const { getSql, ensureTables } = require('./_db');
const { BANK, HASHTAGS } = require('./_tweets');

function pct(s){ return encodeURIComponent(s).replace(/[!*'()]/g, function(c){ return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }

function oauthHeader(method, url) {
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0'
  };
  const paramStr = Object.keys(oauth).sort().map(function(k){ return pct(k) + '=' + pct(oauth[k]); }).join('&');
  const base = method + '&' + pct(url) + '&' + pct(paramStr);
  const signKey = pct(process.env.X_API_SECRET) + '&' + pct(process.env.X_ACCESS_SECRET);
  oauth.oauth_signature = crypto.createHmac('sha1', signKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map(function(k){ return pct(k) + '="' + pct(oauth[k]) + '"'; }).join(', ');
}

// يرفع بطاقة التغريدة من الموقع إلى X ويعيد media_id (null عند أي فشل — التغريدة تنشر نصية)
async function uploadCard(imgKey) {
  try {
    if (!imgKey) return null;
    const imgRes = await fetch('https://opnlio.com/tweet-cards/' + imgKey + '.png');
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 4900000) return null;
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    // multipart: لا تدخل حقول الجسم في توقيع OAuth
    const form = new FormData();
    form.append('media', new Blob([buf], { type: 'image/png' }), 'card.png');
    const res = await fetch(url, { method: 'POST', headers: { 'Authorization': oauthHeader('POST', url) }, body: form });
    const j = await res.json().catch(function(){ return {}; });
    return res.ok ? (j.media_id_string || null) : null;
  } catch (e) { return null; }
}

async function postTweet(text, mediaId) {
  const url = 'https://api.x.com/2/tweets';
  const payload = { text: text };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': oauthHeader('POST', url), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(function(){ return {}; });
  if (!res.ok) throw new Error('X API ' + res.status + ': ' + JSON.stringify(j));
  return j.data && j.data.id;
}

const CARD_BASE = 'https://opnlio.com/tweet-cards/';

// ── تلجرام: صورة بتعليق (حد 1024 حرفاً للتعليق) أو نص طويل ──
async function postTelegram(text, imgKey) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL) return null;
  const base = 'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/';
  const chat = process.env.TELEGRAM_CHANNEL;
  let res, j;
  if (imgKey && text.length <= 1000) {
    res = await fetch(base + 'sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: CARD_BASE + imgKey + '.png', caption: text })
    });
  } else {
    // نص طويل: الصورة أولاً ثم النص كرسالة مستقلة
    if (imgKey) await fetch(base + 'sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: CARD_BASE + imgKey + '.png' })
    }).catch(function(){});
    res = await fetch(base + 'sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true })
    });
  }
  j = await res.json().catch(function(){ return {}; });
  if (!j.ok) throw new Error('Telegram: ' + JSON.stringify(j).slice(0, 200));
  return j.result && j.result.message_id ? String(j.result.message_id) : 'ok';
}

// ── فيسبوك صفحة: منشور بصورة من رابط، أو نص فقط ──
async function postFacebook(text, imgKey) {
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_TOKEN) return null;
  const v = 'https://graph.facebook.com/v21.0/';
  const body = new URLSearchParams();
  body.set('access_token', process.env.FB_PAGE_TOKEN);
  let url;
  if (imgKey) { url = v + process.env.FB_PAGE_ID + '/photos'; body.set('url', CARD_BASE + imgKey + '.png'); body.set('caption', text); }
  else { url = v + process.env.FB_PAGE_ID + '/feed'; body.set('message', text); }
  const res = await fetch(url, { method: 'POST', body: body });
  const j = await res.json().catch(function(){ return {}; });
  if (!res.ok) throw new Error('Facebook: ' + JSON.stringify(j).slice(0, 200));
  return j.post_id || j.id || 'ok';
}

// ── إنستقرام: يتطلب صورة (لا يقبل نصاً وحده) — إنشاء حاوية ثم نشرها ──
async function postInstagram(text, imgKey) {
  if (!process.env.IG_USER_ID || !process.env.FB_PAGE_TOKEN || !imgKey) return null;
  const v = 'https://graph.facebook.com/v21.0/';
  const c1 = new URLSearchParams();
  c1.set('image_url', CARD_BASE + imgKey + '.png');
  c1.set('caption', text.slice(0, 2100));
  c1.set('access_token', process.env.FB_PAGE_TOKEN);
  const r1 = await fetch(v + process.env.IG_USER_ID + '/media', { method: 'POST', body: c1 });
  const j1 = await r1.json().catch(function(){ return {}; });
  if (!r1.ok || !j1.id) throw new Error('IG container: ' + JSON.stringify(j1).slice(0, 200));
  const c2 = new URLSearchParams();
  c2.set('creation_id', j1.id);
  c2.set('access_token', process.env.FB_PAGE_TOKEN);
  const r2 = await fetch(v + process.env.IG_USER_ID + '/media_publish', { method: 'POST', body: c2 });
  const j2 = await r2.json().catch(function(){ return {}; });
  if (!r2.ok) throw new Error('IG publish: ' + JSON.stringify(j2).slice(0, 200));
  return j2.id || 'ok';
}

function pickHashtags(lang, seedText) {
  const pool = HASHTAGS[lang] || [];
  const n = 1 + (seedText.length % 2); // 1 أو 2
  const shuffled = pool.slice().sort(function(){ return Math.random() - 0.5; });
  return shuffled.slice(0, n).join(' ');
}

exports.handler = async (event) => {
  try {
    // تشخيص: ?diag=1 يفحص المفاتيح ويجرب مصادقة القراءة بلا نشر
    const qp = (event && event.queryStringParameters) || {};
    if (qp.diag) {
      function info(v){ if (!v) return 'مفقود'; const t = String(v); return 'طول ' + t.length + (t !== t.trim() ? ' ⚠️ فيه مسافات زائدة' : '') + ' · يبدأ بـ' + t.slice(0,4) + '…'; }
      const out = {
        X_API_KEY: info(process.env.X_API_KEY),
        X_API_SECRET: info(process.env.X_API_SECRET),
        X_ACCESS_TOKEN: info(process.env.X_ACCESS_TOKEN),
        X_ACCESS_SECRET: info(process.env.X_ACCESS_SECRET),
        ملاحظات: 'الأطوال المتوقعة: API_KEY=25 · API_SECRET=50 · ACCESS_TOKEN=50 · ACCESS_SECRET=45'
      };
      // اختبار مصادقة على نقطة قراءة (يكشف صحة المفاتيح دون نشر)
      try {
        const u = 'https://api.x.com/2/users/me';
        const r = await fetch(u, { headers: { 'Authorization': oauthHeader('GET', u) } });
        const j = await r.json().catch(function(){ return {}; });
        out.اختبار_الهوية = r.status + ' ' + JSON.stringify(j).slice(0, 300);
      } catch (e) { out.اختبار_الهوية = 'فشل: ' + String(e.message || e); }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(out, null, 2) };
    }
    const sql = getSql();
    await ensureTables(sql);
    // الإعدادات
    // النشر الآلي مفعّل دائماً — لا يعتمد على أي مربع أو سجل.
    // للإيقاف (إن لزم يوماً): أضف متغير البيئة TWEET_PAUSE=1 في Netlify.
    const cfgRow = await sql`SELECT value FROM admin_settings WHERE key = 'tweet_config'`;
    const stored = cfgRow.length ? JSON.parse(cfgRow[0].value) : {};
    const cfg = { enabled: true, slots: (stored.slots && stored.slots.length ? stored.slots : [7, 12, 16, 20, 23]), channels: stored.channels };
    if (process.env.TWEET_PAUSE === '1') return { statusCode: 200, body: 'paused by env' };
    const anyPlatform = !!process.env.X_API_KEY || !!process.env.TELEGRAM_BOT_TOKEN || !!process.env.FB_PAGE_TOKEN;
    if (!anyPlatform) return { statusCode: 200, body: 'no keys' };
    const ch = cfg.channels || { x: true, telegram: true, facebook: true, instagram: true };
    // الساعة الحالية بتوقيت الرياض (UTC+3)
    const now = new Date(Date.now() + 3*3600*1000);
    const hour = now.getUTCHours();
    const today = now.toISOString().slice(0,10);
    const slots = cfg.slots || [7, 12, 16, 20, 23];
    const FORCE = !!(event && event.queryStringParameters && event.queryStringParameters.force === 'opnlio2026');
    let slotIdx = slots.indexOf(hour);
    if (slotIdx < 0) {
      if (!FORCE) return { statusCode: 200, body: 'not a slot hour' };
      slotIdx = 0; // نشر فوري للاختبار
    }
    if (!FORCE) {
      const done = await sql`SELECT 1 FROM tweet_log WHERE slot_date = ${today} AND slot_hour = ${hour} AND error IS NULL LIMIT 1`;
      if (done.length) return { statusCode: 200, body: 'already posted this slot' };
    }
    // أولوية ١: طابور التغريدات اليدوية
    let text = null, bankId = null, imgKey = null;
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
      imgKey = pick.img || null;
      const tags = pickHashtags(lang, pick.t);
      text = pick.t + '\n\n' + tags;
      if (pick.cat !== 'promo') text += lang === 'ar' ? '\n\nمحتوى تعليمي — ليس توصية' : '\n\nEducational — not advice';
    }
    if (text.length > 3800) text = text.slice(0, 3797) + '…'; // بريميوم: تغريدات طويلة، X يطويها بعد ~280 حرفاً بزر «إظهار المزيد»
    let tweetId = null, errs = [], okList = [];
    // X
    if (ch.x !== false && process.env.X_API_KEY) {
      const mediaId = await uploadCard(imgKey); // فشل الصورة لا يوقف النشر
      try { tweetId = await postTweet(text, mediaId); okList.push('X'); }
      catch (e) { errs.push('X: ' + String(e.message || e).slice(0, 160)); }
    }
    // تلجرام
    if (ch.telegram !== false) {
      try { const r = await postTelegram(text, imgKey); if (r) okList.push('TG'); }
      catch (e) { errs.push(String(e.message || e).slice(0, 160)); }
    }
    // فيسبوك
    if (ch.facebook !== false) {
      try { const r = await postFacebook(text, imgKey); if (r) okList.push('FB'); }
      catch (e) { errs.push(String(e.message || e).slice(0, 160)); }
    }
    // إنستقرام (يحتاج صورة)
    if (ch.instagram !== false) {
      try { const r = await postInstagram(text, imgKey); if (r) okList.push('IG'); }
      catch (e) { errs.push(String(e.message || e).slice(0, 160)); }
    }
    // نجاح جزئي يُسجّل نجاحاً حتى لا يعيد النشر بنفس الخانة
    const err = okList.length ? (errs.length ? null : null) : (errs.join(' | ').slice(0, 500) || 'لم تُفعّل أي منصة');
    const note = okList.length ? '✅ ' + okList.join(' · ') + (errs.length ? '  ⚠️ ' + errs.join(' | ').slice(0, 200) : '') : '';
    const logBody = (note ? note + '\n— — —\n' : '') + text;
    await sql`INSERT INTO tweet_log (bank_id, body, slot_date, slot_hour, tweet_id, error) VALUES (${bankId}, ${logBody}, ${today}, ${hour}, ${tweetId}, ${err})`;
    if (FORCE) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({
        نُشر_على: okList.length ? okList : 'لا شيء',
        الأخطاء: errs.length ? errs : 'لا أخطاء',
        المفاتيح_الموجودة: {
          X: !!process.env.X_API_KEY, تلجرام: !!process.env.TELEGRAM_BOT_TOKEN,
          فيسبوك: !!process.env.FB_PAGE_TOKEN, إنستقرام: !!process.env.IG_USER_ID
        },
        نص_المنشور: text.slice(0, 300)
      }, null, 2) };
    }
    return { statusCode: 200, body: err ? 'error: ' + err : 'posted → ' + okList.join(',') };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};

exports.config = { schedule: '@hourly' };
