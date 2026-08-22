/* =========================================================
   COMART 官網後台
   ---------------------------------------------------------
   資料存取全部集中在 store 這一層。目前 MODE = 'local'，
   所有內容寫在瀏覽器 localStorage，不碰伺服器。

   Supabase 就緒後：把 MODE 改成 'supabase'、填入 CONFIG，
   並依 docs/sql/web_schema.sql 建立資料表與 view，
   其餘畫面與流程不需要改。

   安全前提（重要）：
   - 產品主檔仍在報價系統的 products 資料表，後台只切換「是否上架」與網站專用欄位，
     不複製也不覆寫報價系統的成本與供應商資料。
   - 前台只能讀 web_products_public 這個不含成本與供應商欄位的 view。
   ========================================================= */
(function () {
  "use strict";

  var MODE = "local";                    // 'local' | 'supabase'
  var CONFIG = { url: "", anonKey: "" };
  var LANGS = [
    { key: "en",    label: "English" },
    { key: "zh-TW", label: "繁體中文" },
    { key: "vi",    label: "Tiếng Việt" }
  ];
  var KEY = "comart-web-admin-v1";

  /* ---------------- store ---------------- */

  var seed = {
    pages: [
      { id: "home",        name: "首頁 Home",                    path: "/",                     status: "live",  fields: ["hero_title", "hero_sub", "vision", "mission"] },
      { id: "services",    name: "Services 總覽",                 path: "/services/",            status: "live",  fields: ["title", "lead"] },
      { id: "operations",  name: "Global Operations",            path: "/global-operations/",   status: "live",  fields: ["title", "lead"] },
      { id: "products",    name: "Products",                     path: "/products/",            status: "live",  fields: ["title", "lead"] },
      { id: "quality",     name: "Quality & Compliance",         path: "/quality-compliance/",  status: "live",  fields: ["title", "lead"] },
      { id: "equipment",   name: "Equipment",                    path: "/equipment/",           status: "draft", fields: ["title", "lead"] },
      { id: "company",     name: "Company",                      path: "/company/",             status: "live",  fields: ["title", "lead"] },
      { id: "start",       name: "Start Your Project",           path: "/start-your-project/",  status: "live",  fields: ["title", "lead"] }
    ],
    content: {},
    news: [],
    products: [],
    enquiries: []
  };

  var store = {
    data: null,
    load: function () {
      try { this.data = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { this.data = null; }
      if (!this.data) { this.data = JSON.parse(JSON.stringify(seed)); this.save(); }
      return this.data;
    },
    save: function () { localStorage.setItem(KEY, JSON.stringify(this.data)); },
    reset: function () { localStorage.removeItem(KEY); this.load(); }
  };

  /* ---------------- 共用 ---------------- */

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var body = $("#viewBody"), title = $("#viewTitle"), desc = $("#viewDesc"), actions = $("#topActions");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function flash(el) { el.classList.add("is-on"); setTimeout(function () { el.classList.remove("is-on"); }, 1800); }

  function statusPill(s) {
    var m = { live: ["is-live", "已上線"], draft: ["is-draft", "草稿"], off: ["is-off", "未上架"] };
    var v = m[s] || m.draft;
    return '<span class="pill ' + v[0] + '">' + v[1] + "</span>";
  }

  /* 三語欄位組：一個欄位 = { en, zh-TW, vi } */
  function langBlock(pageId, field, label, multiline) {
    var d = store.data.content[pageId] || (store.data.content[pageId] = {});
    var v = d[field] || (d[field] = {});
    var tabs = LANGS.map(function (l, i) {
      var filled = (v[l.key] || "").trim().length > 0;
      return '<button class="langtab' + (i === 0 ? " is-on" : "") + '" data-lang="' + l.key + '">' +
             l.label + '<span class="dot' + (filled ? " is-full" : "") + '"></span></button>';
    }).join("");
    var inputs = LANGS.map(function (l, i) {
      var common = 'data-page="' + pageId + '" data-field="' + field + '" data-lang="' + l.key +
                   '"' + (i === 0 ? "" : " hidden");
      return multiline
        ? '<textarea ' + common + '>' + esc(v[l.key] || "") + "</textarea>"
        : '<input type="text" ' + common + ' value="' + esc(v[l.key] || "") + '">';
    }).join("");
    return '<div class="fieldrow"><label>' + esc(label) + "</label>" +
           '<div class="langtabs" data-tabs="' + field + '">' + tabs + "</div>" +
           inputs +
           '<span class="hint">三語各自獨立儲存。英文為主稿，另外兩語目前需人工填寫；自動翻譯待 Edge Function 建置後接上。</span></div>';
  }

  function wireLangTabs(root) {
    root.querySelectorAll(".langtabs").forEach(function (tabs) {
      tabs.addEventListener("click", function (e) {
        var b = e.target.closest(".langtab");
        if (!b) return;
        var field = tabs.dataset.tabs;
        tabs.querySelectorAll(".langtab").forEach(function (t) { t.classList.remove("is-on"); });
        b.classList.add("is-on");
        root.querySelectorAll('[data-field="' + field + '"]').forEach(function (el) {
          if (el.classList && el.classList.contains("langtab")) return;
          el.hidden = el.dataset.lang !== b.dataset.lang;
        });
      });
    });
    root.addEventListener("input", function (e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.page) return;
      var c = store.data.content[el.dataset.page] || (store.data.content[el.dataset.page] = {});
      (c[el.dataset.field] || (c[el.dataset.field] = {}))[el.dataset.lang] = el.value;
    });
  }

  /* ---------------- 各分頁 ---------------- */

  var views = {

    dashboard: function () {
      title.textContent = "總覽";
      desc.textContent = "網站內容與產品上架狀態";
      actions.innerHTML = "";
      var d = store.data;
      var live = d.pages.filter(function (p) { return p.status === "live"; }).length;
      body.innerHTML =
        '<div class="cards">' +
          '<div class="card"><div class="n">' + live + " / " + d.pages.length + '</div><div class="l">頁面已上線</div><span class="tag">英文版</span></div>' +
          '<div class="card"><div class="n">' + d.news.length + '</div><div class="l">公司動態</div><span class="tag">Company News</span></div>' +
          '<div class="card"><div class="n">' + d.products.length + '</div><div class="l">已標記上架的產品</div><span class="tag">來源：報價系統</span></div>' +
          '<div class="card"><div class="n">' + d.enquiries.length + '</div><div class="l">詢價紀錄</div><span class="tag">Start Your Project</span></div>' +
        "</div>" +
        '<div class="panel" style="margin-top:20px"><div class="panel__head"><div>' +
          "<h3>目前狀態</h3><p>接上資料庫前，這裡的數字只反映本機示範資料</p></div></div>" +
          '<div class="panel__body">' +
          '<div class="note"><b>尚未接上資料庫。</b>本後台的所有編輯都存在這台瀏覽器，' +
          "重新整理仍在、換一台電腦就沒有，也不會改變線上網站的內容。</div>" +
          '<div class="note"><b>三語進度。</b>英文為主稿，繁體中文與越南文欄位已就位但尚未填寫；' +
          "自動翻譯需要 Supabase Edge Function 與翻譯服務帳號。</div>" +
          '<div class="note"><b>產品資料。</b>產品主檔留在報價系統，本後台只決定「哪些產品要出現在官網」' +
          "與網站專用欄位，不會覆寫報價系統的成本與供應商資料。</div>" +
          "</div></div>";
    },

    pages: function () {
      title.textContent = "頁面內容";
      desc.textContent = "各頁的標題與導言，三語分開維護";
      actions.innerHTML = "";
      var rows = store.data.pages.map(function (p) {
        return "<tr><td><b>" + esc(p.name) + '</b><span class="sub">' + esc(p.path) + "</span></td>" +
               "<td>" + statusPill(p.status) + "</td>" +
               '<td style="text-align:right"><button class="btn btn--sm" data-edit="' + p.id + '">編輯</button></td></tr>';
      }).join("");
      body.innerHTML =
        '<div class="panel"><div class="panel__head"><div><h3>網站頁面</h3>' +
        "<p>共 " + store.data.pages.length + " 頁（英文版）</p></div></div>" +
        "<table><thead><tr><th>頁面</th><th>狀態</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
        '<div id="editor"></div>';
      body.addEventListener("click", function (e) {
        var b = e.target.closest("[data-edit]");
        if (b) editPage(b.dataset.edit);
      });
    },

    news: function () {
      title.textContent = "公司動態";
      desc.textContent = "展會、公司發展、認證更新、新設備與產能、新產品發布";
      actions.innerHTML = '<button class="btn btn--primary btn--sm" id="addNews">新增動態</button>';
      renderNews();
      $("#addNews").onclick = function () {
        store.data.news.unshift({
          id: "n" + Date.now(), cat: "Exhibition", date: new Date().toISOString().slice(0, 10),
          status: "draft", title: { en: "", "zh-TW": "", vi: "" }, body: { en: "", "zh-TW": "", vi: "" }
        });
        store.save(); renderNews();
      };
    },

    products: function () {
      title.textContent = "產品上架";
      desc.textContent = "產品主檔在報價系統，這裡只決定哪些產品出現在官網";
      actions.innerHTML = '<button class="btn btn--sm" id="pullProducts">從報價系統載入</button>';
      body.innerHTML =
        '<div class="panel"><div class="panel__head"><div><h3>可上架產品</h3>' +
        "<p>來源：Supabase 專案 tcvlnpgpuphdalzvmoyo · 資料表 products</p></div></div>" +
        '<div class="panel__body" id="prodPanel"><div class="empty">尚未連線。按右上角「從報價系統載入」以載入示範資料。</div></div></div>' +
        '<div class="panel"><div class="panel__head"><div><h3>串接方式</h3><p>正式接線前必須先完成的事</p></div></div>' +
        '<div class="panel__body">' +
        '<div class="note"><b>不可直接讀 products 資料表。</b>該表含 <code>supplier1/2</code>、<code>cost1/2</code>、' +
        "<code>curr1/2</code>、<code>costRef</code>、<code>defaultPrice</code>、<code>bom</code>、<code>bomFiles</code> 等機密欄位，" +
        "官網是公開網站，必須改讀只含可公開欄位的 <code>web_products_public</code> view。</div>" +
        '<div class="note"><b>需要新增的物件。</b><code>web_product_settings</code>（上架旗標、平台型／快速客製分類、排序、網站專用文案）' +
        "與 <code>web_products_public</code> view。SQL 已寫在 <code>docs/sql/web_schema.sql</code>，需要你在 Supabase 執行。</div>" +
        "</div></div>";
      $("#pullProducts").onclick = function () {
        fetch("../assets/data/products.sample.json").then(function (r) { return r.json(); }).then(function (j) {
          store.data.products = (j.products || []).map(function (p) {
            return { id: p.id, series: p.series, name: p.name, kind: p.web_kind || "platform", published: false };
          });
          store.save(); renderProducts();
        });
      };
      if (store.data.products.length) renderProducts();
    },

    enquiries: function () {
      title.textContent = "詢價紀錄";
      desc.textContent = "Start Your Project 表單送出的案件";
      actions.innerHTML = "";
      body.innerHTML =
        '<div class="panel"><div class="panel__head"><div><h3>案件列表</h3><p>尚無資料</p></div></div>' +
        '<div class="panel__body"><div class="empty">表單後端尚未建置，目前沒有任何詢價紀錄。</div>' +
        '<div class="note"><b>需要的東西。</b>表單寫入、驗證與 Email 通知要放在 Supabase Edge Function；' +
        "另需確認收件 Email、負責人、通知方式與案件狀態流程（規劃書 17.1）。</div></div></div>";
    },

    settings: function () {
      title.textContent = "設定";
      desc.textContent = "連線與資料來源";
      actions.innerHTML = "";
      body.innerHTML =
        '<div class="panel"><div class="panel__head"><div><h3>資料來源</h3><p>目前的執行模式</p></div></div>' +
        '<div class="panel__body">' +
        '<div class="fieldrow"><label>模式</label><input type="text" value="' + MODE + ' — 離線示範（localStorage）" readonly></div>' +
        '<div class="fieldrow"><label>Supabase 專案</label><input type="text" value="tcvlnpgpuphdalzvmoyo（尚未連線）" readonly></div>' +
        '<div class="fieldrow"><label>前台產品來源</label><input type="text" value="assets/data/products.sample.json（範例資料）" readonly></div>' +
        '<div class="rowactions"><button class="btn" id="resetData">清除本機示範資料</button>' +
        '<span class="saved" id="resetSaved">已清除</span></div>' +
        "</div></div>" +
        '<div class="panel"><div class="panel__head"><div><h3>切換到正式資料庫</h3><p>需要你提供與執行</p></div></div>' +
        '<div class="panel__body">' +
        '<div class="note">1. 在 Supabase 執行 <code>docs/sql/web_schema.sql</code>，建立 web_* 資料表與公開 view。</div>' +
        '<div class="note">2. 建立後台使用者，並指定管理者／內容編輯／產品編輯／發布者角色。</div>' +
        '<div class="note">3. 把專案 URL 與 publishable key 填入 <code>admin/admin.js</code> 的 CONFIG，' +
        "並把 MODE 改成 <code>supabase</code>；前台則改 <code>assets/js/products.js</code> 的 SOURCE。</div>" +
        '<div class="note"><b>不要</b>把 service_role key 放進任何前端檔案，這個 repo 是公開的。</div>' +
        "</div></div>";
      $("#resetData").onclick = function () { store.reset(); flash($("#resetSaved")); };
    }
  };

  /* ---------------- 子畫面 ---------------- */

  function editPage(id) {
    var p = store.data.pages.filter(function (x) { return x.id === id; })[0];
    var host = $("#editor");
    host.innerHTML =
      '<div class="panel"><div class="panel__head"><div><h3>' + esc(p.name) + "</h3>" +
      "<p>" + esc(p.path) + "</p></div>" +
      '<label class="switch"><input type="checkbox" id="pgLive"' + (p.status === "live" ? " checked" : "") +
      '><span class="track"></span>已上線</label></div>' +
      '<div class="panel__body" id="pgFields">' +
      p.fields.map(function (f) {
        var labels = { hero_title: "主標題", hero_sub: "副標題", vision: "願景", mission: "使命", title: "頁面標題", lead: "導言" };
        return langBlock(p.id, f, labels[f] || f, f === "lead" || f === "hero_sub" || f === "mission");
      }).join("") +
      '<div class="rowactions"><button class="btn btn--primary" id="pgSave">儲存</button>' +
      '<span class="saved" id="pgSaved">已儲存到本機</span></div>' +
      "</div></div>";
    wireLangTabs($("#pgFields"));
    $("#pgLive").onchange = function () { p.status = this.checked ? "live" : "draft"; store.save(); };
    $("#pgSave").onclick = function () { store.save(); flash($("#pgSaved")); };
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderNews() {
    var list = store.data.news;
    body.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>動態列表</h3>' +
      "<p>首頁顯示最新 2–3 則</p></div></div>" +
      (list.length
        ? "<table><thead><tr><th>標題</th><th>分類</th><th>日期</th><th>狀態</th><th></th></tr></thead><tbody>" +
          list.map(function (n) {
            return "<tr><td><b>" + (esc(n.title.en) || "（未命名）") + "</b></td>" +
                   "<td>" + esc(n.cat) + "</td><td>" + esc(n.date) + "</td><td>" + statusPill(n.status) + "</td>" +
                   '<td style="text-align:right"><button class="btn btn--sm" data-news="' + n.id + '">編輯</button> ' +
                   '<button class="btn btn--sm" data-del="' + n.id + '">刪除</button></td></tr>';
          }).join("") + "</tbody></table>"
        : '<div class="panel__body"><div class="empty">尚無動態。按右上角「新增動態」開始。</div></div>') +
      "</div><div id=\"newsEditor\"></div>";
    body.onclick = function (e) {
      var ed = e.target.closest("[data-news]"), del = e.target.closest("[data-del]");
      if (ed) editNews(ed.dataset.news);
      if (del) {
        if (!confirm("刪除這則動態？此動作無法復原。")) return;
        store.data.news = store.data.news.filter(function (n) { return n.id !== del.dataset.del; });
        store.save(); renderNews();
      }
    };
  }

  function editNews(id) {
    var n = store.data.news.filter(function (x) { return x.id === id; })[0];
    store.data.content[id] = store.data.content[id] || { title: n.title, body: n.body };
    var host = $("#newsEditor");
    host.innerHTML = '<div class="panel"><div class="panel__head"><div><h3>編輯動態</h3><p>' + esc(n.id) + "</p></div>" +
      '<label class="switch"><input type="checkbox" id="nLive"' + (n.status === "live" ? " checked" : "") +
      '><span class="track"></span>發布</label></div><div class="panel__body" id="nFields">' +
      '<div class="fieldrow"><label>分類</label><select id="nCat">' +
      ["Exhibition", "Company", "Certification", "Capability", "Product"].map(function (c) {
        return '<option' + (c === n.cat ? " selected" : "") + ">" + c + "</option>";
      }).join("") + "</select></div>" +
      '<div class="fieldrow"><label>日期</label><input type="date" id="nDate" value="' + esc(n.date) + '"></div>' +
      langBlock(id, "title", "標題", false) +
      langBlock(id, "body", "內文", true) +
      '<div class="rowactions"><button class="btn btn--primary" id="nSave">儲存</button>' +
      '<span class="saved" id="nSaved">已儲存到本機</span></div></div></div>';
    wireLangTabs($("#nFields"));
    $("#nLive").onchange = function () { n.status = this.checked ? "live" : "draft"; store.save(); };
    $("#nCat").onchange = function () { n.cat = this.value; store.save(); };
    $("#nDate").onchange = function () { n.date = this.value; store.save(); };
    $("#nSave").onclick = function () {
      n.title = store.data.content[id].title; n.body = store.data.content[id].body;
      store.save(); flash($("#nSaved")); renderNews();
    };
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderProducts() {
    var rows = store.data.products.map(function (p) {
      return "<tr><td><b>" + esc(p.name && (p.name.en || p.name["zh-TW"]) || p.id) + "</b>" +
             '<span class="sub">' + esc(p.series || p.id) + "</span></td>" +
             '<td><select data-kind="' + esc(p.id) + '">' +
             '<option value="platform"' + (p.kind === "platform" ? " selected" : "") + ">Platform Product</option>" +
             '<option value="quick"' + (p.kind === "quick" ? " selected" : "") + ">Quick Customization</option></select></td>" +
             '<td><label class="switch"><input type="checkbox" data-pub="' + esc(p.id) + '"' +
             (p.published ? " checked" : "") + '><span class="track"></span>上架</label></td></tr>';
    }).join("");
    $("#prodPanel").outerHTML =
      '<div class="panel__body" id="prodPanel" style="padding:0">' +
      "<table><thead><tr><th>產品</th><th>官網分類</th><th>上架</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
    $("#prodPanel").addEventListener("change", function (e) {
      var el = e.target, id = el.dataset.pub || el.dataset.kind;
      var p = store.data.products.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (el.dataset.pub) p.published = el.checked; else p.kind = el.value;
      store.save();
    });
  }

  /* ---------------- 啟動 ---------------- */

  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (MODE !== "local") return;               // Supabase Auth 接上後改走真實登入
    $("#login").hidden = true;
    $("#app").hidden = false;
    store.load();
    views.dashboard();
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
    $("#app").hidden = true;
    $("#login").hidden = false;
  });
})();
