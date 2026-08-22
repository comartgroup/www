/* =========================================================
   COMART 官網 — 產品資料層
   ---------------------------------------------------------
   產品主檔在報價系統（Supabase 專案 tcvlnpgpuphdalzvmoyo）的 products 資料表。
   官網「不得」直接讀取該表：表內含 supplier1/2、cost1/2、curr1/2、costRef、
   defaultPrice、bom、bomFiles 等機密欄位。

   正式串接方式：在 Supabase 建立只含可公開欄位的 view（web_products_public），
   對 anon 角色開放唯讀，官網只讀該 view。細節見 docs/DATA.md。

   目前 SOURCE = 'sample'，讀取 assets/data/products.sample.json，
   資料庫就緒後把 SOURCE 改成 'supabase' 並填入 SUPABASE 設定即可，頁面不需改動。
   ========================================================= */
(function () {
  "use strict";

  var SOURCE = "sample";           // 'sample' | 'supabase'
  var LANG = "en";                 // 對應 products.name / features 的 JSONB 鍵：en / zh-TW / vi

  var SUPABASE = {
    url: "",                       // 例：https://tcvlnpgpuphdalzvmoyo.supabase.co
    anonKey: "",                   // 受 RLS 保護的 publishable key，不可放 service_role
    view: "web_products_public"
  };

  var grid = document.getElementById("prodGrid");
  var filterBar = document.getElementById("prodFilters");
  if (!grid) return;

  /* ---------- 資料來源 ---------- */

  function fetchSample() {
    var base = document.currentScript ? "" : "";
    return fetch(rootPrefix() + "assets/data/products.sample.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) { return json.products || []; });
  }

  function fetchSupabase() {
    var cols = [
      "id", "series", "name", "features", "catId", "catId2", "material",
      "interface", "interfaceA", "interfaceB", "coo", "dim", "weight",
      "img", "img2", "img3", "status", "web_kind"
    ].join(",");
    var url = SUPABASE.url + "/rest/v1/" + SUPABASE.view +
              "?select=" + cols + "&order=series.asc";
    return fetch(url, {
      headers: { apikey: SUPABASE.anonKey, Authorization: "Bearer " + SUPABASE.anonKey }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- 工具 ---------- */

  // 產品頁可能位於任何目錄深度，推算回站台根目錄
  function rootPrefix() {
    var depth = location.pathname.replace(/\/[^/]*$/, "/").split("/").length -
                (location.pathname.indexOf("/www/") === 0 ? 3 : 2);
    return depth > 0 ? new Array(depth + 1).join("../") : "";
  }

  // name / features 是多語 JSONB：{ "en": "...", "zh-TW": "...", "vi": "..." }
  function t(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return value[LANG] || value.en || value["zh-TW"] || Object.values(value)[0] || "";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 繪製 ---------- */

  function specLine(p) {
    return [p.material, p.interface || p.interfaceA, p.dim, p.coo]
      .filter(Boolean).map(esc).join(" · ");
  }

  function card(p) {
    var img = p.img
      ? '<div class="pcard__img"><img src="' + esc(p.img) + '" alt="" loading="lazy"></div>'
      : '<div class="pcard__img is-empty" aria-hidden="true"></div>';
    var kind = p.web_kind === "quick" ? "Quick Customization" : "Platform Product";
    return '<article class="pcard">' + img +
      '<div class="pcard__body">' +
        '<span class="pcard__kind">' + esc(kind) + '</span>' +
        '<h3>' + esc(t(p.name) || p.series || p.id) + '</h3>' +
        (p.series ? '<div class="pcard__series">' + esc(p.series) + '</div>' : '') +
        (specLine(p) ? '<div class="pcard__spec">' + specLine(p) + '</div>' : '') +
      '</div></article>';
  }

  function render(list) {
    if (!list.length) {
      grid.innerHTML = '<p class="prod-state">No products published yet.</p>';
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  function buildFilters(list, all) {
    var kinds = [
      { key: "all", label: "All" },
      { key: "platform", label: "Platform Products" },
      { key: "quick", label: "Quick Customization" }
    ];
    filterBar.innerHTML = kinds.map(function (k, i) {
      return '<button class="chip' + (i === 0 ? " is-on" : "") + '" data-filter="' +
             k.key + '">' + k.label + "</button>";
    }).join("");
    filterBar.hidden = false;
    filterBar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-filter]");
      if (!b) return;
      filterBar.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("is-on"); });
      b.classList.add("is-on");
      var f = b.dataset.filter;
      render(f === "all" ? all : all.filter(function (p) { return (p.web_kind || "platform") === f; }));
    });
  }

  /* ---------- 啟動 ---------- */

  (SOURCE === "supabase" ? fetchSupabase() : fetchSample())
    .then(function (list) {
      render(list);
      buildFilters(list, list);
    })
    .catch(function (err) {
      grid.innerHTML = '<p class="prod-state is-error">Product list is temporarily unavailable. ' +
        'Please contact <a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.</p>';
      if (window.console) console.error("[products]", err);
    });
})();
