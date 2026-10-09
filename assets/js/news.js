/* =========================================================
   COMART 官網 — 公司動態
   ---------------------------------------------------------
   讀 web_news。RLS 只讓匿名看到 status = 'live' 的資料，
   所以草稿不會外流，前端不需要自己過濾。

   同一支腳本供兩處使用，靠容器上的 data-limit 決定筆數：
     首頁      data-limit="3"   顯示最新三則，附「查看全部」
     /news/    無 limit         全部，並提供分類篩選
   ========================================================= */
(function () {
  "use strict";

  var CFG = window.COMART_SUPABASE || {};

  // 站台語言取自 <html lang>，同時也是 title / body 這些多語 JSONB 欄位的鍵
  var LANG = (document.documentElement.lang || "en").trim() || "en";

  // 介面字串。找不到當前語言就退回英文。
  var STR = {
    "en": {
      none: "No news published yet.",
      unavailable: "News is temporarily unavailable.",
      untitled: "Untitled",
      all: "All news",
      allCats: "All",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      date: function (y, m, d, months) { return months[m - 1] + " " + d + ", " + y; }
    },
    "zh-TW": {
      none: "目前尚無發布的消息。",
      unavailable: "消息暫時無法顯示。",
      untitled: "未命名",
      all: "查看全部消息",
      allCats: "全部",
      months: null,
      date: function (y, m, d) { return y + " 年 " + m + " 月 " + d + " 日"; }
    },
    "vi": {
      none: "Chưa có tin tức nào được công bố.",
      unavailable: "Tin tức tạm thời không khả dụng.",
      untitled: "Chưa có tiêu đề",
      all: "Tất cả tin tức",
      allCats: "Tất cả",
      months: null,
      date: function (y, m, d) { return d + "/" + m + "/" + y; }
    }
  };
  var S = STR[LANG] || STR.en;

  var grid = document.getElementById("newsGrid");
  if (!grid) return;

  var filterBar = document.getElementById("newsFilters");
  var limit = parseInt(grid.dataset.limit || "0", 10);
  var root = grid.dataset.root || "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* title / body 是多語 jsonb */
  function t(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return v[LANG] || v.en || v["zh-TW"] || Object.values(v)[0] || "";
  }

  /** 日期格式依語言而異：英文用縮寫月名，繁中用年月日，越南文用 d/m/Y */
  function fmtDate(d) {
    if (!d) return "";
    var parts = String(d).slice(0, 10).split("-");
    if (parts.length !== 3) return d;
    return S.date(parts[0], parseInt(parts[1], 10), parseInt(parts[2], 10), S.months);
  }

  /** 內文取前段作摘要，不硬切字中間 */
  function excerpt(text, max) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(" ");
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + "…";
  }

  function card(n) {
    var body = excerpt(t(n.body), 180);
    return '<article class="news">' +
      '<div class="meta"><span class="cat">' + esc(n.category) + "</span>" +
      "<span>" + esc(fmtDate(n.published_at)) + "</span></div>" +
      "<h3>" + esc(t(n.title) || S.untitled) + "</h3>" +
      // 內文為空時不輸出段落，否則卡片會留一塊空白
      (body ? "<p>" + esc(body) + "</p>" : "") +
      "</article>";
  }

  /**
   * 依事件時間排序。
   *
   * 單純照日期新到舊（原本的作法）對「已經發生的消息」是對的，
   * 但對「還沒發生的展覽」是反的——下週就要開的那場，會被排在一個月後那場的下面。
   * 單純改成舊到新也不行，那會讓多年前的舊聞永遠佔住最上面。
   *
   * 所以分兩段：
   *   未來的事件（含今天）在前，由近而遠——最快要發生的排第一
   *   已經發生的在後，由新而舊——最近發生的排第一
   * 兩段內部都是照事件時間讀下來，合起來也符合使用者真正關心的順序。
   */
  function byEventTime(list) {
    var today = new Date().toISOString().slice(0, 10);   // 與 published_at 同為 YYYY-MM-DD
    var upcoming = [], past = [];
    list.forEach(function (n) {
      (String(n.published_at || "") >= today ? upcoming : past).push(n);
    });
    upcoming.sort(function (a, b) { return a.published_at < b.published_at ? -1 : a.published_at > b.published_at ? 1 : 0; });
    past.sort(function (a, b) { return a.published_at > b.published_at ? -1 : a.published_at < b.published_at ? 1 : 0; });
    return upcoming.concat(past);
  }

  function render(list, total) {
    if (!list.length) {
      grid.innerHTML = '<p class="prod-state">' + esc(S.none) + "</p>";
      return;
    }
    // total 是排序後的總筆數。list 可能已被 limit 切過，
    // 用 list.length 判斷會在「剛好 3 則」時誤顯示「查看全部」。
    grid.innerHTML = list.map(card).join("") +
      (limit && (total || list.length) > limit
        ? '<div class="news-more"><a class="tlink" href="' + root +
          'news/">' + esc(S.all) + ' <span>&rarr;</span></a></div>'
        : "");
  }

  function buildFilters(all) {
    if (!filterBar) return;
    var cats = [S.allCats].concat(all.map(function (n) { return n.category; })
      .filter(function (c, i, a) { return c && a.indexOf(c) === i; }));
    if (cats.length <= 2) return;                       // 只有一種分類就不必篩選
    filterBar.innerHTML = cats.map(function (c, i) {
      return '<button class="chip' + (i === 0 ? " is-on" : "") + '" data-cat="' +
             esc(c) + '">' + esc(c) + "</button>";
    }).join("");
    filterBar.hidden = false;
    filterBar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cat]");
      if (!b) return;
      filterBar.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("is-on"); });
      b.classList.add("is-on");
      var c = b.dataset.cat;
      render(c === S.allCats ? all : all.filter(function (n) { return n.category === c; }));
    });
  }

  if (!CFG.url) {
    grid.innerHTML = '<p class="prod-state is-error">News source is not configured.</p>';
    return;
  }

  // 這裡刻意不帶 limit。排序要在拿到全部資料之後才決定（見 byEventTime），
  // 先在伺服器端砍筆數會砍錯——未來的展覽是「日期越大越晚」，
  // 用 desc + limit 3 拿到的是最遠的三場，不是最近的三場。
  // 200 只是防呆上限，不是分頁。
  var url = CFG.url + "/rest/v1/web_news" +
            "?select=id,category,published_at,title,body" +
            "&order=published_at.desc&limit=200";

  fetch(url, { headers: { apikey: CFG.publishableKey, Authorization: "Bearer " + CFG.publishableKey } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (list) {
      var sorted = byEventTime(list || []);
      // 分類篩選要看得到所有分類，所以 buildFilters 吃完整清單；
      // 只有顯示筆數受 limit 影響。
      render(limit ? sorted.slice(0, limit) : sorted, sorted.length);
      buildFilters(sorted);
    })
    .catch(function (err) {
      grid.innerHTML = '<p class="prod-state is-error">' + esc(S.unavailable) + "</p>";
      if (window.console) console.error("[news]", err);
    });
})();
