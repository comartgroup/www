/* =========================================================
   COMART 官網 — Start Your Project 表單送出
   ---------------------------------------------------------
   送到 Supabase Edge Function（enquiry），由伺服器端驗證、寫入
   web_enquiries 並通知業務。前端不持有任何機密金鑰，也不直接寫資料表。

   前端的檢查只是為了讓使用者少跑一趟；真正的驗證在 function 裡，
   繞過前端不會有任何好處。
   ========================================================= */
(function () {
  "use strict";

  var CFG = window.COMART_SUPABASE || {};
  var form = document.getElementById("enquiryForm");
  if (!form) return;

  var MAILTO = '<a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>';

  // 站台語言取自 <html lang>；找不到當前語言的字串就退回英文。
  // 注意：Edge Function 回傳的 details 陣列是英文的伺服器端驗證訊息，這裡不翻譯。
  var LANG = (document.documentElement.lang || "en").trim() || "en";
  var STR = {
    "en": {
      notConnected: "This form is not connected yet. Please email " + MAILTO + ".",
      missing: "Please complete the required fields marked with an asterisk.",
      sending: "Sending\u2026",
      sent: "Sent",
      failed: "We could not send your enquiry.",
      failedTail: "<br>Please email " + MAILTO + ".",
      unreachable: "We could not reach the server. Please email " + MAILTO + ".",
      thanks: "<b>Thank you \u2014 your enquiry has been received.</b><br>" +
              "Our team will come back to you at the email address you provided. " +
              "If your project is time-critical, you can also reach us directly at " + MAILTO + "."
    },
    "zh-TW": {
      notConnected: "這份表單尚未接上伺服器，請改寄 " + MAILTO + "。",
      missing: "請填寫標示 * 的必填欄位。",
      sending: "傳送中\u2026",
      sent: "已送出",
      failed: "您的洽詢未能送出。",
      failedTail: "<br>請改寄 " + MAILTO + "。",
      unreachable: "無法連線到伺服器，請改寄 " + MAILTO + "。",
      thanks: "<b>感謝您 —— 我們已收到您的洽詢。</b><br>" +
              "我們的團隊會用您填寫的電子郵件回覆您。" +
              "若這個案子時間緊迫，也可以直接聯絡 " + MAILTO + "。"
    },
    "vi": {
      notConnected: "Biểu mẫu này chưa được kết nối. Vui lòng gửi email tới " + MAILTO + ".",
      missing: "Vui lòng điền các trường bắt buộc có dấu *.",
      sending: "Đang gửi\u2026",
      sent: "Đã gửi",
      failed: "Chúng tôi không gửi được yêu cầu của bạn.",
      failedTail: "<br>Vui lòng gửi email tới " + MAILTO + ".",
      unreachable: "Không kết nối được tới máy chủ. Vui lòng gửi email tới " + MAILTO + ".",
      thanks: "<b>Cảm ơn bạn \u2014 chúng tôi đã nhận được yêu cầu của bạn.</b><br>" +
              "Đội ngũ của chúng tôi sẽ phản hồi qua địa chỉ email bạn đã cung cấp. " +
              "Nếu dự án của bạn gấp về thời gian, bạn cũng có thể liên hệ trực tiếp " + MAILTO + "."
    }
  };
  var S = STR[LANG] || STR.en;

  var note = document.getElementById("formNote");
  var btn = document.getElementById("enquirySubmit");

  /* 表單欄位 → 資料表欄位 */
  var MAP = {
    company: "company", contact: "contact", email: "email", country: "country",
    ptype: "product_type", stage: "stage", services: "services",
    volume: "volume", market: "market", launch: "launch",
    summary: "summary", nda: "nda"
  };

  function say(kind, html) {
    if (!note) return;
    note.hidden = false;
    note.className = "placeholder-flag is-wide is-" + kind;
    note.innerHTML = html;
    note.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function payload() {
    var out = { source_lang: document.documentElement.lang || "en" };
    Object.keys(MAP).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value.trim()) out[MAP[id]] = el.value.trim();
    });
    return out;
  }


  /* 由產品詳細頁帶入的型號：預填進專案摘要，業務收到就知道是哪一項。
     只在摘要為空時填入，不覆寫使用者已經打的字。 */
  (function prefillProduct() {
    var model = new URLSearchParams(location.search).get("product");
    if (!model) return;
    var box = document.getElementById("summary");
    if (!box || box.value.trim()) return;
    var LEAD = {
      "en": "Enquiry about product ",
      "zh-TW": "洽詢產品 ",
      "vi": "Hỏi về sản phẩm "
    };
    box.value = (LEAD[LANG] || LEAD.en) + model + "\n\n";
    var ptype = document.getElementById("ptype");
    if (ptype) { try { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } catch (e) {} }
  })();

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!CFG.url) {
      say("error", S.notConnected);
      return;
    }

    // 必填欄位：與 Edge Function 的 REQUIRED 一致
    var missing = ["company", "contact", "email", "country", "summary"].filter(function (id) {
      var el = document.getElementById(id);
      return !el || !el.value.trim();
    });
    if (missing.length) {
      var first = document.getElementById(missing[0]);
      if (first) first.focus();
      say("error", S.missing);
      return;
    }

    btn.disabled = true;
    var label = btn.innerHTML;
    btn.innerHTML = S.sending;

    fetch(CFG.url + "/functions/v1/enquiry", {
      method: "POST",
      headers: {
        apikey: CFG.publishableKey,
        Authorization: "Bearer " + CFG.publishableKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload())
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) {
          var details = (r.data && r.data.details) ? "<br>" + r.data.details.join("<br>") : "";
          say("error", S.failed + details + S.failedTail);
          btn.disabled = false; btn.innerHTML = label;
          return;
        }
        form.querySelectorAll("input, select, textarea").forEach(function (el) { el.value = ""; });
        say("ok", S.thanks);
        btn.innerHTML = S.sent;
      })
      .catch(function (err) {
        if (window.console) console.error("[enquiry]", err);
        say("error", S.unreachable);
        btn.disabled = false; btn.innerHTML = label;
      });
  });
})();
