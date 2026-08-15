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
    ar:{dir:'rtl',title:'🔒 برنامج احتراف التداول من الصفر',body:'رسم تسجيل رمزي لمرة واحدة $1 +15% يفتح 11 مستوى تدريبياً كاملة + اختبار التخرّج + شهادة الاجتياز.<br><b style="color:#39FF14;">أما مسار منظومة O P N LIO فمجاني تماماً</b> ولا يحتاج هذا الرسم.',btn:'ادفع الآن — $1 +15%',note:'بعد الدفع يُفتح الوصول تلقائياً خلال لحظات.',free:'⚜ تصفّح المسار المجاني ←'},
    en:{dir:'ltr',title:'🔒 Pro Trading Program — from zero',body:'A one-time symbolic $1 +15% enrollment fee unlocks all 11 training levels + the graduation exam + the certificate.<br><b style="color:#39FF14;">The O P N LIO system track is completely free</b> and does not require this fee.',btn:'Pay now — $1 +15%',note:'Access unlocks automatically moments after payment.',free:'⚜ Browse the free track →'},
    de:{dir:'ltr',title:'🔒 Profi-Trading-Programm — von null',body:'Eine einmalige symbolische Gebühr von $1 +15% schaltet alle 11 Trainingslevel + die Abschlussprüfung + das Zertifikat frei.<br><b style="color:#39FF14;">Der O P N LIO Systempfad ist völlig kostenlos</b> und erfordert diese Gebühr nicht.',btn:'Jetzt zahlen — $1 +15%',note:'Der Zugang wird kurz nach der Zahlung automatisch freigeschaltet.',free:'⚜ Kostenlosen Pfad ansehen →'},
    fr:{dir:'ltr',title:'🔒 Programme de trading pro — depuis zéro',body:'Des frais symboliques uniques de $1 +15% débloquent les 11 niveaux de formation + l\u2019examen final + le certificat.<br><b style="color:#39FF14;">Le parcours système O P N LIO est entièrement gratuit</b> et ne nécessite pas ces frais.',btn:'Payer — $1 +15%',note:'L\u2019accès est débloqué automatiquement quelques instants après le paiement.',free:'⚜ Voir le parcours gratuit →'},
    es:{dir:'ltr',title:'🔒 Programa de trading pro — desde cero',body:'Una cuota simbólica única de $1 +15% desbloquea los 11 niveles de formación + el examen de graduación + el certificado.<br><b style="color:#39FF14;">La ruta del sistema O P N LIO es totalmente gratis</b> y no requiere esta cuota.',btn:'Pagar ahora — $1 +15%',note:'El acceso se desbloquea automáticamente momentos después del pago.',free:'⚜ Ver la ruta gratuita →'},
    tr:{dir:'ltr',title:'🔒 Profesyonel Trade Programı — sıfırdan',body:'Tek seferlik sembolik $1 +15% kayıt ücreti 11 eğitim seviyesinin tümünü + mezuniyet sınavını + sertifikayı açar.<br><b style="color:#39FF14;">O P N LIO sistem yolu ise tamamen ücretsizdir</b> ve bu ücreti gerektirmez.',btn:'Şimdi öde — $1 +15%',note:'Ödemeden kısa süre sonra erişim otomatik açılır.',free:'⚜ Ücretsiz yolu incele →'},
    pt:{dir:'ltr',title:'🔒 Programa de trading pro — do zero',body:'Uma taxa simbólica única de $1 +15% desbloqueia os 11 níveis de treinamento + o exame de formatura + o certificado.<br><b style="color:#39FF14;">A trilha do sistema O P N LIO é totalmente grátis</b> e não exige esta taxa.',btn:'Pagar agora — $1 +15%',note:'O acesso é liberado automaticamente momentos após o pagamento.',free:'⚜ Ver a trilha gratuita →'},
    it:{dir:'ltr',title:'🔒 Programma di trading pro — da zero',body:'Una tariffa simbolica una tantum di $1 +15% sblocca tutti gli 11 livelli di formazione + l\u2019esame finale + il certificato.<br><b style="color:#39FF14;">Il percorso del sistema O P N LIO è totalmente gratuito</b> e non richiede questa tariffa.',btn:'Paga ora — $1 +15%',note:'L\u2019accesso si sblocca automaticamente pochi istanti dopo il pagamento.',free:'⚜ Sfoglia il percorso gratuito →'}
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
        + '<div style="font-size:12px;color:#8a93a8;margin-top:12px;">'+s.note+'</div>'
        + (s.free ? '<div style="margin-top:14px;"><a href="#free" id="acadFreeLink" style="display:inline-block;font-size:12.5px;font-weight:800;color:#39FF14;text-decoration:none;border:1px solid rgba(57,255,20,.35);padding:8px 18px;border-radius:18px;">'+s.free+'</a></div>' : '');
      host.insertBefore(d, host.firstChild);
      var fl = d.querySelector('#acadFreeLink');
      if (fl) fl.addEventListener('click', function(){ try { if (typeof switchTrack === 'function') switchTrack('free'); } catch(e){} });
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
