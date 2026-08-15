(function(){
  var page = document.currentScript && document.currentScript.getAttribute('data-page');
  if (!page) return;

  var L = {
    ar: { badge:'صيانة مجدولة', title:'نُجمّل هذه الصفحة لك الآن', body:'نُجري تحسينات سريعة على هذا القسم ليعود أفضل مما كان. شكراً لصبرك الجميل — عد إلينا قريباً.', home:'العودة للرئيسية', dir:'rtl' },
    en: { badge:'Scheduled maintenance', title:'We\u2019re polishing this page for you', body:'We\u2019re making quick improvements to this section so it comes back better than before. Thank you for your patience — see you shortly.', home:'Back to home', dir:'ltr' },
    de: { badge:'Geplante Wartung', title:'Wir verfeinern diese Seite für dich', body:'Wir nehmen schnelle Verbesserungen an diesem Bereich vor, damit er besser zurückkommt als zuvor. Danke für deine Geduld — bis gleich.', home:'Zur Startseite', dir:'ltr' },
    fr: { badge:'Maintenance planifiée', title:'Nous perfectionnons cette page pour vous', body:'Nous apportons de rapides améliorations à cette section pour qu\u2019elle revienne encore meilleure. Merci de votre patience — à très vite.', home:'Retour à l\u2019accueil', dir:'ltr' },
    es: { badge:'Mantenimiento programado', title:'Estamos puliendo esta página para ti', body:'Estamos haciendo mejoras rápidas en esta sección para que vuelva mejor que antes. Gracias por tu paciencia — nos vemos pronto.', home:'Volver al inicio', dir:'ltr' },
    tr: { badge:'Planlı bakım', title:'Bu sayfayı sizin için güzelleştiriyoruz', body:'Bu bölümde hızlı iyileştirmeler yapıyoruz; eskisinden daha iyi dönecek. Sabrınız için teşekkürler — yakında görüşürüz.', home:'Ana sayfaya dön', dir:'ltr' },
    pt: { badge:'Manutenção programada', title:'Estamos aprimorando esta página para você', body:'Estamos fazendo melhorias rápidas nesta seção para que volte melhor do que antes. Obrigado pela paciência — até breve.', home:'Voltar ao início', dir:'ltr' },
    it: { badge:'Manutenzione programmata', title:'Stiamo perfezionando questa pagina per te', body:'Stiamo apportando rapidi miglioramenti a questa sezione, perché torni migliore di prima. Grazie per la pazienza — a presto.', home:'Torna alla home', dir:'ltr' }
  };

  function pick(){
    var d = (document.documentElement.getAttribute('lang') || '').slice(0,2).toLowerCase();
    if (L[d]) return { k:d, t:L[d] };
    var n = (navigator.language || 'ar').slice(0,2).toLowerCase();
    return L[n] ? { k:n, t:L[n] } : { k:'ar', t:L.ar };
  }

  function homeHref(k){
    if (k === 'ar') return './index.html';
    if (k === 'en') return './option-lion.html';
    return './' + k + '-lion.html';
  }

  fetch('/.netlify/functions/admin-data?action=page-visibility')
    .then(function(r){ return r.text(); })
    .then(function(txt){
      var res = null; try { res = txt ? JSON.parse(txt) : null; } catch(e){ return; }
      var langs2 = ['en','de','fr','es','tr','pt','it'];
      var base = (/^([a-z]{2})-/.test(page) && langs2.indexOf(page.slice(0,2)) !== -1) ? page.slice(3) : page;
      if (!res || !res.ok || !res.hidden || !(res.hidden[page] || res.hidden[base])) return;

      var p = pick(), t = p.t;
      document.documentElement.setAttribute('dir', t.dir);
      document.title = t.title + ' — O P N LIO';

      document.body.innerHTML =
        '<div style="position:relative; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:28px 20px; overflow:hidden;' +
        ' background:radial-gradient(1100px 620px at 78% -12%, rgba(212,175,55,.16), transparent 62%), radial-gradient(880px 560px at 4% 8%, rgba(30,58,110,.5), transparent 62%), #070d18;' +
        ' color:#e9edf5; font-family:Tajawal,Inter,system-ui,sans-serif; box-sizing:border-box;">' +

          '<div style="position:absolute; inset:0; opacity:.05; background-image:linear-gradient(rgba(212,175,55,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,.5) 1px, transparent 1px); background-size:64px 64px; pointer-events:none;"></div>' +

          '<div style="position:relative; max-width:520px; width:100%; text-align:center; background:linear-gradient(165deg, rgba(212,175,55,.08), rgba(255,255,255,.028));' +
          ' border:1px solid rgba(212,175,55,.28); border-radius:24px; padding:44px 34px 38px; box-shadow:0 34px 90px rgba(0,0,0,.55);">' +

            '<div style="width:76px; height:76px; margin:0 auto 22px; border-radius:50%; display:flex; align-items:center; justify-content:center;' +
            ' background:linear-gradient(140deg, rgba(212,175,55,.22), rgba(212,175,55,.05)); border:1.5px solid rgba(212,175,55,.45);">' +
              '<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#f0cf6c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' +
                '<circle cx="12" cy="12" r="3.4"/>' +
              '</svg>' +
            '</div>' +

            '<div style="display:inline-block; font-size:11px; font-weight:800; letter-spacing:1.4px; text-transform:uppercase; color:#D4AF37;' +
            ' border:1px solid rgba(212,175,55,.4); border-radius:20px; padding:6px 16px; margin-bottom:18px;">' + t.badge + '</div>' +

            '<h1 style="margin:0 0 14px; font-size:clamp(21px,3.6vw,27px); font-weight:900; line-height:1.5;">' + t.title + '</h1>' +

            '<p style="margin:0 0 26px; font-size:14.5px; line-height:1.95; color:#aab3c5; text-wrap:pretty;">' + t.body + '</p>' +

            '<div style="display:flex; align-items:center; justify-content:center; gap:7px; margin-bottom:26px;">' +
              '<span style="width:7px; height:7px; border-radius:50%; background:#D4AF37; opacity:.95;"></span>' +
              '<span style="width:7px; height:7px; border-radius:50%; background:#D4AF37; opacity:.55;"></span>' +
              '<span style="width:7px; height:7px; border-radius:50%; background:#D4AF37; opacity:.28;"></span>' +
            '</div>' +

            '<a href="' + homeHref(p.k) + '" style="display:inline-block; padding:13px 34px; border-radius:24px; font-weight:900; font-size:14px;' +
            ' color:#070d18; background:linear-gradient(120deg,#D4AF37,#f0cf6c); text-decoration:none;">' + t.home + '</a>' +

            '<div style="margin-top:28px; font-size:12px; font-weight:800; letter-spacing:2.5px; color:rgba(212,175,55,.55);">O P N &nbsp;LIO</div>' +

          '</div>' +
        '</div>';
    })
    .catch(function(){});
})();
