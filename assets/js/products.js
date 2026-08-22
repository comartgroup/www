/* =========================================================
   COMART 官網 — 產品資料層
   ---------------------------------------------------------
   產品主檔在報價系統（Supabase 專案 tcvlnpgpuphdalzvmoyo）的 products 資料表。
   官網「不得」直接讀取該表：表內含 supplier1/2、cost1/2、curr1/2、costRef、
   defaultPrice、bom、bomFiles 等機密欄位。

   前台只讀 web_products_public 這個 view，它只回傳
   「已在後台勾選上架」且「status = Normal」的產品，且不含任何成本與供應商欄位。
   細節見 docs/DATA.md。

   清單為空代表後台尚未有產品被標記上架，那是正常狀態，不是錯誤。
   ========================================================= */
(function () {
  "use strict";

  var CFG = window.COMART_SUPABASE || {};
  var VIEW = "web_products_public";
  var LANG = "en";                 // 對應 name / features 的 JSONB 鍵：en / zh-TW / vi

  var grid = document.getElementById("prodGrid");
  var filterBar = document.getElementById("prodFilters");
  if (!grid) return;

  var all = [];

  /* ---------- 資料來源 ---------- */

  function fetchProducts() {
    var cols = [
      "id", "series", "name", "features", "catId", "catId2",
      "cat_code", "cat_name", "cat2_name", "material",
      "interface", "interfaceA", "interfaceB", "coo", "dim", "weight",
      "img", "img2", "img3", "status", "web_kind", "web_summary"
    ].join(",");
    var url = CFG.url + "/rest/v1/" + VIEW +
              "?select=" + cols + "&order=sort_order.asc,series.asc";
    return fetch(url, {
      headers: { apikey: CFG.publishableKey, Authorization: "Bearer " + CFG.publishableKey }
    }).then(function (r) {
      // 分類欄位是第四份 SQL 才加的；還沒跑的話退回不含分類的查詢
      if (r.status === 400) return fetchWithoutCategories();
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function fetchWithoutCategories() {
    var url = CFG.url + "/rest/v1/" + VIEW + "?select=*&order=series.asc";
    return fetch(url, {
      headers: { apikey: CFG.publishableKey, Authorization: "Bearer " + CFG.publishableKey }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- 工具 ---------- */

  // name / features 是多語 JSONB：{ "en": "...", "zh-TW": "...", "vi": "..." }
  function t(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return value[LANG] || value.en || value["zh-TW"] || Object.values(value)[0] || "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function kindLabel(k) { return k === "quick" ? "Quick Customization" : "Existing Product"; }

  /* ---------- 繪製 ---------- */

  function specLine(p) {
    return [p.material, p.interface || p.interfaceA, p.dim, p.coo]
      .filter(Boolean).map(esc).join(" · ");
  }

  function card(p) {
    var img = p.img
      ? '<div class="pcard__img"><img src="' + esc(p.img) + '" alt="" loading="lazy"></div>'
      : '<div class="pcard__img is-empty" aria-hidden="true"></div>';
    return '<article class="pcard">' + img +
      '<div class="pcard__body">' +
        '<span class="pcard__kind">' + esc(kindLabel(p.web_kind)) + "</span>" +
        "<h3>" + esc(t(p.name) || p.series || p.id) + "</h3>" +
        (p.series ? '<div class="pcard__series">' + esc(p.series) + "</div>" : "") +
        (p.cat_name ? '<div class="pcard__cat">' + esc(p.cat_name) + "</div>" : "") +
        (specLine(p) ? '<div class="pcard__spec">' + specLine(p) + "</div>" : "") +
      "</div></article>";
  }

  function render(list) {
    if (!list.length) {
      grid.innerHTML = all.length
        ? '<p class="prod-state">No products match your filters.</p>'
        : '<p class="prod-state">No products published yet.</p>';
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  /* ---------- 搜尋與篩選 ---------- */

  var state = { q: "", kind: "all", cat: "all" };

  function matches(p) {
    if (state.kind !== "all" && (p.web_kind || "platform") !== state.kind) return false;
    if (state.cat !== "all" && (p.cat_name || "") !== state.cat) return false;
    if (state.q) {
      // 搜尋所有語言的名稱與型號，讓中文或越南文使用者也搜得到
      var hay = [
        JSON.stringify(p.name || ""), p.series, p.id,
        p.cat_name, p.material, JSON.stringify(p.features || "")
      ].join(" ").toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function apply() {
    var list = all.filter(matches);
    render(list);
    var count = document.getElementById("prodCount");
    if (count) {
      count.textContent = list.length === all.length
        ? all.length + " products"
        : list.length + " of " + all.length + " products";
    }
  }

  function buildControls() {
    var cats = all.map(function (p) { return p.cat_name; })
      .filter(function (c, i, a) { return c && a.indexOf(c) === i; })
      .sort();

    var hasKinds = all.some(function (p) { return p.web_kind === "quick"; }) &&
                   all.some(function (p) { return (p.web_kind || "platform") === "platform"; });

    filterBar.innerHTML =
      '<div class="pfilter">' +
        '<label class="pfilter__search">' +
          '<span class="vh">Search products</span>' +
          '<input type="search" id="prodSearch" placeholder="Search by name or model…" autocomplete="off">' +
        "</label>" +
        (cats.length
          ? '<label class="pfilter__select"><span class="vh">Category</span>' +
            '<select id="prodCat"><option value="all">All categories</option>' +
            cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("") +
            "</select></label>"
          : "") +
        (hasKinds
          ? '<label class="pfilter__select"><span class="vh">Type</span>' +
            '<select id="prodKind"><option value="all">All types</option>' +
            '<option value="platform">Existing Products</option>' +
            '<option value="quick">Quick Customization</option></select></label>'
          : "") +
        '<span class="pfilter__count" id="prodCount"></span>' +
      "</div>";
    filterBar.hidden = false;

    var search = document.getElementById("prodSearch");
    var timer;
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = search.value.trim().toLowerCase();
        apply();
      }, 150);
    });

    var catSel = document.getElementById("prodCat");
    if (catSel) catSel.addEventListener("change", function () { state.cat = this.value; apply(); });

    var kindSel = document.getElementById("prodKind");
    if (kindSel) kindSel.addEventListener("change", function () { state.kind = this.value; apply(); });
  }

  /* ---------- 啟動 ---------- */

  if (!CFG.url) {
    grid.innerHTML = '<p class="prod-state is-error">Product data source is not configured.</p>';
    return;
  }

  fetchProducts()
    .then(function (list) {
      all = list || [];
      render(all);
      if (all.length) buildControls();
    })
    .catch(function (err) {
      grid.innerHTML = '<p class="prod-state is-error">Product list is temporarily unavailable. ' +
        'Please contact <a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.</p>';
      if (window.console) console.error("[products]", err);
    });
})();
