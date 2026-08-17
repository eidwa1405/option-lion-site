// استقبال ردود الإدارة من تيليجرام — الرد على رسالة السفير يصله بلوحته وبريده
const { getSql, ensureTables } = require('./_db');
const { sendMail } = require('./_mailer');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    // حماية: مسار سري عبر متغير البيئة
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (secret) {
      const given = (event.headers && (event.headers['x-telegram-bot-api-secret-token'] || event.headers['X-Telegram-Bot-Api-Secret-Token'])) || '';
      if (given !== secret) return { statusCode: 401, headers, body: JSON.stringify({ ok: false }) };
    }
    const update = JSON.parse(event.body || '{}');
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'no-text' }) };

    const chatId = String(msg.chat && msg.chat.id);
    const allowed = String(process.env.TELEGRAM_CHAT_ID || '').trim();
    if (allowed && chatId !== allowed) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'unauthorized-chat' }) };

    const replyTo = msg.reply_to_message;
    if (!replyTo || !replyTo.text) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'not-a-reply' }) };

    // ── رد الإدارة على عضو بلا سفير (#M{studentId}) ──
    const mTag = /#M(\d+)/.exec(replyTo.text);
    if (mTag) {
      const sid = parseInt(mTag[1], 10);
      const textM = String(msg.text).trim().slice(0, 2000);
      if (!textM) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'empty' }) };
      await ensureTables();
      const sqlM = getSql();
      await sqlM`CREATE TABLE IF NOT EXISTS member_messages (id serial PRIMARY KEY, student_id int, ref_code text, sender text, body text, read_by_member boolean DEFAULT false, read_by_peer boolean DEFAULT false, created_at timestamptz DEFAULT now())`;
      const stM = await sqlM`SELECT id, name, email, lang FROM academy_students WHERE id = ${sid} LIMIT 1`;
      if (!stM.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'unknown-member' }) };
      await sqlM`INSERT INTO member_messages (student_id, ref_code, sender, body, read_by_member) VALUES (${sid}, NULL, 'admin', ${textM}, false)`;
      try { await sqlM`INSERT INTO member_notifications (student_id, title, body) VALUES (${sid}, '📩 رد جديد من الإدارة', ${textM.slice(0, 300)})`; } catch (e) {}
      try {
        if (stM[0].email) {
          const lgM = stM[0].lang || 'ar';
          const TM = {
            ar: { s: '📩 رد جديد من إدارة O P N LIO', h: 'مرحباً', p: 'وصلك رد جديد من الإدارة على رسالتك:', o: 'افتح لوحتك لعرض المحادثة كاملة والرد' },
            en: { s: '📩 New reply from O P N LIO', h: 'Hello', p: 'You have a new reply from the team:', o: 'Open your dashboard to view the full thread and reply' },
            de: { s: '📩 Neue Antwort von O P N LIO', h: 'Hallo', p: 'Du hast eine neue Antwort vom Team:', o: 'Öffne dein Dashboard für den vollen Verlauf' },
            fr: { s: '📩 Nouvelle réponse de O P N LIO', h: 'Bonjour', p: 'Vous avez une nouvelle réponse de l\u2019équipe :', o: 'Ouvrez votre tableau de bord pour voir le fil complet' },
            es: { s: '📩 Nueva respuesta de O P N LIO', h: 'Hola', p: 'Tienes una nueva respuesta del equipo:', o: 'Abre tu panel para ver la conversación completa' },
            tr: { s: '📩 O P N LIO\u2019dan yeni yanıt', h: 'Merhaba', p: 'Ekipten yeni bir yanıt aldınız:', o: 'Tüm yazışmayı görmek için panelinizi açın' },
            pt: { s: '📩 Nova resposta da O P N LIO', h: 'Olá', p: 'Você recebeu uma nova resposta da equipe:', o: 'Abra seu painel para ver a conversa completa' },
            it: { s: '📩 Nuova risposta da O P N LIO', h: 'Ciao', p: 'Hai una nuova risposta dal team:', o: 'Apri la tua dashboard per vedere l\u2019intera conversazione' }
          }[lgM] || { s: '📩 New reply from O P N LIO', h: 'Hello', p: 'You have a new reply from the team:', o: 'Open your dashboard to view the full thread and reply' };
          const dirM = lgM === 'ar' ? 'rtl' : 'ltr';
          const htmlM = '<div dir="' + dirM + '">' + TM.h + ' <b>' + (stM[0].name || '') + '</b> 👋<br><br>' + TM.p +
            '<br><br><div style="background:#f6f3e8;border-inline-start:3px solid #D4AF37;padding:12px 14px;border-radius:8px;">' +
            String(textM).replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div><br>' +
            '<a href="https://opnlio.com/member-dashboard.html" style="color:#D4AF37;font-weight:800;">' + TM.o + ' ←</a></div>';
          await sendMail(stM[0].email, TM.s, TM.p, htmlM, lgM);
        }
      } catch (e) {}
      const tokM = process.env.TELEGRAM_BOT_TOKEN;
      if (tokM) {
        try { await fetch('https://api.telegram.org/bot' + tokM + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: '✅ وصل ردّك للعضو #' + sid, reply_to_message_id: msg.message_id }) }); } catch (e) {}
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, delivered: 'member-' + sid }) };
    }

    const tag = /#T([A-Za-z0-9_-]+)/.exec(replyTo.text);
    if (!tag) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'no-tag' }) };
    const code = tag[1];
    const text = String(msg.text).trim().slice(0, 2000);
    if (!text) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'empty' }) };

    await ensureTables();
    const sql = getSql();

    const amb = await sql`SELECT student_id FROM ambassador_requests WHERE code = ${code} AND status = 'approved' ORDER BY created_at DESC LIMIT 1`;
    if (!amb.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: 'unknown-code' }) };
    const studentId = amb[0].student_id;

    await sql`INSERT INTO amb_messages (code, student_id, sender, body, read_by_amb) VALUES (${code}, ${studentId}, 'admin', ${text}, false)`;

    // إشعار داخل لوحة العضو
    try {
      await sql`INSERT INTO member_notifications (student_id, title, body) VALUES (${studentId}, '📩 رد جديد من الإدارة', ${text.slice(0, 300)})`;
    } catch (e) {}

    // بريد للسفير بلغته
    try {
      const st = await sql`SELECT name, email, lang FROM academy_students WHERE id = ${studentId} LIMIT 1`;
      if (st.length && st[0].email) {
        const lg = st[0].lang || 'ar';
        const T = {
          ar: { s: '📩 رد جديد من إدارة O P N LIO', h: 'مرحباً', p: 'وصلك رد جديد من الإدارة على رسالتك:', o: 'افتح لوحتك لعرض المحادثة كاملة والرد' },
          en: { s: '📩 New reply from O P N LIO', h: 'Hello', p: 'You have a new reply from the team:', o: 'Open your dashboard to view the full thread and reply' },
          de: { s: '📩 Neue Antwort von O P N LIO', h: 'Hallo', p: 'Du hast eine neue Antwort vom Team:', o: 'Öffne dein Dashboard für den vollen Verlauf' },
          fr: { s: '📩 Nouvelle réponse de O P N LIO', h: 'Bonjour', p: 'Vous avez une nouvelle réponse de l\u2019équipe :', o: 'Ouvrez votre tableau de bord pour voir le fil complet' },
          es: { s: '📩 Nueva respuesta de O P N LIO', h: 'Hola', p: 'Tienes una nueva respuesta del equipo:', o: 'Abre tu panel para ver la conversación completa' },
          tr: { s: '📩 O P N LIO\u2019dan yeni yanıt', h: 'Merhaba', p: 'Ekipten yeni bir yanıt aldınız:', o: 'Tüm yazışmayı görmek için panelinizi açın' },
          pt: { s: '📩 Nova resposta da O P N LIO', h: 'Olá', p: 'Você recebeu uma nova resposta da equipe:', o: 'Abra seu painel para ver a conversa completa' },
          it: { s: '📩 Nuova risposta da O P N LIO', h: 'Ciao', p: 'Hai una nuova risposta dal team:', o: 'Apri la tua dashboard per vedere l\u2019intera conversazione' }
        }[lg] || null;
        const t = T || { s: '📩 New reply from O P N LIO', h: 'Hello', p: 'You have a new reply from the team:', o: 'Open your dashboard to view the full thread and reply' };
        const dir = (lg === 'ar') ? 'rtl' : 'ltr';
        const html = '<div dir="' + dir + '">' + t.h + ' <b>' + (st[0].name || '') + '</b> 👋<br><br>' + t.p +
          '<br><br><div style="background:#f6f3e8;border-inline-start:3px solid #D4AF37;padding:12px 14px;border-radius:8px;">' +
          String(text).replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div><br>' +
          '<a href="https://opnlio.com/member-dashboard.html" style="color:#D4AF37;font-weight:800;">' + t.o + ' ←</a></div>';
        await sendMail(st[0].email, t.s, t.p, html, lg);
      }
    } catch (e) {}

    // تأكيد بسيط داخل تيليجرام
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    if (tok) {
      try {
        await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '✅ وصل ردّك للسفير ' + code, reply_to_message_id: msg.message_id })
        });
      } catch (e) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, delivered: code }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: String(e && e.message).slice(0, 200) }) };
  }
};
