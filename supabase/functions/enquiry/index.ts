/**
 * COMART 官網 — Start Your Project 詢價表單
 *
 * 前台把表單 POST 到這裡，由本函式驗證後寫入 web_enquiries，並通知業務。
 *
 * 為什麼不讓前台直接寫資料表：
 *   1. 匿名寫入需要驗證與防濫用，前端做的檢查可以被繞過
 *   2. 通知信需要寄信服務的金鑰，那不能出現在前端
 *   3. web_enquiries 含客戶個資，匿名角色只有 insert、沒有 select
 *
 * 需要的 secrets（Supabase Dashboard → Edge Functions → Secrets）：
 *   SUPABASE_URL              自動注入
 *   SUPABASE_SERVICE_ROLE_KEY 自動注入
 *   RESEND_API_KEY            選用。沒有設定時仍會寫入資料庫，只是不寄通知信
 *
 * 部署：
 *   supabase functions deploy enquiry --project-ref tcvlnpgpuphdalzvmoyo
 */

/**
 * 通知信的收發位址。兩者都可由 secret 覆寫，因為它們跟 Resend 的網域驗證狀態綁在一起。
 *
 * 目前採「零 DNS」模式（2026-08-22 Woody 決定）：
 *   Resend 未驗證網域時只能從 onboarding@resend.dev 寄出，且只能寄到
 *   註冊該 Resend 帳號的那個信箱，因此收件人設為 woody@comart.com.tw。
 *   這封信是內部通知，客戶看不到寄件人，reply_to 已指向客戶本人，
 *   所以醜一點的寄件位址沒有影響。
 *
 * ★ secret 名稱刻意加 WEB_ 前綴。本 Supabase 專案由多個系統共用，
 *   專案裡已經存在通用名稱的 NOTIFY_FROM 與 NOTIFY_TO（屬於其他系統），
 *   若直接讀那兩個名字會拿到別人的設定值。
 *
 * 之後若要改成正式的 noreply@send.comart.com.tw 寄給 sales@comart.com.tw：
 *   1. 在 Resend 驗證子網域 send.comart.com.tw（不要動主網域的 SPF，
 *      那是 -all 且 M365 正在用，改錯全公司信箱會壞）
 *   2. supabase secrets set NOTIFY_FROM="COMART Website <noreply@send.comart.com.tw>" \
 *                           NOTIFY_TO="sales@comart.com.tw"
 *   程式不需要改。
 */
const NOTIFY_TO   = Deno.env.get("WEB_NOTIFY_TO")   ?? "woody@comart.com.tw";
const NOTIFY_FROM = Deno.env.get("WEB_NOTIFY_FROM") ?? "COMART Website <onboarding@resend.dev>";

const ALLOWED_ORIGINS = [
  "https://comartgroup.github.io",
  "https://www.comart.com.tw",
  "http://localhost:8899",
];

const REQUIRED = ["company", "contact", "email", "country", "summary"] as const;

const MAX_LEN: Record<string, number> = {
  company: 200, contact: 120, email: 200, country: 120,
  product_type: 120, stage: 120, services: 160,
  volume: 120, market: 200, launch: 120, summary: 5000, nda: 80,
};

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

/** 只做結構性檢查；內容正確性由業務判斷，不在這裡猜。 */
function validate(input: Record<string, unknown>) {
  const errors: string[] = [];
  const clean: Record<string, string> = {};

  for (const [key, max] of Object.entries(MAX_LEN)) {
    const raw = input[key];
    if (raw == null) continue;
    if (typeof raw !== "string") { errors.push(`${key} must be a string`); continue; }
    const v = raw.trim();
    if (v.length > max) { errors.push(`${key} exceeds ${max} characters`); continue; }
    if (v) clean[key] = v;
  }

  for (const key of REQUIRED) {
    if (!clean[key]) errors.push(`${key} is required`);
  }

  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email)) {
    errors.push("email is not a valid address");
  }

  // 極簡機器人過濾：正常客戶不會在摘要裡塞連結農場
  const linkCount = (clean.summary ?? "").match(/https?:\/\//g)?.length ?? 0;
  if (linkCount > 3) errors.push("summary contains too many links");

  return { errors, clean };
}

async function notify(row: Record<string, string>) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.log("[enquiry] RESEND_API_KEY 未設定，略過通知信，資料已寫入");
    return { sent: false, reason: "no_key" };
  }
  console.log("[enquiry] 通知信 " + NOTIFY_FROM + " → " + NOTIFY_TO);

  const lines = [
    ["Company", row.company],
    ["Contact", row.contact],
    ["Email", row.email],
    ["Country", row.country],
    ["Product type", row.product_type],
    ["Stage", row.stage],
    ["Services", row.services],
    ["Volume", row.volume],
    ["Target market", row.market],
    ["Planned launch", row.launch],
    ["NDA", row.nda],
  ].filter(([, v]) => v)
   .map(([k, v]) => `${k}: ${v}`)
   .join("\n");

  const text = `New enquiry from the COMART website\n\n${lines}\n\nProject summary:\n${row.summary}\n`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      reply_to: row.email,
      subject: `[Website enquiry] ${row.company} — ${row.country}`,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("[enquiry] 通知信寄送失敗", res.status, detail);
    // 資料已經寫入，寄信失敗不影響客戶那端；把原因留在 log 供排查
    return { sent: false, reason: `http_${res.status}`, detail: detail.slice(0, 300) };
  }
  return { sent: true };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const { errors, clean } = validate(input);
  if (errors.length) return json({ error: "Validation failed", details: errors }, 422, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("[enquiry] 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "Server not configured" }, 500, origin);
  }

  const insert = await fetch(`${url}/rest/v1/web_enquiries`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({ ...clean, source_lang: (input.source_lang as string) ?? "en" }),
  });

  if (!insert.ok) {
    console.error("[enquiry] 寫入失敗", insert.status, await insert.text());
    return json({ error: "Could not save the enquiry" }, 502, origin);
  }

  const saved = await insert.json().catch(() => null);
  const savedId = Array.isArray(saved) ? saved[0]?.id : saved?.id;

  // 通知信失敗不應該讓客戶看到錯誤——資料已經收到了
  const mail = await notify(clean).catch((e) => {
    console.error("[enquiry] 通知信例外", e);
    return { sent: false, reason: "exception", detail: String(e).slice(0, 200) };
  });

  // 把通知結果回填到案件上。Edge Function 的 log 在 CLI 讀不到，
  // 寄信失敗時若不留痕跡，之後完全查不出是哪個環節壞掉。
  if (savedId) {
    const note = mail.sent
      ? `notify: sent to ${NOTIFY_TO}`
      : `notify failed (${(mail as Record<string, string>).reason}): ` +
        `${(mail as Record<string, string>).detail ?? ""}`.slice(0, 400);
    await fetch(`${url}/rest/v1/web_enquiries?id=eq.${savedId}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ note }),
    }).catch(() => { /* 回填失敗不影響主流程 */ });
  }

  // reason 只是粗略代碼（例如 http_403），不含金鑰或客戶資料
  return json({ ok: true, notified: mail.sent,
                reason: mail.sent ? undefined : (mail as Record<string, string>).reason },
              200, origin);
});
