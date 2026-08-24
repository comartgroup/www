/* =========================================================
   COMART 官網後台
   ---------------------------------------------------------
   資料全部經由 SB（webadmin/supabase.js）存取，沒有本機備份。
   登入用 Supabase Auth；讀寫受資料庫 RLS 政策管制，前端擋不住的事
   資料庫會擋住。

   資料表對應：
     web_pages            頁面標題與導言（三語 jsonb）
     web_news             公司動態（三語 jsonb）
     web_product_settings 產品上架設定
     web_products_admin   後台用產品清單 view（需登入，不含成本與供應商）
     web_enquiries        詢價案件（客戶個資，只有登入者可讀）
   ========================================================= */
(function () {
  "use strict";

  /* 產品清單一次抓幾筆。PostgREST 回傳筆數等於上限時無法分辨
     「剛好這麼多」與「被截斷」，所以下面會在達到上限時明說。 */
  var PROD_LIMIT = 2000;

  var LANGS = [
    { key: "en",    label: "English" },
    { key: "zh-TW", label: "繁體中文" },
    { key: "vi",    label: "Tiếng Việt" }
  ];

  /* 頁面清冊：與 build.py 的 src/content/pages.en.json 對應 */
  var PAGE_SEED = [
    { id: "home",       path: "/",                    name: "首頁 Home",            fields: ["hero_title", "hero_sub"] },
    { id: "services",   path: "/services/",           name: "Services 總覽",         fields: ["title", "lead"] },
    { id: "operations", path: "/global-operations/",  name: "Global Operations",    fields: ["title", "lead"] },
    { id: "products",   path: "/products/",           name: "Products",             fields: ["title", "lead"] },
    { id: "quality",    path: "/quality-compliance/", name: "Quality & Compliance", fields: ["title", "lead"] },
    { id: "equipment",  path: "/equipment/",          name: "Equipment",            fields: ["title", "lead"] },
    { id: "company",    path: "/company/",            name: "Company",              fields: ["title", "lead"] },
    { id: "news",       path: "/news/",               name: "News",                 fields: ["title", "lead"] },
    { id: "inquiry",    path: "/inquiry/",            name: "Inquiry",              fields: ["title", "lead"] },
    { id: "start",      path: "/start-your-project/", name: "Start Your Project",   fields: ["title", "lead"] }
  ];
  var FIELD_LABEL = {
    hero_title: "主標題", hero_sub: "副標題", title: "頁面標題", lead: "導言",
    title_news: "標題", body: "內文"
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var body, title, desc, actions;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function flash(el, msg) {
    if (!el) return;
    if (msg) el.textContent = msg;
    el.classList.add("is-on");
    setTimeout(function () { el.classList.remove("is-on"); }, 2200);
  }
  function statusPill(s) {
    var m = { live: ["is-live", "已上線"], draft: ["is-draft", "草稿"], off: ["is-off", "未上架"] };
    var v = m[s] || m.draft;
    return '<span class="pill ' + v[0] + '">' + v[1] + "</span>";
  }
  function busy(msg) { body.innerHTML = '<div class="empty">' + esc(msg || "載入中…") + "</div>"; }
  function fail(e, what) {
    console.error("[admin]", what, e);
    var hint = "";
    if (e && e.status === 401) hint = "登入已過期，請重新登入。";
    else if (e && e.status === 404) hint = "資料表或 view 不存在——docs/sql/ 底下的 SQL 可能還沒執行。";
    else if (e && e.status === 403) hint = "權限不足：這個帳號的 RLS 政策不允許此操作。";
    else if (e && !e.status) hint = "連不到伺服器。若這是 Edge Function，代表尚未部署；否則請檢查網路。";
    body.innerHTML = '<div class="panel"><div class="panel__body">' +
      '<div class="note"><b>' + esc(what) + '失敗。</b>' + esc(hint || (e && e.message) || "未知錯誤") +
      "</div></div></div>";
  }

  /* ---------- 三語欄位 ---------- */

  function langBlock(scope, field, label, multiline, value) {
    var v = value || {};
    var tabs = LANGS.map(function (l, i) {
      var filled = (v[l.key] || "").trim().length > 0;
      return '<button type="button" class="langtab' + (i === 0 ? " is-on" : "") +
             '" data-lang="' + l.key + '">' + l.label +
             '<span class="dot' + (filled ? " is-full" : "") + '"></span></button>';
    }).join("");
    var inputs = LANGS.map(function (l, i) {
      var attrs = 'data-scope="' + scope + '" data-field="' + field + '" data-lang="' + l.key + '"' +
                  (i === 0 ? "" : " hidden");
      return multiline
        ? "<textarea " + attrs + ">" + esc(v[l.key] || "") + "</textarea>"
        : '<input type="text" ' + attrs + ' value="' + esc(v[l.key] || "") + '">';
    }).join("");
    return '<div class="fieldrow" data-block="' + field + '"><label>' + esc(label) + "</label>" +
           '<div class="langtabs" data-tabs="' + field + '">' + tabs + "</div>" + inputs +
           '<div class="hint"><button type="button" class="btn btn--sm" data-translate="' + field +
           '">從英文自動翻譯</button> <span class="tstate" data-tstate="' + field + '"></span></div></div>';
  }

  /** 從畫面收集某個 scope 的所有三語欄位值 */
  function collect(root, scope) {
    var out = {};
    root.querySelectorAll('[data-scope="' + scope + '"]').forEach(function (el) {
      (out[el.dataset.field] || (out[el.dataset.field] = {}))[el.dataset.lang] = el.value;
    });
    return out;
  }

  function wireLangBlocks(root) {
    root.addEventListener("click", function (e) {
      var tab = e.target.closest(".langtab");
      if (tab) {
        var wrap = tab.closest(".langtabs");
        var field = wrap.dataset.tabs;
        wrap.querySelectorAll(".langtab").forEach(function (t) { t.classList.remove("is-on"); });
        tab.classList.add("is-on");
        root.querySelectorAll('[data-field="' + field + '"]').forEach(function (el) {
          if (el.classList.contains("langtab")) return;
          el.hidden = el.dataset.lang !== tab.dataset.lang;
        });
        return;
      }

      var tbtn = e.target.closest("[data-translate]");
      if (tbtn) {
        var f = tbtn.dataset.translate;
        var src = root.querySelector('[data-field="' + f + '"][data-lang="en"]');
        var state = root.querySelector('[data-tstate="' + f + '"]');
        if (!src || !src.value.trim()) { state.textContent = "英文欄位是空的"; return; }
        tbtn.disabled = true; state.textContent = "翻譯中…";
        SB.fn.translate(src.value, "en", ["zh-TW", "vi"], FIELD_LABEL[f] || f)
          .then(function (r) {
            Object.keys(r.translations || {}).forEach(function (lang) {
              var el = root.querySelector('[data-field="' + f + '"][data-lang="' + lang + '"]');
              if (el) el.value = r.translations[lang];
              var dot = root.querySelector('.langtabs[data-tabs="' + f + '"] [data-lang="' + lang + '"] .dot');
              if (dot) dot.classList.add("is-full");
            });
            state.textContent = "完成，請人工確認後再儲存";
          })
          .catch(function (err) {
            state.textContent = (err.status === 404 || !err.status)
              ? "translate function 尚未部署"
              : "翻譯失敗：" + (err.message || "");
          })
          .then(function () { tbtn.disabled = false; });
      }
    });

    root.addEventListener("input", function (e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.field) return;
      var dot = root.querySelector('.langtabs[data-tabs="' + el.dataset.field +
                                  '"] [data-lang="' + el.dataset.lang + '"] .dot');
      if (dot) dot.classList.toggle("is-full", el.value.trim().length > 0);
    });
  }

  var ROLE_OPTS = [
    ["admin",     "管理者 — 含使用者管理"],
    ["editor",    "內容編輯 — 頁面與動態"],
    ["product",   "產品編輯 — 只管上架"],
    ["publisher", "發布者 — 可切換上線狀態"]
  ];

  var PW_HINT = "至少 10 碼，不能是常見密碼。長一點的普通句子比夾符號的短密碼更安全。";

  /* ---------------------------------------------------------
     密碼原則（2026-08-24）：長度 + 黑名單，不要求大小寫與符號。
     組成規則會把人逼向 Password1! 這種可預測的形狀——那正是
     攻擊者最先猜的一批。詳見 supabase/functions/admin-users/index.ts。

     ★ 以下規則是從該 Edge Function 抄過來的，兩邊必須一致。
       這裡只是讓使用者少跑一趟；真正的關卡在伺服器端，
       而且伺服器端多一道 Have I Been Pwned 查詢（前端不做，
       不想在每次按鍵時發外部請求）。所以前端說「符合原則」之後
       仍可能被伺服器擋下，那時會顯示伺服器回傳的具體理由。
     --------------------------------------------------------- */
  /** 實際外洩清單裡最常出現的那批。HIBP 涵蓋得更全，這份是離線時的下限。 */
  var COMMON_PASSWORDS = new Set([
    "password", "passwort", "passord", "senha", "contrasena", "motdepasse",
    "qwerty", "qwertyuiop", "azerty", "qazwsx", "zxcvbnm", "asdfghjkl",
    "letmein", "welcome", "admin", "administrator", "root", "guest", "user",
    "login", "pass", "secret", "changeme", "default", "temp", "test", "demo",
    "iloveyou", "princess", "sunshine", "monkey", "dragon", "football",
    "baseball", "basketball", "superman", "batman", "pokemon", "starwars",
    "trustno", "whatever", "freedom", "shadow", "master", "michael",
    "jennifer", "jordan", "harley", "ranger", "hunter", "buster", "thomas",
    "robert", "soccer", "hockey", "killer", "george", "andrew", "charlie",
    "daniel", "matthew", "joshua", "michelle", "jessica", "ashley",
    "abc", "abcd", "abcdef", "abcdefg", "abcdefgh", "abcabc",
    "aaaaaa", "iloveu", "lovely", "chocolate", "cookie", "flower", "summer",
    "winter", "spring", "autumn", "january", "december", "money", "office",
    "computer", "internet", "samsung", "google", "facebook", "apple",
    "taiwan", "taipei", "vietnam", "hanoi", "china", "shenzhen", "dongguan",
    "comart", "comartgroup", "company", "business", "sales", "manager",
    "wang", "chen", "liu", "huang", "woody",
    "woaini", "womenzaiyiqi", "wanmeishijie", "taijiquan", "shanghai",
    "beijing", "zhonghua", "nihao"
  ]);

  /** 常見的字元替換折回原字，讓 P@ssw0rd 與 password 視為同一個。 */
  var LEET = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
    "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "(": "c",
  };

  /** 折成比對用的形式：小寫、還原字元替換、只留字母。 */
  function fold(pw) {
    return pw.toLowerCase()
      .split("").map((c) => LEET[c] ?? c).join("")
      .replace(/[^a-z]/g, "");
  }

  /**
   * 產生所有要拿去比對黑名單的候選形式。
   *
   * 為什麼需要多個：LEET 會把 "!" 折成 "i"，所以 "P@ssw0rd!!" 直接 fold
   * 會得到 "passwordii" 而比對不到 "password"。頭尾的裝飾字元要先剝掉再折。
   */
  function foldCandidates(pw) {
    var low = pw.toLowerCase();
    var trimmed = low.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
    return [
      fold(low),
      fold(trimmed),                            // 去頭尾符號："p@ssw0rd" → password
      fold(trimmed.replace(/\d+$/, "")),        // 再去尾端數字："password2026" → password
      fold(low.replace(/[^a-z]/g, "")),          // 只留字母，不做替換
    ].filter(Boolean);
  }

  /** 鍵盤序列或連續字元，例如 1234567890、qwertyuiop、aaaaaaaaaa */
  function isSequential(pw) {
    var low = pw.toLowerCase();
    if (/^(.)\1+$/.test(low)) return true;                 // 全部同一個字元
    var runs = ["abcdefghijklmnopqrstuvwxyz",
                  "0123456789", "1234567890",   // 數值順序與鍵盤數字列是兩回事
                  "qwertyuiop", "asdfghjkl", "zxcvbnm"];
    for (var i = 0; i < runs.length; i++) {
      var rev = runs[i].split("").reverse().join("");
      // 密碼整體就是某條序列的一段（含反向）才算，避免誤殺內含 abc 的長密碼
      if (runs[i].includes(low) || rev.includes(low)) return true;
    }
    return false;
  }

  /** 密碼原則檢查（本地部分）。回傳問題描述，或 null 表示通過。 */
  function pwProblem(pw, email) {
    if (!pw) return "請輸入密碼";
    if (pw.length < 10) return "密碼至少 10 碼";
    var cands = foldCandidates(pw);
    for (var i = 0; i < cands.length; i++) {
      if (COMMON_PASSWORDS.has(cands[i])) return "這是常見密碼，請換一個";
    }
    if (isSequential(pw)) return "不能使用連續字元或鍵盤序列";
    if (/comart/i.test(pw)) return "密碼不能包含公司名稱";
    var local = String(email || "").split("@")[0].toLowerCase();
    if (local.length >= 3 && pw.toLowerCase().indexOf(local) !== -1) {
      return "密碼不能包含自己的帳號名稱";
    }
    return null;
  }

  /** 密碼輸入列：附即時檢查與顯示／隱藏切換 */
  function pwField(id, label) {
    return '<div class="fieldrow"><label>' + esc(label) + "</label>" +
      '<div class="pwrow">' +
        '<input type="password" id="' + id + '" autocomplete="new-password" ' +
        'spellcheck="false" placeholder="' + esc(PW_HINT) + '">' +
        '<button type="button" class="btn btn--sm" data-reveal="' + id + '">顯示</button>' +
      "</div>" +
      '<div class="hint" id="' + id + 'Hint">' + esc(PW_HINT) + "</div></div>";
  }

  /** 綁定顯示切換與即時檢查 */
  function wirePwField(root, id, emailOf) {
    var input = $("#" + id, root);
    var hint = $("#" + id + "Hint", root);
    var btn = root.querySelector('[data-reveal="' + id + '"]');
    if (btn) btn.onclick = function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "隱藏" : "顯示";
    };
    input.addEventListener("input", function () {
      if (!input.value) { hint.textContent = PW_HINT; hint.className = "hint"; return; }
      var bad = pwProblem(input.value, emailOf ? emailOf() : "");
      hint.textContent = bad || "符合原則";
      hint.className = bad ? "hint is-bad" : "hint is-ok";
    });
    return input;
  }

  function renderUserForm() {
    var host = $("#userForm");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>新增使用者</h3>' +
      "<p>密碼由你設定，之後自行轉達給對方</p></div></div>" +
      '<div class="panel__body">' +
      '<div class="fieldrow"><label>Email</label>' +
      '<input type="email" id="nuEmail" placeholder="name@comart.com.tw" ' +
      'autocomplete="off" spellcheck="false"></div>' +
      pwField("nuPw", "密碼") +
      '<div class="fieldrow"><label>權限</label><select id="nuRole">' +
      ROLE_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="note" style="margin-top:20px">' +
      "此密碼<b>只用於官網後台</b>，與 KMS、報價系統、CRM、CPF、內部 Portal 各自獨立——" +
      "那些系統是用工號登入、密碼另存一套，在這裡設定不會影響它們。<br>" +
      "系統不會寄信通知，請自行把帳號與密碼轉達給對方。<br>" +
      "若這個 Email 已經有帳號，只會把他加進編輯名單，<b>不會變更他原有的密碼</b>。</div>" +
      '<div class="rowactions">' +
      '<button class="btn btn--primary" id="nuCreate">新增使用者</button>' +
      '<span class="saved" id="nuState"></span></div></div></div>';
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    var pw = wirePwField(host, "nuPw", function () { return $("#nuEmail", host).value; });

    $("#nuCreate").onclick = function () {
      var email = $("#nuEmail").value.trim().toLowerCase();
      if (!email || email.indexOf("@") < 1) { flash($("#nuState"), "Email 格式看起來不對"); return; }
      var bad = pwProblem(pw.value, $("#nuEmail", host).value);
      if (bad) { flash($("#nuState"), bad); pw.focus(); return; }

      var btn = this; btn.disabled = true;
      SB.fn.users("create", { email: email, password: pw.value, role: $("#nuRole").value })
        .then(function (r) {
          pw.value = "";
          flash($("#nuState"), r.existed ? "已加入編輯名單（未變更原有密碼）" : "已建立");
          views.users();
        })
        .catch(function (err) {
          flash($("#nuState"), (err.body && err.body.message) || err.message || "失敗");
          btn.disabled = false;
        });
    };
  }

  /** 由管理者指定新密碼 */
  function renderPwForm(userId, email) {
    var host = $("#userForm");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>更改密碼</h3>' +
      "<p>" + esc(email || userId) + "</p></div></div>" +
      '<div class="panel__body">' +
      pwField("spPw", "新密碼") +
      '<div class="note">舊密碼會立即失效。系統不會寄信通知，請自行轉達給對方。</div>' +
      '<div class="rowactions"><button class="btn btn--primary" id="spSave">更改密碼</button>' +
      '<button class="btn" id="spCancel">取消</button>' +
      '<span class="saved" id="spState"></span></div></div></div>';
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    var pw = wirePwField(host, "spPw", function () { return email; });
    $("#spCancel").onclick = function () { host.innerHTML = ""; };

    $("#spSave").onclick = function () {
      var bad = pwProblem(pw.value, email);
      if (bad) { flash($("#spState"), bad); pw.focus(); return; }
      var btn = this; btn.disabled = true;
      SB.fn.users("set_password", { user_id: userId, password: pw.value })
        .then(function () {
          pw.value = "";
          flash($("#spState"), "已更改");
          setTimeout(function () { host.innerHTML = ""; }, 1600);
        })
        .catch(function (err) {
          flash($("#spState"), (err.body && err.body.message) || err.message || "失敗");
          btn.disabled = false;
        });
    };
  }

  /* ---------- 各分頁 ---------- */

  var views = {

    dashboard: function () {
      title.textContent = "總覽";
      desc.textContent = "網站內容與產品上架狀態";
      actions.innerHTML = "";
      busy();
      Promise.all([
        SB.db.select("web_pages", { select: "id,status" }).catch(function () { return null; }),
        SB.db.select("web_news", { select: "id,status" }).catch(function () { return null; }),
        // 不能數 web_product_settings 的列數——新產品沒有設定行卻是上架的。
        // 用後台 view 才與前台同一套判斷（published 且 web_eligible）。
        SB.db.select("web_products_admin", { select: "id,published,web_eligible", limit: 2000 })
          .catch(function () { return null; }),
        SB.db.select("web_enquiries", { select: "id,state" }).catch(function () { return null; })
      ]).then(function (r) {
        var pages = r[0], news = r[1], prods = r[2], enq = r[3];
        function card(n, label, tag) {
          return '<div class="card"><div class="n">' + n + '</div><div class="l">' + label +
                 '</div><span class="tag">' + tag + "</span></div>";
        }
        var live = pages ? pages.filter(function (p) { return p.status === "live"; }).length : "—";
        var pub  = prods ? prods.filter(function (p) { return p.published && p.web_eligible; }).length : "—";
        var neu  = enq ? enq.filter(function (e) { return e.state === "new"; }).length : "—";
        body.innerHTML =
          '<div class="cards">' +
            card(pages ? live + " / " + pages.length : "—", "頁面已上線", "web_pages") +
            card(news ? news.length : "—", "公司動態", "web_news") +
            card(pub, "產品已上架", "來源：報價系統") +
            card(neu, "待處理詢價", "web_enquiries") +
          "</div>" +
          '<div class="panel" style="margin-top:20px"><div class="panel__head"><div>' +
          "<h3>連線狀態</h3><p>" + esc(SB.config.url.replace("https://", "")) + "</p></div>" +
          '<span class="pill is-live">已連線</span></div><div class="panel__body">' +
          (pages && pages.length === 0
            ? '<div class="note"><b>web_pages 是空的。</b>到「頁面內容」按一次「建立頁面清單」即可初始化。</div>'
            : "") +
          '<div class="note note--warn"><b>「頁面內容」尚未與前台同步。</b>該區的編輯只存進資料庫，' +
          "不會改變線上網站；前台文案目前由開發端維護。News 與產品上架則是即時生效。</div>" +
          '<div class="note"><b>三語進度。</b>英文為主稿。繁中與越南文可用欄位下方的「從英文自動翻譯」產生，' +
          "翻完務必人工確認再儲存——翻譯是草稿，不是定稿。</div>" +
          '<div class="note"><b>產品資料。</b>產品主檔在報價系統，這裡只決定哪些出現在官網，' +
          "不會覆寫報價系統的成本與供應商資料。</div>" +
          "</div></div>";
      }).catch(function (e) { fail(e, "載入總覽"); });
    },

    pages: function () {
      title.textContent = "頁面內容";
      desc.textContent = "各頁的標題與導言，三語分開維護";
      actions.innerHTML = '<button class="btn btn--sm" id="seedPages">建立頁面清單</button>';
      $("#seedPages").onclick = function () {
        var btn = this; btn.disabled = true; btn.textContent = "建立中…";
        SB.db.upsert("web_pages", PAGE_SEED.map(function (p) {
          return { id: p.id, path: p.path, name: p.name, status: "draft", content: {} };
        }), "id").then(function () { views.pages(); })
          .catch(function (e) { fail(e, "建立頁面清單"); });
      };
      busy();
      SB.db.select("web_pages", { select: "*", order: "id.asc" }).then(function (rows) {
        if (!rows.length) {
          body.innerHTML = '<div class="panel"><div class="panel__body">' +
          '<div class="note note--warn"><b>此區目前尚未與前台同步。</b>' +
          "在這裡的編輯會存進資料庫，但<b>不會改變線上網站</b>。" +
          "前台各頁的文案目前寫在 repo 的 <code>src/pages/</code>，由建置程式產生靜態頁面，" +
          "改動頻率低，暫由開發端維護。" +
          "<br><br>本區保留是為了先把資料結構與三語欄位定下來，" +
          "前台同步（build 時從資料庫取值＋後台發布按鈕）列為下一階段開發項目。</div>" +
          "</div></div>" +
          '<div class="panel"><div class="panel__body"><div class="empty">' +
            "web_pages 目前沒有資料。按右上角「建立頁面清單」寫入頁面。</div></div></div>";
          return;
        }
        body.innerHTML = '<div class="panel"><div class="panel__body">' +
          '<div class="note note--warn"><b>此區目前尚未與前台同步。</b>' +
          "在這裡的編輯會存進資料庫，但<b>不會改變線上網站</b>。" +
          "前台各頁的文案目前寫在 repo 的 <code>src/pages/</code>，由建置程式產生靜態頁面，" +
          "改動頻率低，暫由開發端維護。" +
          "<br><br>本區保留是為了先把資料結構與三語欄位定下來，" +
          "前台同步（build 時從資料庫取值＋後台發布按鈕）列為下一階段開發項目。</div>" +
          "</div></div>" +
          '<div class="panel"><div class="panel__head"><div><h3>網站頁面</h3><p>共 ' +
          rows.length + ' 頁</p></div></div><table><thead><tr><th>頁面</th><th>狀態</th><th></th></tr></thead><tbody>' +
          rows.map(function (p) {
            return "<tr><td><b>" + esc(p.name) + '</b><span class="sub">' + esc(p.path) + "</span></td><td>" +
                   statusPill(p.status) + '</td><td style="text-align:right">' +
                   '<button class="btn btn--sm" data-edit="' + esc(p.id) + '">編輯</button></td></tr>';
          }).join("") + "</tbody></table></div><div id=\"editor\"></div>";
        body.onclick = function (e) {
          var b = e.target.closest("[data-edit]");
          if (b) editPage(rows.filter(function (r) { return r.id === b.dataset.edit; })[0]);
        };
      }).catch(function (e) { fail(e, "載入頁面清單"); });
    },

    news: function () {
      title.textContent = "公司動態";
      desc.textContent = "展會、公司發展、認證更新、新設備與產能、新產品發布";
      actions.innerHTML = '<button class="btn btn--primary btn--sm" id="addNews">新增動態</button>';
      $("#addNews").onclick = function () {
        SB.db.insert("web_news", {
          category: "Exhibition",
          published_at: new Date().toISOString().slice(0, 10),
          status: "draft", title: {}, body: {}
        }).then(function (r) { views.news(); editNews(r[0]); })
          .catch(function (e) { fail(e, "新增動態"); });
      };
      busy();
      SB.db.select("web_news", { select: "*", order: "published_at.desc" }).then(function (rows) {
        body.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>動態列表</h3>' +
          "<p>首頁顯示最新 2–3 則已發布的動態</p></div></div>" +
          (rows.length
            ? "<table><thead><tr><th>標題</th><th>分類</th><th>日期</th><th>狀態</th><th></th></tr></thead><tbody>" +
              rows.map(function (n) {
                return "<tr><td><b>" + (esc((n.title || {}).en) || "（未命名）") + "</b></td><td>" +
                  esc(n.category) + "</td><td>" + esc(n.published_at) + "</td><td>" + statusPill(n.status) +
                  '</td><td style="text-align:right">' +
                  '<button class="btn btn--sm" data-news="' + esc(n.id) + '">編輯</button> ' +
                  '<button class="btn btn--sm" data-del="' + esc(n.id) + '">刪除</button></td></tr>';
              }).join("") + "</tbody></table>"
            : '<div class="panel__body"><div class="empty">尚無動態。按右上角「新增動態」開始。</div></div>') +
          '</div><div id="newsEditor"></div>';
        body.onclick = function (e) {
          var ed = e.target.closest("[data-news]"), del = e.target.closest("[data-del]");
          if (ed) editNews(rows.filter(function (r) { return String(r.id) === ed.dataset.news; })[0]);
          if (del) {
            if (!confirm("刪除這則動態？此動作無法復原。")) return;
            SB.db.remove("web_news", { id: "eq." + del.dataset.del })
              .then(views.news).catch(function (e2) { fail(e2, "刪除動態"); });
          }
        };
      }).catch(function (e) { fail(e, "載入動態"); });
    },

    products: function () {
      title.textContent = "產品上架";
      desc.textContent = "產品主檔在報價系統，這裡只決定哪些產品出現在官網";
      actions.innerHTML = "";
      busy("讀取報價系統產品清單…");
      SB.db.select("web_products_admin", { select: "*", order: "series.asc", limit: PROD_LIMIT })
        .then(function (rows) {
          if (!rows.length) {
            body.innerHTML = '<div class="panel"><div class="panel__body">' +
              '<div class="empty">web_products_admin 沒有回傳任何產品。</div>' +
              '<div class="note">可能原因：<br>' +
              "1. <code>docs/sql/web_schema_02_admin.sql</code> 尚未在 Supabase 執行<br>" +
              "2. <code>products</code> 資料表的 RLS 政策不允許此帳號讀取<br>" +
              "3. 報價系統目前確實沒有產品資料</div></div></div>";
            return;
          }
          var newCount = rows.filter(function (p) { return p.never_set && p.web_eligible; }).length;
          body.innerHTML =
            (rows.length >= PROD_LIMIT
              ? '<div class="note note--warn"><b>清單可能不完整。</b>本頁一次讀取 ' + PROD_LIMIT +
                " 筆，實際筆數已達上限，超出的產品沒有列在下面。</div>"
              : "") +
            '<div class="note"><b>新產品預設上架。</b>報價系統新增的產品（status = Normal）' +
            "會自動出現在官網，不需要來這裡勾選；要隱藏才需要把開關關掉。" +
            (newCount ? "目前有 <b>" + newCount + "</b> 項是自動上架、尚未在這裡設定過的。" : "") +
            "</div>" +
            '<div class="panel"><div class="panel__head"><div><h3>可上架產品</h3><p>共 ' +
            rows.length + " 項，來源：報價系統 products</p></div>" +
            '<span class="saved" id="pSaved">已儲存</span></div>' +
            "<table><thead><tr><th>產品</th><th>官網分類</th><th>上架</th></tr></thead><tbody>" +
            rows.map(function (p) {
              var nm = (p.name && (p.name.en || p.name["zh-TW"])) || p.series || p.id;
              return "<tr><td><b>" + esc(nm) + '</b><span class="sub">' + esc(p.series || p.id) +
                (p.status ? " · " + esc(p.status) : "") +
                (p.never_set && p.web_eligible ? " · 自動上架" : "") + "</span></td>" +
                '<td><select data-kind="' + esc(p.id) + '">' +
                '<option value="platform"' + (p.web_kind === "platform" ? " selected" : "") + ">Existing Product</option>" +
                '<option value="quick"' + (p.web_kind === "quick" ? " selected" : "") + ">Quick Customization</option>" +
                "</select></td>" +
                '<td><label class="switch"><input type="checkbox" data-pub="' + esc(p.id) + '"' +
                (p.published ? " checked" : "") + '><span class="track"></span>上架</label></td></tr>';
            }).join("") + "</tbody></table></div>";

          body.addEventListener("change", function (e) {
            var el = e.target, id = el.dataset.pub || el.dataset.kind;
            if (!id) return;
            var row = rows.filter(function (r) { return r.id === id; })[0];
            if (el.dataset.pub) row.published = el.checked; else row.web_kind = el.value;
            row.never_set = false;   // 一經 upsert 就有設定行了
            SB.db.upsert("web_product_settings", {
              product_id: id, published: row.published, web_kind: row.web_kind,
              sort_order: row.sort_order || 0, updated_at: new Date().toISOString()
            }, "product_id")
              .then(function () { flash($("#pSaved"), "已儲存"); })
              .catch(function (err) { flash($("#pSaved"), "儲存失敗：" + (err.message || "")); });
          });
        })
        .catch(function (e) { fail(e, "載入產品清單"); });
    },

    enquiries: function () {
      title.textContent = "詢價紀錄";
      desc.textContent = "Start Your Project 表單送出的案件";
      actions.innerHTML = "";
      busy();
      SB.db.select("web_enquiries", { select: "*", order: "created_at.desc", limit: 200 })
        .then(function (rows) {
          body.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>案件列表</h3><p>共 ' +
            rows.length + " 筆</p></div></div>" +
            (rows.length
              ? "<table><thead><tr><th>公司 / 聯絡人</th><th>國家</th><th>階段</th><th>日期</th><th>狀態</th></tr></thead><tbody>" +
                rows.map(function (r) {
                  return "<tr><td><b>" + esc(r.company) + '</b><span class="sub">' + esc(r.contact) +
                    " · " + esc(r.email) + "</span></td><td>" + esc(r.country) + "</td><td>" +
                    esc(r.stage || "—") + "</td><td>" + esc((r.created_at || "").slice(0, 10)) +
                    '</td><td><span class="pill">' + esc(r.state) + "</span></td></tr>";
                }).join("") + "</tbody></table>"
              : '<div class="panel__body"><div class="empty">目前沒有詢價紀錄。</div>' +
                '<div class="note">表單要能送出，需先部署 <code>enquiry</code> Edge Function，' +
                "並在 <code>src/pages/start-your-project.html</code> 接上送出邏輯。</div></div>") +
            "</div>";
        })
        .catch(function (e) { fail(e, "載入詢價紀錄"); });
    },

    users: function () {
      title.textContent = "使用者";
      desc.textContent = "誰可以編輯與發布官網內容";
      actions.innerHTML = '<button class="btn btn--primary btn--sm" id="addUser">新增使用者</button>';
      busy("讀取使用者清單…");

      $("#addUser").onclick = function () { renderUserForm(); };

      SB.fn.users("list").then(function (r) {
        var rows = r.editors || [];
        body.innerHTML =
          '<div class="panel"><div class="panel__head"><div><h3>官網編輯者</h3><p>共 ' + rows.length +
          " 人。只有列在這裡的帳號能寫入官網資料</p></div>" +
          '<span class="saved" id="uSaved">已儲存</span></div>' +
          "<table><thead><tr><th>帳號</th><th>權限</th><th>最後登入</th><th></th></tr></thead><tbody>" +
          rows.map(function (u) {
            var me = (SB.auth.current() || {}).user || {};
            var isMe = u.user_id === me.id;
            return "<tr><td><b>" + esc(u.email || u.user_id) + "</b>" +
              (isMe ? ' <span class="pill">你</span>' : "") +
              (u.confirmed ? "" : ' <span class="pill is-draft">未驗證</span>') +
              '<span class="sub">' + esc(u.user_id) + "</span></td>" +
              '<td><select data-role="' + esc(u.user_id) + '"' + (isMe ? " disabled" : "") + ">" +
              ROLE_OPTS.map(function (o) {
                return '<option value="' + o[0] + '"' + (u.role === o[0] ? " selected" : "") +
                       ">" + o[1] + "</option>";
              }).join("") + "</select></td>" +
              "<td>" + esc(u.last_sign_in_at ? u.last_sign_in_at.slice(0, 10) : "從未登入") + "</td>" +
              '<td style="text-align:right">' +
              '<button class="btn btn--sm" data-pw="' + esc(u.user_id) +
                '" data-email="' + esc(u.email || "") + '">更改密碼</button> ' +
              (isMe ? "" : '<button class="btn btn--sm" data-remove="' + esc(u.user_id) +
                           '" data-email="' + esc(u.email || "") + '">刪除使用者</button>') +
              "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div id="userForm"></div>' +
          '<div class="panel"><div class="panel__head"><div><h3>關於帳號與權限</h3>' +
          "<p>官網後台的帳號與密碼獨立於其他系統</p></div></div>" +
          '<div class="panel__body">' +
          '<div class="note"><b>登入方式是 Email，不是工號。</b>' +
          "KMS、報價系統、CRM、CPF 與內部 Portal 是用工號登入、密碼另存一套，" +
          "與這裡完全獨立。在這裡設定或更改密碼<b>不會影響那些系統</b>，反之亦然。</div>" +
          '<div class="note"><b>密碼由你設定並自行轉達。</b>' +
          "系統沒有寄信通知的機制，新增使用者或更改密碼都不會通知對方。</div>" +
          '<div class="note"><b>密碼原則：至少 10 碼，且不能是常見密碼。</b>' +
          "刻意不要求大小寫與符號——那類規則會把人逼向 Password1! 這種可預測的形狀，" +
          "而那正是攻擊者最先猜的一批。送出時會比對 Have I Been Pwned 的外洩密碼庫，" +
          "只送出雜湊值的前 5 碼，密碼本身不會離開伺服器。" +
          "建議用四五個不相干的字串成一句，例如較長的普通詞組，比短而複雜的好記也好防。</div>" +
          '<div class="note"><b>「刪除使用者」會移出編輯名單並刪除帳號。</b>' +
          "唯一例外是該帳號在 CPF 系統另有資料時——那種情況只收回官網權限、保留帳號本身，" +
          "避免影響 CPF 那邊的紀錄，畫面上會告知。</div>" +
          "</div></div>";

        body.onclick = function (e) {
          var pw = e.target.closest("[data-pw]");
          var rm = e.target.closest("[data-remove]");
          if (pw) renderPwForm(pw.dataset.pw, pw.dataset.email);
          if (rm) {
            if (!confirm("刪除 " + (rm.dataset.email || "這個帳號") + "？\n\n" +
                         "會移出編輯名單並刪除帳號，此動作無法復原。")) return;
            SB.fn.users("remove", { user_id: rm.dataset.remove })
              .then(function (r2) {
                if (r2 && r2.account_deleted === false && r2.note) alert(r2.note);
                views.users();
              })
              .catch(function (err) {
                alert("刪除失敗：" + ((err.body && err.body.error) || err.message || ""));
              });
          }
        };

        body.addEventListener("change", function (e) {
          var sel = e.target.closest("[data-role]");
          if (!sel) return;
          SB.db.update("web_editors", { user_id: "eq." + sel.dataset.role }, { role: sel.value })
            .then(function () { flash($("#uSaved"), "已儲存"); })
            .catch(function (err) { flash($("#uSaved"), "儲存失敗：" + (err.message || "")); });
        });
      }).catch(function (e) {
        // function 未部署時 CORS preflight 就失敗了，拿不到 status，只會是 Failed to fetch
        var notDeployed = e.status === 404 || !e.status;
        if (notDeployed) {
          body.innerHTML = '<div class="panel"><div class="panel__body">' +
            '<div class="note"><b>admin-users function 尚未部署。</b>使用者管理需要 service_role 權限，' +
            "那把 key 不能放前端，所以必須經過 Edge Function。<br><br>" +
            "部署指令：<code>supabase functions deploy admin-users --project-ref tcvlnpgpuphdalzvmoyo</code></div>" +
            "</div></div>";
        } else if (e.status === 403) {
          body.innerHTML = '<div class="panel"><div class="panel__body">' +
            '<div class="note"><b>只有官網 admin 能管理使用者。</b>你目前的權限是 editor 或更低。</div>' +
            "</div></div>";
        } else { fail(e, "載入使用者清單"); }
      });
    },

    settings: function () {
      title.textContent = "設定";
      desc.textContent = "連線與資料來源";
      actions.innerHTML = "";
      var u = SB.auth.current();
      body.innerHTML =
        '<div class="panel"><div class="panel__head"><div><h3>連線</h3><p>目前的執行狀態</p></div></div>' +
        '<div class="panel__body">' +
        '<div class="fieldrow"><label>Supabase 專案</label><input type="text" value="' +
          esc(SB.config.url) + '" readonly></div>' +
        '<div class="fieldrow"><label>登入身分</label><input type="text" value="' +
          esc((u && u.user && u.user.email) || "—") + '" readonly></div>' +
        '<div class="fieldrow"><label>前台產品來源</label><input type="text" value="web_products_public（view）" readonly></div>' +
        "</div></div>" +
        '<div class="panel"><div class="panel__head"><div><h3>尚未完成</h3><p>需要在 Supabase 端處理</p></div></div>' +
        '<div class="panel__body">' +
        '<div class="note">執行 <code>docs/sql/web_schema_02_admin.sql</code>，建立後台用的 web_products_admin view。</div>' +
        '<div class="note">部署兩支 Edge Function：<code>enquiry</code>（詢價表單）與 <code>translate</code>（自動翻譯）。</div>' +
        '<div class="note">選用：設定 <code>RESEND_API_KEY</code> 才會寄出詢價通知信；未設定時資料仍會寫入。</div>' +
        '<div class="note"><b>不要</b>把 service_role key 或任何 API 金鑰放進這個 repo。repo 與網站都是公開的。</div>' +
        "</div></div>";
    }
  };

  /* ---------- 子畫面 ---------- */

  function editPage(p) {
    var seed = PAGE_SEED.filter(function (x) { return x.id === p.id; })[0] || { fields: ["title", "lead"] };
    var host = $("#editor");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>' + esc(p.name) +
      "</h3><p>" + esc(p.path) + "</p></div>" +
      '<label class="switch"><input type="checkbox" id="pgLive"' + (p.status === "live" ? " checked" : "") +
      '><span class="track"></span>已上線</label></div><div class="panel__body" id="pgFields">' +
      '<div class="note note--warn" style="margin-bottom:24px">儲存後<b>不會反映到線上網站</b>——本區尚未與前台同步。</div>' +
      seed.fields.map(function (f) {
        return langBlock("page", f, FIELD_LABEL[f] || f,
                         f === "lead" || f === "hero_sub", (p.content || {})[f]);
      }).join("") +
      '<div class="rowactions"><button class="btn btn--primary" id="pgSave">儲存</button>' +
      '<span class="saved" id="pgSaved">已儲存</span></div></div></div>';
    wireLangBlocks($("#pgFields"));
    $("#pgSave").onclick = function () {
      var btn = this; btn.disabled = true;
      SB.db.update("web_pages", { id: "eq." + p.id }, {
        content: collect($("#pgFields"), "page"),
        status: $("#pgLive").checked ? "live" : "draft",
        updated_at: new Date().toISOString()
      }).then(function () { flash($("#pgSaved"), "已儲存"); })
        .catch(function (e) { flash($("#pgSaved"), "儲存失敗：" + (e.message || "")); })
        .then(function () { btn.disabled = false; });
    };
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editNews(n) {
    if (!n) return;
    var host = $("#newsEditor");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>編輯動態</h3><p>' +
      esc(n.id) + "</p></div>" +
      '<label class="switch"><input type="checkbox" id="nLive"' + (n.status === "live" ? " checked" : "") +
      '><span class="track"></span>發布</label></div><div class="panel__body" id="nFields">' +
      '<div class="fieldrow"><label>分類</label><select id="nCat">' +
      ["Exhibition", "Company", "Certification", "Capability", "Product"].map(function (c) {
        return "<option" + (c === n.category ? " selected" : "") + ">" + c + "</option>";
      }).join("") + "</select></div>" +
      '<div class="fieldrow"><label>日期</label><input type="date" id="nDate" value="' +
        esc(n.published_at) + '"></div>' +
      langBlock("news", "title_news", "標題", false, n.title) +
      langBlock("news", "body", "內文", true, n.body) +
      '<div class="rowactions"><button class="btn btn--primary" id="nSave">儲存</button>' +
      '<span class="saved" id="nSaved">已儲存</span></div></div></div>';
    wireLangBlocks($("#nFields"));
    $("#nSave").onclick = function () {
      var btn = this; btn.disabled = true;
      var vals = collect($("#nFields"), "news");
      SB.db.update("web_news", { id: "eq." + n.id }, {
        category: $("#nCat").value,
        published_at: $("#nDate").value,
        status: $("#nLive").checked ? "live" : "draft",
        title: vals.title_news || {},
        body: vals.body || {},
        updated_at: new Date().toISOString()
      }).then(function () { flash($("#nSaved"), "已儲存"); views.news(); })
        .catch(function (e) { flash($("#nSaved"), "儲存失敗：" + (e.message || "")); })
        .then(function () { btn.disabled = false; });
    };
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- 啟動 ---------- */

  /**
   * 確認登入者真的在 web_editors 白名單內。
   *
   * 為什麼需要這一步：沒有這道檢查，不在白名單的帳號登入後會進到一個空殼後台，
   * 每個動作都失敗，看起來像系統壞了。先擋下來並說明原因，比較好處理。
   *
   * ★ 失敗模式刻意不對稱：
   *     查到「確定不在名單裡」（HTTP 200 但零筆）→ 擋下並說明
   *     「查不出來」（網路斷線、PostgREST 錯誤、政策異常）→ 放行，只顯示警告
   *   因為這道閘門是體驗，不是安全邊界——真正的防線是資料庫的 RLS
   *   （is_web_editor()），不在名單的人就算進來也讀不到、寫不進任何東西。
   *   若查詢失敗就一律鎖死，任何一次暫時性錯誤都會把管理者關在門外，
   *   那個代價遠大於讓一個本來就無權限的人看到空後台。
   */
  function assertEditor() {
    var me = (SB.auth.current() || {}).user || {};
    if (!me.id) return Promise.resolve({ warn: "無法取得登入者識別碼" });

    // web_editors 的 select 政策本身就要求呼叫者在名單內，非編輯者會拿到空陣列
    return SB.db.select("web_editors", { user_id: "eq." + me.id, select: "user_id,role" })
      .then(function (rows) {
        if (Array.isArray(rows) && rows.length) return rows[0];
        var err = new Error("此帳號沒有官網後台權限");
        err.notEditor = true;                       // 確定不在名單 → 擋
        throw err;
      })
      .catch(function (err) {
        if (err.notEditor) throw err;
        // 查不出來就放行，把原因寫在畫面上，不要把人鎖在外面
        if (window.console) console.warn("[webadmin] 權限查詢失敗，改為放行", err);
        return { warn: "無法確認你的編輯權限（" + (err.message || "查詢失敗") +
                       "）。已先讓你進入，但若每個操作都失敗，請檢查 web_editors 名單。" };
      });
  }

  function enterApp(gate) {
    $("#login").hidden = true;
    $("#app").hidden = false;
    body = $("#viewBody"); title = $("#viewTitle"); desc = $("#viewDesc"); actions = $("#topActions");
    var u = SB.auth.current();
    var badge = $("#modeBadge");
    if (badge) badge.textContent = (u && u.user && u.user.email) || "已登入";
    // 警告要放在 #viewBody 外面：各分頁會整批覆寫 viewBody 的內容，放裡面會被沖掉
    if (gate && gate.warn) {
      var note = document.createElement("div");
      note.className = "note";
      note.style.cssText = "margin:0;border-radius:0";
      note.innerHTML = "<b>注意：</b>" + esc(gate.warn);
      var main = document.querySelector(".main");
      var vb = $("#viewBody");
      if (main && vb) main.insertBefore(note, vb);
    }
    views.dashboard();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var note = $("#loginNote");

    $("#loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button[type=submit]");
      var email = $("#lgEmail").value.trim(), pass = $("#lgPass").value;
      if (!email || !pass) { note.innerHTML = "請輸入 Email 與密碼。"; return; }
      btn.disabled = true; btn.textContent = "登入中…";
      SB.auth.signIn(email, pass)
        .then(assertEditor)
        .then(enterApp)
        .catch(function (err) {
          if (err.notEditor) {
            // 密碼是對的，但不在編輯名單裡——清掉 session，不要留在半登入狀態
            SB.auth.signOut();
            note.innerHTML = "<b>帳號密碼正確，但這個帳號不在官網編輯名單裡。</b>" +
              "官網後台的權限由編輯名單控制，與帳號本身是兩件事。" +
              "請向官網管理者申請加入。";
          } else {
            note.innerHTML = err.status === 400
              ? "<b>登入失敗。</b>帳號或密碼不正確。"
              : "<b>登入失敗。</b>" + esc(err.message || "");
          }
          btn.disabled = false; btn.textContent = "登入";
        });
    });

    document.querySelectorAll(".snav").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".snav").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        body.onclick = null;
        views[b.dataset.view]();
      });
    });

    $("#logout").addEventListener("click", function () {
      SB.auth.signOut().then(function () { location.reload(); });
    });

    // 已有未過期的 session 就直接進去，但同樣要確認權限沒被收回
    if (SB.auth.current()) {
      SB.auth.ensure()
        .then(assertEditor)
        .then(enterApp)
        .catch(function (err) {
          if (err && err.notEditor) SB.auth.signOut();   // 權限已被收回，清掉舊 session
          /* 其餘情況留在登入頁 */
        });
    }
  });
})();
