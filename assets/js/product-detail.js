/* =========================================================
   COMART 官網 — 產品詳細頁
   ---------------------------------------------------------
   網址格式：/products/detail/?id=<product id>

   為什麼用查詢參數而不是每個產品一個靜態頁：
     產品主檔在資料庫、上架狀態隨時由後台變動，而站台是建置時產生的靜態檔。
     若預先產生 317 × 3 語 = 951 頁，任何上架變動都會留下陳舊頁面。
     待 build.py 具備讀取資料庫的能力後（與頁面文案同步同一套基礎設施），
     可再改為建置時產生真正的靜態路徑。

   SEO：標題、描述與 canonical 由本檔在取得資料後寫入。Google 會執行 JS
   因此讀得到；其他爬蟲支援程度不一，這是上述取捨的已知代價。
   ========================================================= */
(function () {
  "use strict";

  var CFG = window.COMART_SUPABASE || {};
  var VIEW = "web_products_public";
  var LANG = (document.documentElement.lang || "en").trim() || "en";

  var STR = {
    "en": {
      existing: "Existing Product", quick: "Quick Customization",
      model: "Model", dim: "Dimensions", weight: "Weight", material: "Material",
      interface: "Interface", origin: "Category",
      specs: "Specifications", features: "Product features",
      loading: "Loading product…",
      notFound: "This product is not available.",
      notFoundBody: "It may have been withdrawn, or the link may be incomplete. " +
                    "Browse the full range, or ask us directly.",
      home: "Home", back: "All products", enquire: "Enquire About This Product",
      askAnother: "Browse All Products",
      ctaTitle: "Interested in this product?",
      ctaBody: "Tell us your volume and destination market. We will come back with what can be " +
               "customised, what has to stay as it is, and the realistic timing.",
      moqNote: "MOQ and lead time are evaluated based on the product, material, tooling " +
               "complexity and order volume.",
      imageAlt: function (n) { return "View " + n; }
    },
    "zh-TW": {
      existing: "既有產品", quick: "快速客製化",
      model: "型號", dim: "尺寸", weight: "重量", material: "材質",
      interface: "介面", origin: "類別",
      specs: "規格", features: "產品特色",
      loading: "載入產品資料…",
      notFound: "找不到這項產品。",
      notFoundBody: "它可能已經下架，或是連結不完整。您可以瀏覽完整產品線，或直接與我們聯絡。",
      home: "首頁", back: "所有產品", enquire: "洽詢這項產品",
      askAnother: "瀏覽所有產品",
      ctaTitle: "對這項產品有興趣？",
      ctaBody: "告訴我們您的數量與銷售市場，我們會回覆哪些部分可以客製、" +
               "哪些必須維持原樣，以及實際的時程。",
      moqNote: "最小訂購量與交期依產品、材質、模具複雜度與訂單數量評估。",
      imageAlt: function (n) { return "第 " + n + " 張"; }
    },
    "vi": {
      existing: "Sản phẩm hiện có", quick: "Tùy biến nhanh",
      model: "Mã sản phẩm", dim: "Kích thước", weight: "Khối lượng", material: "Vật liệu",
      interface: "Giao diện", origin: "Danh mục",
      specs: "Thông số", features: "Đặc điểm sản phẩm",
      loading: "Đang tải sản phẩm…",
      notFound: "Không tìm thấy sản phẩm này.",
      notFoundBody: "Sản phẩm có thể đã ngừng cung cấp, hoặc liên kết chưa đầy đủ. " +
                    "Bạn có thể xem toàn bộ danh mục, hoặc liên hệ trực tiếp với chúng tôi.",
      home: "Trang chủ", back: "Tất cả sản phẩm", enquire: "Hỏi về sản phẩm này",
      askAnother: "Xem tất cả sản phẩm",
      ctaTitle: "Bạn quan tâm đến sản phẩm này?",
      ctaBody: "Hãy cho chúng tôi biết số lượng và thị trường mục tiêu. Chúng tôi sẽ phản hồi " +
               "về những gì có thể tùy biến, những gì phải giữ nguyên, và thời gian thực tế.",
      moqNote: "MOQ và thời gian giao hàng được đánh giá theo sản phẩm, vật liệu, " +
               "độ phức tạp của khuôn và số lượng đặt hàng.",
      imageAlt: function (n) { return "Ảnh " + n; }
    }
  };
  var S = STR[LANG] || STR.en;

  var host = document.getElementById("pdetail");
  if (!host) return;
  var BASE = host.dataset.base || "";

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function t(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return v[LANG] || v.en || v["zh-TW"] || Object.values(v)[0] || "";
  }

  var OBJ = "/storage/v1/object/public/";
  var REN = "/storage/v1/render/image/public/";

  function thumb(url, w) {
    if (!url || url.indexOf(OBJ) === -1) return url;
    // resize=contain 不可省略，否則 Supabase 預設 cover 會裁掉圖
    return url.replace(OBJ, REN) + "?width=" + w + "&quality=80&resize=contain";
  }

  /** features 是條列文字（每行以 - 開頭），拆成清單才好讀 */
  function featureList(raw) {
    var lines = String(raw || "").split(/\r?\n/)
      .map(function (l) { return l.replace(/^\s*[-•·]\s*/, "").trim(); })
      .filter(Boolean);
    if (!lines.length) return "";
    return '<ul class="pdt__features">' +
      lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
  }

  function specTable(p) {
    var rows = [
      [S.model, p.series],
      [S.origin, p.cat_name],
      [S.dim, p.dim],
      [S.weight, p.weight],
      [S.material, p.material],
      [S.interface, p.interface || p.interfaceA]
    ].filter(function (r) { return r[1]; });
    if (!rows.length) return "";
    return '<dl class="pdt__specs">' + rows.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  /** 有多張圖時提供切換；只有一張就單純顯示，不做出假的相簿介面 */
  function gallery(p, alt) {
    var imgs = [p.img, p.img2, p.img3].filter(Boolean);
    if (!imgs.length) return '<div class="pdt__img is-empty" aria-hidden="true"></div>';
    var main = '<div class="pdt__img"><img id="pdtMain" src="' + esc(thumb(imgs[0], 900)) +
               '" alt="' + esc(alt) + '" decoding="async"></div>';
    if (imgs.length === 1) return main;
    var thumbs = imgs.map(function (u, i) {
      return '<button class="pdt__thumb' + (i === 0 ? " is-on" : "") +
             '" data-src="' + esc(thumb(u, 900)) + '" aria-label="' + esc(S.imageAlt(i + 1)) + '">' +
             '<img src="' + esc(thumb(u, 200)) + '" alt=""></button>';
    }).join("");
    return main + '<div class="pdt__thumbs">' + thumbs + "</div>";
  }

  function setMeta(name, value, attr) {
    var sel = (attr || "name") + '="' + name + '"';
    var el = document.querySelector("meta[" + sel + "]");
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr || "name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", value);
  }

  /* ---------- 繪製 ---------- */

  function renderNotFound() {
    host.innerHTML =
      '<div class="pdt__missing">' +
        "<h1>" + esc(S.notFound) + "</h1>" +
        "<p>" + esc(S.notFoundBody) + "</p>" +
        '<div class="row">' +
          '<a class="btn" href="' + BASE + 'products/">' + esc(S.askAnother) +
            ' <span class="arrow">&rarr;</span></a>' +
          '<a class="btn btn--dark" href="' + BASE + 'inquiry/">' + esc(S.enquire) +
            ' <span class="arrow">&rarr;</span></a>' +
        "</div>" +
      "</div>";
  }

  function render(p) {
    var name = t(p.name) || p.series || p.id;
    var kind = p.web_kind === "quick" ? S.quick : S.existing;
    var feats = featureList(t(p.features));

    document.title = name + " — COMART";
    setMeta("description", (t(p.features) || name).replace(/\s+/g, " ").slice(0, 160));
    var can = document.querySelector('link[rel="canonical"]');
    if (can) can.setAttribute("href", location.href.split("#")[0]);

    host.innerHTML =
      '<nav class="crumbs" aria-label="Breadcrumb">' +
        '<a href="' + BASE + '">' + esc(S.home) + "</a> <span>/</span> " +
        '<a href="' + BASE + 'products/">' + esc(S.back) + "</a> <span>/</span> " +
        "<span>" + esc(p.series || name) + "</span>" +
      "</nav>" +
      '<div class="pdt">' +
        '<div class="pdt__media">' + gallery(p, name) + "</div>" +
        '<div class="pdt__body">' +
          '<div class="pdt__top">' +
            '<span class="pcard__kind">' + esc(kind) + "</span>" +
            (p.cat_name ? '<span class="pcard__cat">' + esc(p.cat_name) + "</span>" : "") +
          "</div>" +
          "<h1>" + esc(name) + "</h1>" +
          (feats ? '<h2 class="pdt__h">' + esc(S.features) + "</h2>" + feats : "") +
          (specTable(p) ? '<h2 class="pdt__h">' + esc(S.specs) + "</h2>" + specTable(p) : "") +
          '<div class="pdt__cta">' +
            '<a class="btn" href="' + BASE + "start-your-project/?product=" +
              encodeURIComponent(p.series || p.id) + '">' + esc(S.enquire) +
              ' <span class="arrow">&rarr;</span></a>' +
            '<a class="tlink" href="' + BASE + 'products/">' + esc(S.askAnother) +
              " <span>&rarr;</span></a>" +
          "</div>" +
          '<p class="pdt__note">' + esc(S.moqNote) + "</p>" +
        "</div>" +
      "</div>";

    var main = document.getElementById("pdtMain");
    var thumbs = host.querySelector(".pdt__thumbs");
    if (main && thumbs) {
      thumbs.addEventListener("click", function (e) {
        var b = e.target.closest(".pdt__thumb");
        if (!b) return;
        thumbs.querySelectorAll(".pdt__thumb").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        main.src = b.dataset.src;
      });
    }
  }

  /* ---------- 啟動 ---------- */

  var id = new URLSearchParams(location.search).get("id");
  if (!CFG.url || !id) { renderNotFound(); return; }

  host.innerHTML = '<p class="prod-state">' + esc(S.loading) + "</p>";

  var cols = ["id","series","name","features","cat_name","cat2_name","material",
              "interface","interfaceA","dim","weight","img","img2","img3",
              "status","web_kind","web_summary"].join(",");

  fetch(CFG.url + "/rest/v1/" + VIEW + "?select=" + cols +
        "&id=eq." + encodeURIComponent(id) + "&limit=1",
        { headers: { apikey: CFG.publishableKey, Authorization: "Bearer " + CFG.publishableKey } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (list) {
      if (!list || !list.length) { renderNotFound(); return; }
      render(list[0]);
    })
    .catch(function (err) {
      if (window.console) console.error("[product-detail]", err);
      renderNotFound();
    });
})();
