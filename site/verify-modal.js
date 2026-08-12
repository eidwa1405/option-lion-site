/* OPN LIO — elegant email verification modal (replaces prompt()).
   Usage: openVerifyModal({ email, lang, onSuccess(email), onCancel() });
   Handles /api/check-verify-code internally; resend via /api/send-verify-code. */
(function(){
  if (window.openVerifyModal) return;

  var STR = {
    ar:{dir:'rtl',title:'تحقّق من بريدك',sub:'أدخل الرمز المكوّن من 6 أرقام المُرسَل إلى',btn:'مصادقة',verifying:'جارِ التحقق…',success:'تم التحقق بنجاح',resend:'لم يصلك الرمز؟ إعادة الإرسال',resendIn:'إعادة الإرسال خلال',sec:'ث',resending:'جارِ الإرسال…',resent:'تم إرسال رمز جديد ✓',errInvalid:'رمز غير صحيح، حاول مجدداً',errIncomplete:'أدخل الأرقام الستة كاملة',errNet:'تعذّر الاتصال بالخادم',close:'إغلاق'},
    en:{dir:'ltr',title:'Verify your email',sub:'Enter the 6-digit code sent to',btn:'Authenticate',verifying:'Verifying…',success:'Verified successfully',resend:"Didn't get the code? Resend",resendIn:'Resend in',sec:'s',resending:'Sending…',resent:'New code sent ✓',errInvalid:'Invalid code, try again',errIncomplete:'Enter all 6 digits',errNet:'Could not reach server',close:'Close'},
    de:{dir:'ltr',title:'E-Mail bestätigen',sub:'Geben Sie den 6-stelligen Code ein, gesendet an',btn:'Authentifizieren',verifying:'Wird überprüft…',success:'Erfolgreich bestätigt',resend:'Keinen Code erhalten? Erneut senden',resendIn:'Erneut senden in',sec:'s',resending:'Wird gesendet…',resent:'Neuer Code gesendet ✓',errInvalid:'Ungültiger Code, erneut versuchen',errIncomplete:'Geben Sie alle 6 Ziffern ein',errNet:'Server nicht erreichbar',close:'Schließen'},
    fr:{dir:'ltr',title:'Vérifiez votre e-mail',sub:'Saisissez le code à 6 chiffres envoyé à',btn:'Authentifier',verifying:'Vérification…',success:'Vérifié avec succès',resend:'Code non reçu ? Renvoyer',resendIn:'Renvoyer dans',sec:'s',resending:'Envoi…',resent:'Nouveau code envoyé ✓',errInvalid:'Code invalide, réessayez',errIncomplete:'Saisissez les 6 chiffres',errNet:'Serveur injoignable',close:'Fermer'},
    es:{dir:'ltr',title:'Verifica tu correo',sub:'Ingresa el código de 6 dígitos enviado a',btn:'Autenticar',verifying:'Verificando…',success:'Verificado con éxito',resend:'¿No recibiste el código? Reenviar',resendIn:'Reenviar en',sec:'s',resending:'Enviando…',resent:'Nuevo código enviado ✓',errInvalid:'Código inválido, inténtalo de nuevo',errIncomplete:'Ingresa los 6 dígitos',errNet:'No se pudo conectar al servidor',close:'Cerrar'},
    tr:{dir:'ltr',title:'E-postanı doğrula',sub:'Şu adrese gönderilen 6 haneli kodu girin:',btn:'Doğrula',verifying:'Doğrulanıyor…',success:'Başarıyla doğrulandı',resend:'Kod gelmedi mi? Yeniden gönder',resendIn:'Yeniden gönder',sec:'sn',resending:'Gönderiliyor…',resent:'Yeni kod gönderildi ✓',errInvalid:'Geçersiz kod, tekrar deneyin',errIncomplete:'6 hanenin tümünü girin',errNet:'Sunucuya ulaşılamadı',close:'Kapat'},
    pt:{dir:'ltr',title:'Verifique seu e-mail',sub:'Digite o código de 6 dígitos enviado para',btn:'Autenticar',verifying:'Verificando…',success:'Verificado com sucesso',resend:'Não recebeu o código? Reenviar',resendIn:'Reenviar em',sec:'s',resending:'Enviando…',resent:'Novo código enviado ✓',errInvalid:'Código inválido, tente novamente',errIncomplete:'Digite os 6 dígitos',errNet:'Não foi possível conectar ao servidor',close:'Fechar'}
  };

  var GOLD='#D4AF37', GOLD2='#f0cf6c', GREEN='#39FF14', RED='#ff9b9b';

  if (!document.getElementById('opnVerifyKeyframes')){
    var st=document.createElement('style'); st.id='opnVerifyKeyframes';
    st.textContent='@keyframes opnVShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}';
    document.head.appendChild(st);
  }

  window.openVerifyModal = function(opts){
    opts = opts || {};
    var email = (opts.email||'').trim();
    var lang = opts.lang || document.documentElement.lang || 'en';
    var s = STR[lang] || STR.en;
    var onSuccess = typeof opts.onSuccess==='function'?opts.onSuccess:function(){};
    var onCancel  = typeof opts.onCancel==='function'?opts.onCancel:function(){};
    var settled=false, busy=false, cooldown=0, cdTimer=null;

    var prev=document.getElementById('opnVerifyOverlay');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    var esc=function(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var monoFont = s.dir==='rtl' ? "'Tajawal',sans-serif" : "'Inter',system-ui,-apple-system,sans-serif";

    var ov=document.createElement('div');
    ov.id='opnVerifyOverlay';
    ov.setAttribute('dir', s.dir);
    ov.style.cssText='position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,8,15,.82);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);opacity:0;transition:opacity .22s ease;font-family:'+monoFont+';';

    ov.innerHTML =
      '<div id="opnVerifyCard" style="width:100%;max-width:412px;box-sizing:border-box;position:relative;background:linear-gradient(165deg,#101a2e,#0a0f1c);border:1px solid rgba(212,175,55,.34);border-radius:20px;padding:34px 30px 26px;box-shadow:0 40px 90px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.05);transform:translateY(16px) scale(.975);transition:transform .28s cubic-bezier(.2,.85,.25,1);">'
      + '<button type="button" id="opnVClose" aria-label="'+esc(s.close)+'" style="position:absolute;top:12px;'+(s.dir==='rtl'?'left':'right')+':12px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.06);color:#c9d2e3;font-size:17px;line-height:1;cursor:pointer;">×</button>'
      + '<div style="text-align:center;margin-bottom:22px;">'
        + '<div style="width:56px;height:56px;margin:0 auto 14px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%,rgba(212,175,55,.28),rgba(212,175,55,.05));border:1px solid rgba(212,175,55,.4);font-size:26px;">✉</div>'
        + '<h3 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#fff;letter-spacing:.2px;">'+esc(s.title)+'</h3>'
        + '<p style="margin:0;font-size:13px;line-height:1.65;color:#9aa4b8;">'+esc(s.sub)+' <span dir="ltr" style="color:'+GOLD+';font-weight:700;unicode-bidi:isolate;word-break:break-all;">'+esc(email)+'</span></p>'
      + '</div>'
      + '<div id="opnVOtp" dir="ltr" style="display:flex;gap:9px;justify-content:center;margin-bottom:4px;"></div>'
      + '<div id="opnVMsg" style="min-height:18px;text-align:center;font-size:12.5px;font-weight:700;margin:10px 0 2px;color:'+RED+';"></div>'
      + '<button type="button" id="opnVSubmit" style="width:100%;margin-top:8px;padding:15px;border:none;border-radius:12px;background:linear-gradient(120deg,'+GOLD+','+GOLD2+');color:#0a0f1c;font-weight:900;font-size:15px;font-family:inherit;cursor:pointer;letter-spacing:.3px;box-shadow:0 8px 24px rgba(212,175,55,.28);transition:filter .15s,opacity .15s;">'+esc(s.btn)+'</button>'
      + '<div style="text-align:center;margin-top:16px;"><button type="button" id="opnVResend" style="background:none;border:none;color:#8a93a8;font-size:12.5px;font-family:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:4px;">'+esc(s.resend)+'</button></div>'
      + '</div>';

    document.body.appendChild(ov);
    var card=ov.querySelector('#opnVerifyCard');
    var otpWrap=ov.querySelector('#opnVOtp');
    var msg=ov.querySelector('#opnVMsg');
    var submitBtn=ov.querySelector('#opnVSubmit');
    var resendBtn=ov.querySelector('#opnVResend');
    var closeBtn=ov.querySelector('#opnVClose');

    var boxes=[];
    for (var i=0;i<6;i++){
      var inp=document.createElement('input');
      inp.type='text'; inp.inputMode='numeric'; inp.autocomplete='one-time-code'; inp.maxLength=1;
      inp.setAttribute('aria-label','digit '+(i+1));
      inp.style.cssText='width:44px;height:54px;text-align:center;font-size:23px;font-weight:800;color:#fff;background:rgba(0,0,0,.32);border:1.5px solid rgba(212,175,55,.28);border-radius:12px;font-family:'+monoFont+';caret-color:'+GOLD+';outline:none;transition:border-color .15s,box-shadow .15s,background .15s;padding:0;box-sizing:border-box;';
      otpWrap.appendChild(inp); boxes.push(inp);
    }
    function setFocus(el){ el.style.borderColor=GOLD; el.style.boxShadow='0 0 0 3px rgba(212,175,55,.16)'; el.style.background='rgba(0,0,0,.5)'; }
    function setBlur(el){ el.style.boxShadow='none'; el.style.background='rgba(0,0,0,.32)'; el.style.borderColor = el.value ? 'rgba(212,175,55,.6)' : 'rgba(212,175,55,.28)'; }
    function getCode(){ return boxes.map(function(b){return b.value;}).join(''); }
    function clearMsg(){ msg.textContent=''; }
    function showMsg(t,c){ msg.textContent=t; msg.style.color=c||RED; }
    function shake(){ card.style.animation='opnVShake .4s'; setTimeout(function(){ card.style.animation=''; },420); }

    boxes.forEach(function(box,idx){
      box.addEventListener('focus',function(){ setFocus(box); if(box.select) box.select(); });
      box.addEventListener('blur',function(){ setBlur(box); });
      box.addEventListener('input',function(){
        clearMsg();
        box.value=box.value.replace(/[^0-9]/g,'').slice(-1);
        if(document.activeElement===box) setFocus(box); else setBlur(box);
        if (box.value && idx<5) boxes[idx+1].focus();
        if (getCode().length===6) submit();
      });
      box.addEventListener('keydown',function(e){
        if (e.key==='Backspace' && !box.value && idx>0){ boxes[idx-1].focus(); boxes[idx-1].value=''; setBlur(boxes[idx-1]); e.preventDefault(); }
        else if (e.key==='ArrowLeft' && idx>0){ boxes[idx-1].focus(); e.preventDefault(); }
        else if (e.key==='ArrowRight' && idx<5){ boxes[idx+1].focus(); e.preventDefault(); }
        else if (e.key==='Enter'){ e.preventDefault(); submit(); }
      });
      box.addEventListener('paste',function(e){
        e.preventDefault();
        var d=((e.clipboardData||window.clipboardData).getData('text')||'').replace(/[^0-9]/g,'').slice(0,6);
        if(!d) return;
        for(var j=0;j<6;j++){ boxes[j].value=d[j]||''; setBlur(boxes[j]); }
        boxes[Math.min(d.length,5)].focus();
        if (d.length>=6) submit();
      });
    });

    function submit(){
      if (busy||settled) return;
      var code=getCode();
      if (code.length<6){ showMsg(s.errIncomplete,RED); shake(); return; }
      busy=true; submitBtn.disabled=true; submitBtn.style.opacity='.7'; submitBtn.textContent=s.verifying; clearMsg();
      fetch('/api/check-verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,code:code})})
        .then(function(r){return r.json();}).then(function(res){
          if (res && res.ok){ succeed(); return; }
          busy=false; submitBtn.disabled=false; submitBtn.style.opacity='1'; submitBtn.textContent=s.btn;
          showMsg((res&&res.error)||s.errInvalid,RED); shake();
          boxes.forEach(function(b){ b.value=''; setBlur(b); }); boxes[0].focus();
        }).catch(function(){
          busy=false; submitBtn.disabled=false; submitBtn.style.opacity='1'; submitBtn.textContent=s.btn;
          showMsg(s.errNet,RED); shake();
        });
    }

    function succeed(){
      settled=true;
      boxes.forEach(function(b){ b.disabled=true; b.style.borderColor='rgba(57,255,20,.55)'; b.style.color=GREEN; });
      showMsg(s.success,GREEN);
      submitBtn.style.background='linear-gradient(120deg,#39FF14,#8affb0)'; submitBtn.textContent='✓'; submitBtn.disabled=true;
      setTimeout(function(){ close(true); },780);
    }

    function renderCd(){ resendBtn.disabled=true; resendBtn.style.opacity='.5'; resendBtn.style.cursor='default'; resendBtn.textContent=s.resendIn+' '+cooldown+s.sec; }
    function startCooldown(){
      cooldown=120; renderCd();
      cdTimer=setInterval(function(){
        cooldown--;
        if (cooldown<=0){ clearInterval(cdTimer); cdTimer=null; resendBtn.disabled=false; resendBtn.style.opacity='1'; resendBtn.style.cursor='pointer'; resendBtn.textContent=s.resend; }
        else renderCd();
      },1000);
    }
    resendBtn.addEventListener('click',function(){
      if (resendBtn.disabled||settled) return;
      resendBtn.disabled=true; resendBtn.style.opacity='.5'; showMsg(s.resending,'#8a93a8');
      fetch('/api/send-verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,lang:lang})})
        .then(function(r){return r.json();}).then(function(res){
          if (res && res.ok){ showMsg(s.resent,GREEN); boxes.forEach(function(b){ b.value=''; setBlur(b); }); boxes[0].focus(); startCooldown(); }
          else { showMsg((res&&res.error)||s.errNet,RED); resendBtn.disabled=false; resendBtn.style.opacity='1'; }
        }).catch(function(){ showMsg(s.errNet,RED); resendBtn.disabled=false; resendBtn.style.opacity='1'; });
    });

    function close(ok){
      if (cdTimer) clearInterval(cdTimer);
      document.removeEventListener('keydown',onKey);
      ov.style.opacity='0'; card.style.transform='translateY(16px) scale(.975)';
      setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); },220);
      if (ok) onSuccess(email); else onCancel();
    }
    function onKey(e){ if (e.key==='Escape') close(false); }

    closeBtn.addEventListener('click',function(){ close(false); });
    ov.addEventListener('mousedown',function(e){ if (e.target===ov) close(false); });
    submitBtn.addEventListener('click',submit);
    document.addEventListener('keydown',onKey);

    requestAnimationFrame(function(){ ov.style.opacity='1'; card.style.transform='translateY(0) scale(1)'; });
    setTimeout(function(){ boxes[0].focus(); },90);
    startCooldown();
  };
})();
