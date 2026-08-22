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

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!CFG.url) {
      say("error", "This form is not connected yet. Please email " +
        '<a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.');
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
      say("error", "Please complete the required fields marked with an asterisk.");
      return;
    }

    btn.disabled = true;
    var label = btn.innerHTML;
    btn.innerHTML = "Sending…";

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
          say("error", "We could not send your enquiry." + details +
            '<br>Please email <a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.');
          btn.disabled = false; btn.innerHTML = label;
          return;
        }
        form.querySelectorAll("input, select, textarea").forEach(function (el) { el.value = ""; });
        say("ok", "<b>Thank you — your enquiry has been received.</b><br>" +
          "Our team will come back to you at the email address you provided. " +
          "If your project is time-critical, you can also reach us directly at " +
          '<a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.');
        btn.innerHTML = "Sent";
      })
      .catch(function (err) {
        if (window.console) console.error("[enquiry]", err);
        say("error", "We could not reach the server. Please email " +
          '<a href="mailto:sales@comart.com.tw">sales@comart.com.tw</a>.');
        btn.disabled = false; btn.innerHTML = label;
      });
  });
})();
