/* =========================================================
   COMART 官網後台 — Supabase 連線層
   ---------------------------------------------------------
   不使用 supabase-js SDK：後台是純靜態頁面，直接打 REST 與 Auth 端點
   可以少一個 CDN 依賴，也避免 CSP 例外。介面刻意做得小而明確。

   session 存在 localStorage。存的是 Supabase 發的 access/refresh token，
   不是密碼；登出會清掉。
   ========================================================= */
(function (global) {
  "use strict";

  var CFG = global.COMART_SUPABASE || {};
  var SESSION_KEY = "comart-web-session";

  function must() {
    if (!CFG.url || !CFG.publishableKey) {
      throw new Error("Supabase 設定缺失：請檢查 webadmin/config.js");
    }
  }

  /* ---------- session ---------- */

  var session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { session = null; }

  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function expired() {
    if (!session || !session.expires_at) return true;
    // 提前 60 秒視為過期，避免請求送出途中剛好失效
    return Date.now() / 1000 > session.expires_at - 60;
  }

  /* ---------- 低階請求 ---------- */

  function headers(withAuth) {
    var h = {
      apikey: CFG.publishableKey,
      "content-type": "application/json",
    };
    if (withAuth && session && session.access_token) {
      h.authorization = "Bearer " + session.access_token;
    } else {
      h.authorization = "Bearer " + CFG.publishableKey;
    }
    return h;
  }

  function request(path, opts) {
    must();
    opts = opts || {};
    return fetch(CFG.url + path, {
      method: opts.method || "GET",
      headers: Object.assign(headers(opts.auth !== false), opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) {
          var msg = (data && (data.msg || data.message || data.error_description || data.error)) ||
                    ("HTTP " + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------- Auth ---------- */

  var auth = {
    signIn: function (email, password) {
      return request("/auth/v1/token?grant_type=password", {
        method: "POST",
        auth: false,
        body: { email: email, password: password },
      }).then(function (data) {
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
          user: data.user ? { id: data.user.id, email: data.user.email } : null,
        });
        return session;
      });
    },

    refresh: function () {
      if (!session || !session.refresh_token) return Promise.reject(new Error("沒有可用的 session"));
      return request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        auth: false,
        body: { refresh_token: session.refresh_token },
      }).then(function (data) {
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
          user: session.user,
        });
        return session;
      }).catch(function (e) { saveSession(null); throw e; });
    },

    signOut: function () {
      var had = !!session;
      saveSession(null);
      return had
        ? request("/auth/v1/logout", { method: "POST" }).catch(function () { /* 本地已清掉就夠了 */ })
        : Promise.resolve();
    },

    /** 有 session 且未過期則沿用；過期則嘗試 refresh。 */
    ensure: function () {
      if (!session) return Promise.reject(new Error("未登入"));
      if (!expired()) return Promise.resolve(session);
      return auth.refresh();
    },

    current: function () { return session; },
  };

  /* ---------- 資料表操作 ---------- */

  function qs(params) {
    var out = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) {
        out.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    });
    return out.length ? "?" + out.join("&") : "";
  }

  var db = {
    select: function (table, params) {
      return auth.ensure().then(function () {
        return request("/rest/v1/" + table + qs(Object.assign({ select: "*" }, params)));
      });
    },

    /** 匿名可讀的資料（前台預覽用），不需要 session。 */
    selectPublic: function (table, params) {
      return request("/rest/v1/" + table + qs(Object.assign({ select: "*" }, params)), { auth: false });
    },

    upsert: function (table, rows, onConflict) {
      return auth.ensure().then(function () {
        return request("/rest/v1/" + table + qs({ on_conflict: onConflict }), {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=representation" },
          body: Array.isArray(rows) ? rows : [rows],
        });
      });
    },

    update: function (table, match, patch) {
      return auth.ensure().then(function () {
        return request("/rest/v1/" + table + qs(match), {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: patch,
        });
      });
    },

    insert: function (table, row) {
      return auth.ensure().then(function () {
        return request("/rest/v1/" + table, {
          method: "POST",
          headers: { prefer: "return=representation" },
          body: [row],
        });
      });
    },

    remove: function (table, match) {
      return auth.ensure().then(function () {
        return request("/rest/v1/" + table + qs(match), { method: "DELETE" });
      });
    },
  };

  /* ---------- Edge Functions ---------- */

  var fn = {
    /** 使用者管理：需要 service_role，一律經 Edge Function */
    users: function (action, payload) {
      return auth.ensure().then(function () {
        return request("/functions/v1/admin-users", {
          method: "POST",
          body: Object.assign({ action: action }, payload || {}),
        });
      });
    },

    translate: function (text, from, to, context) {
      return auth.ensure().then(function () {
        return request("/functions/v1/translate", {
          method: "POST",
          body: { text: text, from: from, to: to, context: context },
        });
      });
    },
  };

  global.SB = { auth: auth, db: db, fn: fn, config: CFG };
})(window);
