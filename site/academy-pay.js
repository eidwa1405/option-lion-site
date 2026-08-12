/* OPN LIO — Academy $1 enrollment checkout + paywall gate (Paddle) */
(function(){
  var PRICE_ID = 'pri_01kzsw7et11f5r4nf08ea7yz5p';
  var TOKEN = 'live_27e72c4c8fd9d78b7752c0eaba7';
  var loading = false, ready = false, queue = [];
  function initPaddle(){
    if (ready) return;
    Paddle.Environment.set('production');
    Paddle.Initialize({ token: TOKEN });
    ready = true;
    while (queue.length) queue.shift()();
  }
  function ensurePaddle(cb){
    if (ready) return cb();
    queue.push(cb);
    if (window.Paddle) return initPaddle();
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = initPaddle;
    document.head.appendChild(s);
  }
  window.openAcademyCheckout = function(email, lang){
    ensurePaddle(function(){
      var opts = {
        items: [{ priceId: PRICE_ID, quantity: 1 }],
        customData: { product: 'academy', email: email || '' },
        settings: { displayMode: 'overlay', variant: 'one-page', successUrl: window.location.href }
      };
      if (email) opts.customer = { email: email };
      if (lang && lang !== 'ar') opts.settings.locale = lang;
      Paddle.Checkout.open(opts);
    });
  };

  var STR = {
    ar:{dir:'rtl',title:'🔒 فعّل وصولك للبرنامج',body:'رسم تسجيل لمرة واحدة $1 +15% يفتح المستويات الـ12 كاملة والشهادة.',btn:'ادفع الآن — $1 +15%',note:'بعد الدفع يُفتح الوصول تلقائياً خلال لحظات.'},
    en:{dir:'ltr',title:'🔒 Activate your access',body:'A one-time $1 +15% enrollment fee unlocks all 12 levels and the certificate.',btn:'Pay now — $1 +15%',note:'Access unlocks automatically moments after payment.'},
    de:{dir:'ltr',title:'🔒 Zugang aktivieren',body:'Eine einmalige Anmeldegebühr von $1 +15% schaltet alle 12 Stufen und das Zertifikat frei.',btn:'Jetzt zahlen — $1 +15%',note:'Der Zugang wird kurz nach der Zahlung automatisch freigeschaltet.'},
    fr:{dir:'ltr',title:'🔒 Activez votre accès',body:"Des frais d'inscription uniques de $1 +15% débloquent les 12 niveaux et le certificat.",btn:'Payer — $1 +15%',note:"L'accès est débloqué automatiquement quelques instants après le paiement."},
    es:{dir:'ltr',title:'🔒 Activa tu acceso',body:'Una cuota única de $1 +15% desbloquea los 12 niveles y el certificado.',btn:'Pagar ahora — $1 +15%',note:'El acceso se desbloquea automáticamente momentos después del pago.'},
    tr:{dir:'ltr',title:'🔒 Erişimini etkinleştir',body:'Tek seferlik $1 +15% kayıt ücreti 12 seviyenin tümünü ve sertifikayı açar.',btn:'Şimdi öde — $1 +15%',note:'Ödemeden kısa süre sonra erişim otomatik açılır.'},
    pt:{dir:'ltr',title:'🔒 Ative seu acesso',body:'Uma taxa única de $1 +15% desbloqueia os 12 níveis e o certificado.',btn:'Pagar agora — $1 +15%',note:'O acesso é liberado automaticamente momentos após o pagamento.'}
  };
  var polled = false;
  function pollPaid(session){
    if (polled || !session || !session.student || !session.student.email) return;
    polled = true;
    fetch('/.netlify/functions/academy-auth', { method:'POST', body: JSON.stringify({ action:'check-paid', email: session.student.email }) })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res && res.ok && res.paid){
          session.student.paid = true;
          try { localStorage.setItem('opnlio_academy_session', JSON.stringify(session)); } catch(e){}
          location.reload();
        }
      }).catch(function(){});
  }
  // returns true when the student may open lessons; otherwise shows the pay banner
  window.academyGate = function(session, lang){
    if (!session || !session.student) return false;
    var host = document.getElementById('dashScreen');
    var old = document.getElementById('acadPayGate');
    if (session.student.paid){ if (old) old.remove(); return true; }
    var s = STR[lang] || STR.en;
    if (!old && host){
      var d = document.createElement('div');
      d.id = 'acadPayGate';
      d.setAttribute('dir', s.dir);
      d.style.cssText = 'background:linear-gradient(150deg,rgba(212,175,55,.16),rgba(212,175,55,.04));border:1.5px solid #D4AF37;border-radius:18px;padding:24px;margin-bottom:24px;text-align:center;transition:box-shadow .25s;';
      d.innerHTML = '<div style="font-size:18px;font-weight:900;color:#fff;margin-bottom:8px;">'+s.title+'</div>'
        + '<p style="font-size:14px;color:#c9d2e3;line-height:1.8;margin:0 0 16px;">'+s.body+'</p>'
        + '<button id="acadPayBtn" style="background:linear-gradient(135deg,#D4AF37,#f0cf6c);color:#1a1408;font-weight:900;border:none;border-radius:12px;padding:14px 34px;font-size:15px;cursor:pointer;font-family:inherit;">'+s.btn+'</button>'
        + '<div style="font-size:12px;color:#8a93a8;margin-top:12px;">'+s.note+'</div>';
      host.insertBefore(d, host.firstChild);
      d.querySelector('#acadPayBtn').addEventListener('click', function(){
        window.openAcademyCheckout(session.student.email, lang);
      });
    } else if (old){
      old.style.boxShadow = '0 0 0 4px rgba(212,175,55,.35)';
      setTimeout(function(){ old.style.boxShadow = 'none'; }, 500);
      try { window.scrollTo(0, 0); } catch(e){}
    }
    pollPaid(session);
    return false;
  };
})();
