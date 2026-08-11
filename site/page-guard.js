(function(){
  var page = document.currentScript && document.currentScript.getAttribute('data-page');
  if (!page) return;
  fetch('/.netlify/functions/admin-data?action=page-visibility').then(function(r){return r.json();}).then(function(res){
    if (res && res.ok && res.hidden && res.hidden[page]) {
      document.body.innerHTML = '<div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:#070d18; color:#e9edf5; font-family:Tajawal,Inter,sans-serif; text-align:center; padding:20px;"><div><div style="font-size:40px; margin-bottom:16px;">🦁</div><h1 style="font-size:22px; margin:0 0 10px;">هذه الصفحة غير متاحة حالياً</h1><p style="color:#8a93a8; font-size:14px;">This page is temporarily unavailable — يرجى المحاولة لاحقاً</p><a href="./index.html" style="display:inline-block; margin-top:18px; color:#D4AF37; font-weight:800;">↩ الرئيسية</a></div></div>';
    }
  }).catch(function(){});
})();
