/**
 * COMART 官網 — 後台使用者管理
 *
 * 建立帳號與設定密碼需要 service_role 權限，那把 key 絕對不能出現在前端，
 * 所以這些動作一律經過本函式。呼叫者必須是 web_editors 裡 role='admin' 的帳號。
 *
 * ★ 本 Supabase 專案的 auth.users 由報價系統、CRM、KMS、CPF、內部 Portal 與官網共用。
 *   官網「不另外建立獨立帳號」（2026-08-23 Woody 決定）：同事用他原本的公司帳號登入後台。
 *   因此要理解清楚兩件事是分開的：
 *
 *     授權——由 web_editors 白名單控制。沒列在名單裡的人，就算密碼正確也寫不了
 *            任何官網資料（RLS 的 is_web_editor()），連後台首頁都進不去（前端閘門）。
 *     憑證——與其他系統共用。同一組密碼一旦外洩，官網後台與那些系統會一起受影響。
 *            這是選擇共用帳號時接受的代價，不是疏漏。
 *
 * ★ 「移除使用者」只會把人從 web_editors 白名單移出（收回官網權限），
 *   不會刪除 auth.users —— 那個帳號的 UUID 可能被其他系統參照，
 *   刪掉會在別處造成孤兒資料，而且不會有任何錯誤訊息。
 *
 * 密碼原則（2026-08-23 Woody 指示）：至少 10 碼，須含大寫、小寫與符號。
 *   本函式產生的密碼一定符合；管理者自行指定密碼時也會用同一套規則檢查。
 *   ★ 但 grant（沿用其他系統的既有帳號）不會碰對方的密碼，
 *     那組密碼是當初建立它的系統設的，本原則管不到。
 *
 * 動作：
 *   list            列出官網編輯者（含 auth 端的最後登入時間）
 *   create          建立新帳號並加入白名單，回傳一次性密碼
 *   grant           把既有帳號加入白名單（帳號已存在於其他系統時用這個，不改密碼）
 *   set_password    重設某人的密碼，回傳一次性密碼
 *   revoke          從白名單移除（不刪除 auth 帳號）
 *
 * 部署：
 *   supabase functions deploy admin-users --project-ref tcvlnpgpuphdalzvmoyo
 */

const ROLES = ["admin", "editor", "product", "publisher"];

/* ---------- 密碼：至少 10 碼，須含大寫、小寫與符號 ---------- */

const PW_LEN = 10;
// 排除看起來一樣的字元（I O l 0 1），因為這些密碼會被口頭轉達或手動重打
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
// 避開引號、反斜線、空白，以及在 URL 或 shell 裡會出事的 $ 與 &
const SYMBOL = "!#%+=?@-_";

/** 均勻取 [0, max)，用拒絕取樣避免取模偏差。 */
function randInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
}

function pick(set: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(set[randInt(set.length)]);
  return out;
}

/** 產生符合原則的一次性密碼：每一類至少兩個，其餘由全體字元池補滿。 */
function tempPassword(): string {
  const chars = [
    ...pick(UPPER, 2),
    ...pick(LOWER, 3),
    ...pick(DIGIT, 2),
    ...pick(SYMBOL, 2),
  ];
  const pool = UPPER + LOWER + DIGIT + SYMBOL;
  while (chars.length < PW_LEN) chars.push(...pick(pool, 1));

  // Fisher–Yates，避免各類字元的位置固定
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** 檢查管理者自行指定的密碼。合格回傳 null，否則回傳給人看的原因。 */
function passwordProblem(pw: string): string | null {
  if (pw.length < PW_LEN) return `密碼至少要 ${PW_LEN} 個字元`;
  if (!/[A-Z]/.test(pw)) return "密碼必須包含大寫英文字母";
  if (!/[a-z]/.test(pw)) return "密碼必須包含小寫英文字母";
  if (!/[^A-Za-z0-9]/.test(pw)) return "密碼必須包含符號";
  return null;
}

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

  const row = await svc(
    `/rest/v1/web_editors?select=role&user_id=eq.${user.id}&limit=1`,
  );
  const rows = row.ok ? await row.json() : [];
  if (!rows.length || rows[0].role !== "admin") {
    return json({ error: "Only a website admin can manage users" }, 403, origin);
  }
  return { uid: user.id };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!URL_ || !SVC) return json({ error: "Server not configured" }, 500, origin);

  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  let payload: {
    action?: string; email?: string; role?: string; user_id?: string; password?: string;
  };
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

    // 補上 auth 端的登入資訊，讓管理者看得出帳號是否真的在用
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

  /* ---------- create：新帳號 + 加入白名單 ---------- */
  if (action === "create") {
    if (!email) return json({ error: "email is required" }, 422, origin);

    // 管理者可以自帶密碼；沒帶就產生一組符合原則的
    let password: string;
    if (payload.password) {
      const pwBad = passwordProblem(payload.password);
      if (pwBad) return json({ error: "weak_password", message: pwBad }, 422, origin);
      password = payload.password;
    } else {
      password = tempPassword();
    }

    const created = await svc("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    });

    if (!created.ok) {
      const detail = await created.text();
      // 帳號已存在是常見情形——本專案的使用者名冊多系統共用，請對方改用 grant
      if (created.status === 422 || detail.includes("already been registered")) {
        return json({
          error: "already_exists",
          message: `${email} 已經有帳號了。本專案的使用者名冊由官網、報價系統、CRM、KMS、` +
                   "CPF 與內部 Portal 共用，這個 email 可能是其中任一系統建立的。" +
                   "請改按「加入既有帳號」——那只會把他加進官網編輯名單，" +
                   "不會變更他原有的密碼。",
        }, 409, origin);
      }
      console.error("[admin-users] 建立帳號失敗", created.status, detail);
      return json({ error: "Could not create the account" }, 502, origin);
    }

    const user = await created.json();
    const add = await svc("/rest/v1/web_editors", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ user_id: user.id, email, role }]),
    });
    if (!add.ok) {
      console.error("[admin-users] 白名單寫入失敗", add.status, await add.text());
      return json({ error: "Account created but could not be added to the editor list" }, 502, origin);
    }

    return json({ ok: true, email, role, temp_password: password }, 200, origin);
  }

  /* ---------- grant：既有帳號加入白名單 ---------- */
  if (action === "grant") {
    if (!email) return json({ error: "email is required" }, 422, origin);

    const au = await svc(`/auth/v1/admin/users?per_page=200`);
    if (!au.ok) return json({ error: "Could not look up accounts" }, 502, origin);
    const found = ((await au.json()).users ?? [])
      .find((u: Record<string, string>) => (u.email ?? "").toLowerCase() === email);

    if (!found) {
      return json({
        error: "not_found",
        message: `本專案的使用者名冊裡沒有 ${email}。請改按「建立新帳號」。`,
      }, 404, origin);
    }

    const add = await svc("/rest/v1/web_editors", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ user_id: found.id, email, role }]),
    });
    if (!add.ok) return json({ error: "Could not add to the editor list" }, 502, origin);

    return json({ ok: true, email, role, temp_password: null }, 200, origin);
  }

  /* ---------- set_password ---------- */
  if (action === "set_password") {
    if (!payload.user_id) return json({ error: "user_id is required" }, 422, origin);

    let password: string;
    if (payload.password) {
      const pwBad = passwordProblem(payload.password);
      if (pwBad) return json({ error: "weak_password", message: pwBad }, 422, origin);
      password = payload.password;
    } else {
      password = tempPassword();
    }

    const res = await svc(`/auth/v1/admin/users/${payload.user_id}`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      console.error("[admin-users] 密碼設定失敗", res.status, await res.text());
      return json({ error: "Could not set the password" }, 502, origin);
    }
    return json({ ok: true, temp_password: password }, 200, origin);
  }

  /* ---------- revoke：只移出白名單，不刪 auth 帳號 ---------- */
  if (action === "revoke") {
    if (!payload.user_id) return json({ error: "user_id is required" }, 422, origin);
    if (payload.user_id === gate.uid) {
      return json({ error: "You cannot remove your own access" }, 422, origin);
    }

    // 至少要留一位 admin
    const admins = await svc("/rest/v1/web_editors?select=user_id&role=eq.admin");
    const list = admins.ok ? await admins.json() : [];
    if (list.length <= 1 && list.some((r: Record<string, string>) => r.user_id === payload.user_id)) {
      return json({ error: "Cannot remove the last remaining admin" }, 422, origin);
    }

    const res = await svc(`/rest/v1/web_editors?user_id=eq.${payload.user_id}`, { method: "DELETE" });
    if (!res.ok) return json({ error: "Could not revoke access" }, 502, origin);

    return json({ ok: true, note: "已收回官網權限。auth 帳號保留，其他系統不受影響。" }, 200, origin);
  }

  return json({ error: `Unknown action: ${action}` }, 400, origin);
});
