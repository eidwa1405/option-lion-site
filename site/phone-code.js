/* حقل مفتاح الدولة الموحد — يحوّل كل حقل جوال (type="tel") إلى: قائمة أعلام + مفاتيح، والافتراضي حسب لغة الصفحة.
   يبقي الحقل الأصلي (بنفس id) مخفياً ومتزامناً بالقيمة الدولية الكاملة، فلا يتأثر أي كود تحقق قائم. */
(function(){
  var CODES = [["SA","+966"],["AE","+971"],["KW","+965"],["QA","+974"],["BH","+973"],["OM","+968"],["EG","+20"],["JO","+962"],["IQ","+964"],["LB","+961"],["SY","+963"],["PS","+970"],["YE","+967"],["DZ","+213"],["MA","+212"],["TN","+216"],["LY","+218"],["SD","+249"],["MR","+222"],["SO","+252"],["DJ","+253"],["KM","+269"],
  ["US","+1"],["CA","+1"],["GB","+44"],["DE","+49"],["FR","+33"],["ES","+34"],["IT","+39"],["PT","+351"],["TR","+90"],["PK","+92"],["IN","+91"],["BD","+880"],["AF","+93"],["IR","+98"],["ID","+62"],["MY","+60"],["SG","+65"],["BN","+673"],["PH","+63"],["TH","+66"],["VN","+84"],["CN","+86"],["HK","+852"],["TW","+886"],["JP","+81"],["KR","+82"],["KZ","+7"],["UZ","+998"],["AZ","+994"],["RU","+7"],["UA","+380"],["BY","+375"],
  ["NL","+31"],["BE","+32"],["CH","+41"],["AT","+43"],["SE","+46"],["NO","+47"],["DK","+45"],["FI","+358"],["IE","+353"],["PL","+48"],["CZ","+420"],["SK","+421"],["HU","+36"],["RO","+40"],["BG","+359"],["GR","+30"],["RS","+381"],["HR","+385"],["BA","+387"],["AL","+355"],["MK","+389"],["XK","+383"],["SI","+386"],["LT","+370"],["LV","+371"],["EE","+372"],["IS","+354"],["MT","+356"],["CY","+357"],["LU","+352"],
  ["AU","+61"],["NZ","+64"],["BR","+55"],["AR","+54"],["MX","+52"],["CL","+56"],["CO","+57"],["PE","+51"],["VE","+58"],["EC","+593"],["BO","+591"],["PY","+595"],["UY","+598"],["PA","+507"],["CR","+506"],["GT","+502"],["DO","+1809"],["CU","+53"],
  ["ZA","+27"],["NG","+234"],["KE","+254"],["ET","+251"],["GH","+233"],["TZ","+255"],["UG","+256"],["SN","+221"],["CI","+225"],["CM","+237"],["ML","+223"],["NE","+227"],["TD","+235"],["GN","+224"],["RW","+250"],["ZM","+260"],["ZW","+263"],["MZ","+258"],["AO","+244"],["GE","+995"],["AM","+374"],["MD","+373"],["MN","+976"],["NP","+977"],["LK","+94"],["MM","+95"],["KH","+855"],["LA","+856"],["MV","+960"]];
  function flag(cc){ return String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1)); }
  var DEF = { ar:"SA", en:"US", de:"DE", fr:"FR", es:"ES", tr:"TR", pt:"PT", ur:"PK", it:"IT" };
  function upgrade(orig){
    if (orig.dataset.ccDone) return;
    orig.dataset.ccDone = "1";
    var lang = (document.documentElement.lang || "ar").slice(0, 2).toLowerCase();
    var defCC = DEF[lang] || "SA";
    var row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px; direction:ltr;";
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", "Country code");
    sel.style.cssText = "flex:0 0 auto; width:118px; padding:12px 8px; border-radius:10px; border:1px solid rgba(212,175,55,.25); background:#0d1322; color:#fff; font-size:14px; font-family:inherit; cursor:pointer;";
    CODES.forEach(function(c){
      var o = document.createElement("option");
      o.value = c[1];
      o.textContent = flag(c[0]) + " " + c[1];
      if (c[0] === defCC) o.selected = true;
      sel.appendChild(o);
    });
    var local = document.createElement("input");
    local.type = "tel"; local.inputMode = "tel";
    local.placeholder = "5xxxxxxxx";
    local.dataset.ccDone = "1";
    local.style.cssText = "flex:1; min-width:0; box-sizing:border-box; padding:12px 14px; border-radius:10px; border:1px solid rgba(212,175,55,.25); background:rgba(0,0,0,.25); color:#fff; font-size:14.5px; direction:ltr; text-align:left; font-family:inherit;";
    // قيمة سابقة؟ فكّها
    var pre = (orig.value || "").trim();
    if (pre.charAt(0) === "+"){
      var best = null;
      CODES.forEach(function(c){ if (pre.indexOf(c[1]) === 0 && (!best || c[1].length > best.length)) best = c[1]; });
      if (best){ sel.value = best; local.value = pre.slice(best.length); }
    }
    function sync(){
      local.value = local.value.replace(/[^0-9]/g, "").replace(/^0+/, "");
      orig.value = local.value ? (sel.value + local.value) : "";
      orig.dispatchEvent(new Event("input", { bubbles: true }));
    }
    sel.addEventListener("change", sync);
    local.addEventListener("input", sync);
    orig.style.display = "none";
    orig.parentNode.insertBefore(row, orig);
    row.appendChild(sel);
    row.appendChild(local);
  }
  function run(){
    var inputs = document.querySelectorAll('input[type="tel"]');
    for (var i = 0; i < inputs.length; i++) upgrade(inputs[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
