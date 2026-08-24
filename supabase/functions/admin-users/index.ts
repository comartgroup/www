/**
 * COMART 官網 — 後台使用者管理
 *
 * 建立帳號、設定密碼、刪除帳號都需要 service_role 權限，那把 key 絕對不能出現在
 * 前端，所以這些動作一律經過本函式。呼叫者必須是 web_editors 裡 role='admin' 的帳號。
 *
 * 密碼原則（2026-08-24 Woody 指示）：至少 10 碼 + 禁用常見密碼。
 *   不再要求大小寫與符號——組成規則會把人逼向可預測的形狀。詳見下方註解。
 *   密碼由管理者自行輸入，本函式不產生密碼——產生的密碼還是得口頭轉達，
 *   等於多一道手續而沒有多一分安全。這裡負責的是「擋掉不該用的密碼」。
 *
 * ★ 使用者名冊的實際範圍（2026-08-23 實地查證後更正）：
 *   平台各系統（報價、CRM、KMS、CPF、內部 Portal）**不使用** Supabase auth，
 *   它們是工號 + 自建 users 表 + PBKDF2。因此 auth.users 實質上是官網專屬，
 *   兩套密碼庫完全獨立，在這裡改密碼不會影響那些系統。
 *
 * 動作：
 *   list           列出官網編輯者（含最後登入時間）
 *   create         建立帳號並加入白名單；email 已存在時只加入白名單、不動密碼
 *   set_password   由管理者指定新密碼
 *   remove         刪除使用者：移出白名單，並在安全的情況下一併刪除 auth 帳號
 *
 * 部署：
 *   supabase functions deploy admin-users --project-ref tcvlnpgpuphdalzvmoyo
 */

const ROLES = ["admin", "editor", "product", "publisher"];

const ALLOWED_ORIGINS = [
  "https://comartgroup.github.io",
  "https://www.comart.com.tw",
  "http://localhost:8899",
];

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    // 瀏覽器 preflight 會宣告 apikey 與 authorization，少列任何一個都會讓
    // 整個請求在 preflight 階段就失敗——curl 不做 preflight，測不出來
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });
}

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function svc(path: string, init?: RequestInit) {
  return fetch(URL_ + path, {
    ...init,
    headers: {
      apikey: SVC,
      authorization: `Bearer ${SVC}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/* =========================================================
   密碼原則（2026-08-24 Woody 指示）：至少 10 碼 + 禁用常見密碼。

   刻意不再要求「大寫 + 小寫 + 符號」。組成規則會把人逼向可預測的形狀——
   Password1!、Comart@2026 全都通過組成檢查，卻是攻擊者最先猜的那批。
   NIST SP 800-63B 的建議是改用「長度 + 黑名單」，這裡照做。

   三道檢查，由便宜到昂貴：
     1. 長度
     2. 本地樣式比對（常見密碼、鍵盤序列、重複字元、公司／帳號相關字）
     3. Have I Been Pwned 的 Pwned Passwords 範圍查詢

   第 3 道用 k-anonymity：只送出 SHA-1 的前 5 碼，比對在本地做，
   密碼本身與完整雜湊都不會離開這台機器。查不通時放行（只擋前兩道），
   因為讓管理者完全無法設定密碼，比放行一個網路暫時查不到的密碼更糟。
   ========================================================= */

/** 實際外洩清單裡最常出現的那批。HIBP 涵蓋得更全，這份是離線時的下限。 */
const COMMON_PASSWORDS = new Set([
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
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "(": "c",
};

/** 折成比對用的形式：小寫、還原字元替換、只留字母。 */
function fold(pw: string): string {
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
function foldCandidates(pw: string): string[] {
  const low = pw.toLowerCase();
  const trimmed = low.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
  return [
    fold(low),
    fold(trimmed),                            // 去頭尾符號："p@ssw0rd" → password
    fold(trimmed.replace(/\d+$/, "")),        // 再去尾端數字："password2026" → password
    fold(low.replace(/[^a-z]/g, "")),          // 只留字母，不做替換
  ].filter(Boolean);
}

/** 鍵盤序列或連續字元，例如 1234567890、qwertyuiop、aaaaaaaaaa */
function isSequential(pw: string): boolean {
  const low = pw.toLowerCase();
  if (/^(.)\1+$/.test(low)) return true;                 // 全部同一個字元
  const runs = ["abcdefghijklmnopqrstuvwxyz",
                "0123456789", "1234567890",   // 數值順序與鍵盤數字列是兩回事
                "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (const run of runs) {
    const rev = run.split("").reverse().join("");
    // 密碼整體就是某條序列的一段（含反向）才算，避免誤殺內含 abc 的長密碼
    if (run.includes(low) || rev.includes(low)) return true;
  }
  return false;
}

/**
 * 密碼原則檢查。回傳問題描述，或 null 表示通過。
 * email 用來擋「密碼裡就寫著自己的帳號」，可省略。
 */
async function passwordProblem(pw: unknown, email?: string): Promise<string | null> {
  if (typeof pw !== "string" || !pw) return "請輸入密碼";
  if (pw.length < 10) return "密碼至少 10 碼";

  for (const cand of foldCandidates(pw)) {
    if (COMMON_PASSWORDS.has(cand)) return "這是常見密碼，請換一個";
  }

  if (isSequential(pw)) return "不能使用連續字元或鍵盤序列";

  // 公司名與帳號名不該出現在密碼裡——那是攻擊者第一個會試的字典
  if (/comart/i.test(pw)) return "密碼不能包含公司名稱";
  const local = (email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) {
    return "密碼不能包含自己的帳號名稱";
  }

  const pwned = await pwnedCount(pw);
  if (pwned > 0) {
    return `這組密碼曾在外洩資料中出現 ${pwned.toLocaleString("en-US")} 次，請換一個`;
  }
  return null;
}

/**
 * 查 Have I Been Pwned 的 Pwned Passwords。回傳出現次數，0 表示沒查到。
 *
 * k-anonymity：只送 SHA-1 的前 5 碼，對方回傳該前綴下的所有後綴與次數，
 * 比對在本地做。密碼與完整雜湊都不會送出去。
 * 查詢失敗回 0（放行）——網路問題不該讓管理者無法設定密碼。
 */
async function pwnedCount(pw: string): Promise<number> {
  try {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw)),
    );
    const hash = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const prefix = hash.slice(0, 5), suffix = hash.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },   // 回應長度固定，連流量大小都不洩漏
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return 0;

    for (const line of (await res.text()).split("\n")) {
      const [suf, count] = line.trim().split(":");
      if (suf === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch (err) {
    console.error("[admin-users] Pwned Passwords 查詢失敗，僅套用本地檢查", err);
    return 0;
  }
}

/** 確認呼叫者是官網 admin。回傳呼叫者的 uid。 */
async function requireAdmin(req: Request): Promise<{ uid: string } | Response> {
  const origin = req.headers.get("origin");
  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "Authentication required" }, 401, origin);

  // 用呼叫者自己的 token 問 Supabase「你是誰」，不信任前端送來的任何 id
  const me = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: SVC, authorization: auth },
  });
  if (!me.ok) return json({ error: "Invalid session" }, 401, origin);
  const user = await me.json();
  if (!user?.id) return json({ error: "Invalid session" }, 401, origin);

  const row = await svc(`/rest/v1/web_editors?select=role&user_id=eq.${user.id}&limit=1`);
  const rows = row.ok ? await row.json() : [];
  if (!rows.length || rows[0].role !== "admin") {
    return json({ error: "Only a website admin can manage users" }, 403, origin);
  }
  return { uid: user.id };
}

/** 依 email 找出 auth 帳號 id，找不到回 null */
async function findAuthUser(email: string) {
  const au = await svc("/auth/v1/admin/users?per_page=200");
  if (!au.ok) return undefined;              // 查詢本身失敗，與「查無此人」要分開
  return ((await au.json()).users ?? [])
    .find((u: Record<string, string>) => (u.email ?? "").toLowerCase() === email) ?? null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!URL_ || !SVC) return json({ error: "Server not configured" }, 500, origin);

  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  let payload: { action?: string; email?: string; role?: string; user_id?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const action = payload.action ?? "";
  const email = (payload.email ?? "").trim().toLowerCase();
  const role = payload.role ?? "editor";

  if (role && !ROLES.includes(role)) {
    return json({ error: `role must be one of ${ROLES.join(", ")}` }, 422, origin);
  }

  /* ---------- list ---------- */
  if (action === "list") {
    const res = await svc("/rest/v1/web_editors?select=*&order=created_at.asc");
    if (!res.ok) return json({ error: "Could not read the editor list" }, 502, origin);
    const editors = await res.json();

    const au = await svc("/auth/v1/admin/users?per_page=200");
    const authUsers = au.ok ? ((await au.json()).users ?? []) : [];
    const byId = new Map(authUsers.map((u: Record<string, unknown>) => [u.id, u]));

    return json({
      editors: editors.map((e: Record<string, unknown>) => {
        const u = byId.get(e.user_id) as Record<string, unknown> | undefined;
        return {
          ...e,
          email: e.email ?? u?.email ?? null,
          last_sign_in_at: u?.last_sign_in_at ?? null,
          confirmed: !!(u?.email_confirmed_at),
        };
      }),
    }, 200, origin);
  }

  /* ---------- create ----------
     email 尚不存在 → 用管理者輸入的密碼建立帳號，並加入白名單
     email 已存在   → 只加入白名單，不動對方原有的密碼
     一個入口自己判斷，不需要管理者先知道帳號存不存在。 */
  if (action === "create") {
    if (!email) return json({ error: "請輸入 Email" }, 422, origin);

    const pwBad = await passwordProblem(payload.password, email);
    if (pwBad) return json({ error: "weak_password", message: pwBad }, 422, origin);

    let userId: string | null = null;
    let existed = false;

    const created = await svc("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password: payload.password, email_confirm: true }),
    });

    if (created.ok) {
      userId = (await created.json()).id;
    } else {
      const detail = await created.text();
      const dup = created.status === 422 || detail.includes("already been registered");
      if (!dup) {
        console.error("[admin-users] 建立帳號失敗", created.status, detail);
        return json({ error: "無法建立帳號" }, 502, origin);
      }
      // dup 但查不到人：可能落在 per_page=200 之外，也可能是查詢本身失敗。
      // 兩種都不該猜，直接讓管理者知道。
      const found = await findAuthUser(email);
      if (!found) return json({ error: "無法查詢既有帳號" }, 502, origin);
      userId = found.id;
      existed = true;
    }

    const add = await svc("/rest/v1/web_editors", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ user_id: userId, email, role }]),
    });
    if (!add.ok) {
      console.error("[admin-users] 白名單寫入失敗", add.status, await add.text());
      return json({ error: "帳號已就緒，但加入編輯名單失敗" }, 502, origin);
    }

    return json({ ok: true, email, role, existed }, 200, origin);
  }

  /* ---------- set_password：由管理者指定 ---------- */
  if (action === "set_password") {
    if (!payload.user_id) return json({ error: "user_id is required" }, 422, origin);

    // 查出這個帳號的 email，才能擋「密碼裡就寫著自己的帳號」
    const who = await svc(`/auth/v1/admin/users/${payload.user_id}`);
    const whoEmail = who.ok ? ((await who.json()).email ?? "") : "";

    const pwBad = await passwordProblem(payload.password, whoEmail);
    if (pwBad) return json({ error: "weak_password", message: pwBad }, 422, origin);

    const res = await svc(`/auth/v1/admin/users/${payload.user_id}`, {
      method: "PUT",
      body: JSON.stringify({ password: payload.password }),
    });
    if (!res.ok) {
      console.error("[admin-users] 密碼設定失敗", res.status, await res.text());
      return json({ error: "無法設定密碼" }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  }

  /* ---------- remove：刪除使用者 ----------
     一律先移出白名單（那是官網權限，立即生效）。

     再嘗試刪除 auth 帳號，但只在該帳號沒有 cpf_profiles 資料時才刪：
     auth.users 唯一被 cpf_profiles 以 on delete cascade 參照，而 cpf_profiles
     又被十幾個 CPF 表參照，硬刪會被資料庫的外鍵擋下（不會靜默毀資料，但會出錯）。
     有 CPF 資料的帳號就保留帳號本身，只收回官網權限，並在回應裡說明原因。 */
  if (action === "remove") {
    if (!payload.user_id) return json({ error: "user_id is required" }, 422, origin);
    if (payload.user_id === gate.uid) {
      return json({ error: "不能刪除自己的帳號" }, 422, origin);
    }

    // 至少要留一位 admin
    const admins = await svc("/rest/v1/web_editors?select=user_id&role=eq.admin");
    const list = admins.ok ? await admins.json() : [];
    if (list.length <= 1 && list.some((r: Record<string, string>) => r.user_id === payload.user_id)) {
      return json({ error: "不能刪除最後一位管理者" }, 422, origin);
    }

    const del = await svc(`/rest/v1/web_editors?user_id=eq.${payload.user_id}`, { method: "DELETE" });
    if (!del.ok) return json({ error: "無法移出編輯名單" }, 502, origin);

    // 有 CPF 資料就不刪帳號
    const prof = await svc(`/rest/v1/cpf_profiles?select=id&id=eq.${payload.user_id}&limit=1`);
    const hasProfile = prof.ok ? (await prof.json()).length > 0 : true;   // 查不到就當有，寧可不刪
    if (hasProfile) {
      return json({
        ok: true, account_deleted: false,
        note: "已收回官網權限。此帳號在 CPF 系統另有資料，帳號本身保留以免影響那邊。",
      }, 200, origin);
    }

    const rm = await svc(`/auth/v1/admin/users/${payload.user_id}`, { method: "DELETE" });
    if (!rm.ok) {
      console.error("[admin-users] 刪除帳號失敗", rm.status, await rm.text());
      return json({
        ok: true, account_deleted: false,
        note: "已收回官網權限，但帳號本身刪除失敗，仍保留在使用者名冊中。",
      }, 200, origin);
    }

    return json({ ok: true, account_deleted: true, note: "使用者已刪除。" }, 200, origin);
  }

  return json({ error: `Unknown action: ${action}` }, 400, origin);
});
