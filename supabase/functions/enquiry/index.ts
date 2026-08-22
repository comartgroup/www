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

const NOTIFY_TO = "sales@comart.com.tw";
const NOTIFY_FROM = "COMART Website <noreply@comart.com.tw>";

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
    console.error("[enquiry] 通知信寄送失敗", res.status, await res.text());
    return { sent: false, reason: `http_${res.status}` };
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

  // 通知信失敗不應該讓客戶看到錯誤——資料已經收到了
  const mail = await notify(clean).catch((e) => {
    console.error("[enquiry] 通知信例外", e);
    return { sent: false, reason: "exception" };
  });

  return json({ ok: true, notified: mail.sent }, 200, origin);
});
