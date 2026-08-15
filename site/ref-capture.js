(function(){
  try {
    var params = new URLSearchParams(location.search);
    var ref = params.get('ref');
    if (ref && /^[A-Za-z0-9]{3,20}$/.test(ref)) {
      localStorage.setItem('opnlio_ref_code', JSON.stringify({ code: ref.toUpperCase(), ts: Date.now() }));
    }
  } catch(e){}
})();
