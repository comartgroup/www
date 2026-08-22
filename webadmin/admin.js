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

  function showTempPassword(email, pw) {
    if (!pw) return;
    var host = $("#userForm") || body;
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>臨時密碼</h3>' +
      "<p>只會顯示這一次，關掉就看不到了</p></div></div>" +
      '<div class="panel__body">' +
      (email ? '<div class="fieldrow"><label>帳號</label><input type="text" value="' +
               esc(email) + '" readonly></div>' : "") +
      '<div class="fieldrow"><label>臨時密碼</label>' +
      '<input type="text" value="' + esc(pw) + '" readonly id="tmpPw"></div>' +
      '<div class="note"><b>請自行轉達給對方，不要用 email 寄。</b>' +
      "本專案沒有設定寄信服務，系統不會通知對方。請要求對方登入後立即更改密碼。</div>" +
      '<div class="rowactions"><button class="btn" id="copyPw">複製</button>' +
      '<span class="saved" id="pwCopied">已複製</span></div></div></div>';
    host.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#copyPw").onclick = function () {
      var el = $("#tmpPw"); el.select();
      navigator.clipboard.writeText(el.value).then(function () { flash($("#pwCopied"), "已複製"); });
    };
  }

  function renderUserForm() {
    var host = $("#userForm");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>新增使用者</h3>' +
      "<p>帳號已存在於其他系統時，請選「加入既有帳號」</p></div></div>" +
      '<div class="panel__body">' +
      '<div class="fieldrow"><label>Email</label>' +
      '<input type="email" id="nuEmail" placeholder="name@comart.com.tw"></div>' +
      '<div class="fieldrow"><label>權限</label><select id="nuRole">' +
      ROLE_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="rowactions">' +
      '<button class="btn btn--primary" id="nuCreate">建立新帳號</button>' +
      '<button class="btn" id="nuGrant">加入既有帳號</button>' +
      '<span class="saved" id="nuState"></span></div></div></div>';
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    function run(action) {
      var email = $("#nuEmail").value.trim();
      if (!email) { flash($("#nuState"), "請輸入 Email"); return; }
      var role = $("#nuRole").value;
      $("#nuCreate").disabled = $("#nuGrant").disabled = true;
      SB.fn.users(action, { email: email, role: role })
        .then(function (r) {
          if (r.temp_password) showTempPassword(email, r.temp_password);
          else { flash($("#nuState"), "已加入"); views.users(); }
        })
        .catch(function (err) {
          var m = (err.body && err.body.message) || err.message || "";
          flash($("#nuState"), m);
          $("#nuCreate").disabled = $("#nuGrant").disabled = false;
        });
    }
    $("#nuCreate").onclick = function () { run("create"); };
    $("#nuGrant").onclick  = function () { run("grant"); };
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
        SB.db.select("web_product_settings", { select: "product_id,published" }).catch(function () { return null; }),
        SB.db.select("web_enquiries", { select: "id,state" }).catch(function () { return null; })
      ]).then(function (r) {
        var pages = r[0], news = r[1], prods = r[2], enq = r[3];
        function card(n, label, tag) {
          return '<div class="card"><div class="n">' + n + '</div><div class="l">' + label +
                 '</div><span class="tag">' + tag + "</span></div>";
        }
        var live = pages ? pages.filter(function (p) { return p.status === "live"; }).length : "—";
        var pub  = prods ? prods.filter(function (p) { return p.published; }).length : "—";
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
      SB.db.select("web_products_admin", { select: "*", order: "series.asc", limit: 500 })
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
          body.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>可上架產品</h3><p>共 ' +
            rows.length + " 項，來源：報價系統 products</p></div>" +
            '<span class="saved" id="pSaved">已儲存</span></div>' +
            "<table><thead><tr><th>產品</th><th>官網分類</th><th>上架</th></tr></thead><tbody>" +
            rows.map(function (p) {
              var nm = (p.name && (p.name.en || p.name["zh-TW"])) || p.series || p.id;
              return "<tr><td><b>" + esc(nm) + '</b><span class="sub">' + esc(p.series || p.id) +
                (p.status ? " · " + esc(p.status) : "") + "</span></td>" +
                '<td><select data-kind="' + esc(p.id) + '">' +
                '<option value="platform"' + (p.web_kind === "platform" ? " selected" : "") + ">Platform Product</option>" +
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
              '<button class="btn btn--sm" data-pw="' + esc(u.user_id) + '">重設密碼</button> ' +
              (isMe ? "" : '<button class="btn btn--sm" data-revoke="' + esc(u.user_id) +
                           '" data-email="' + esc(u.email || "") + '">收回權限</button>') +
              "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div id="userForm"></div>' +
          '<div class="panel"><div class="panel__head"><div><h3>關於權限</h3>' +
          "<p>本 Supabase 專案由報價系統、KMS 與官網共用</p></div></div>" +
          '<div class="panel__body">' +
          '<div class="note"><b>「收回權限」不會刪除帳號。</b>只會把人移出官網編輯名單。' +
          "該帳號的 UUID 可能被 KMS 或 CPF 參照，刪掉會在別的系統造成孤兒資料。</div>" +
          '<div class="note"><b>密碼由管理者轉達。</b>本專案沒有設定寄信服務，' +
          "所以重設密碼不會寄信，而是在畫面上顯示一次臨時密碼，請你自行轉達並要求對方登入後更改。</div>" +
          "</div></div>";

        body.onclick = function (e) {
          var pw = e.target.closest("[data-pw]");
          var rv = e.target.closest("[data-revoke]");
          if (pw) {
            if (!confirm("重設這個帳號的密碼？舊密碼會立即失效。")) return;
            pw.disabled = true; pw.textContent = "處理中…";
            SB.fn.users("set_password", { user_id: pw.dataset.pw })
              .then(function (r2) { showTempPassword(null, r2.temp_password); })
              .catch(function (err) { alert("重設失敗：" + (err.message || "")); })
              .then(function () { views.users(); });
          }
          if (rv) {
            if (!confirm("收回 " + (rv.dataset.email || "這個帳號") +
                         " 的官網編輯權限？\n\n帳號本身不會被刪除，其他系統不受影響。")) return;
            SB.fn.users("revoke", { user_id: rv.dataset.revoke })
              .then(views.users)
              .catch(function (err) { alert("收回失敗：" + (err.message || "")); });
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

  function enterApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    body = $("#viewBody"); title = $("#viewTitle"); desc = $("#viewDesc"); actions = $("#topActions");
    var u = SB.auth.current();
    var badge = $("#modeBadge");
    if (badge) badge.textContent = (u && u.user && u.user.email) || "已登入";
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
        .then(enterApp)
        .catch(function (err) {
          note.innerHTML = err.status === 400
            ? "<b>登入失敗。</b>帳號或密碼不正確。"
            : "<b>登入失敗。</b>" + esc(err.message || "");
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

    // 已有未過期的 session 就直接進去
    if (SB.auth.current()) {
      SB.auth.ensure().then(enterApp).catch(function () { /* 留在登入頁 */ });
    }
  });
})();
