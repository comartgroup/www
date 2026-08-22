/**
 * COMART 官網 — 自動翻譯
 *
 * 後台在任一語言欄位輸入內容後，呼叫本函式產生另外兩語，再由人工調整。
 * 對應規劃書 8.2「三語編輯與翻譯」。
 *
 * 為什麼用 Claude 而不是一般機器翻譯：
 *   官網文案有硬性規則——slogan 不能翻、法人名稱有固定寫法、
 *   不得生成規劃書禁止的 MOQ 與交期數字、技術術語三語對照要一致。
 *   這些是指令，不是詞彙替換，一般翻譯 API 的 glossary 做不到。
 *
 * 需要的 secrets：
 *   ANTHROPIC_API_KEY   （已於 2026-08-22 確認存在）
 *
 * 呼叫方式：
 *   POST { text: "...", from: "en", to: ["zh-TW", "vi"], context?: "頁面標題" }
 *   回傳 { "zh-TW": "...", "vi": "..." }
 *
 * 部署：
 *   supabase functions deploy translate --project-ref tcvlnpgpuphdalzvmoyo
 */

const MODEL = "claude-sonnet-5";
const MAX_INPUT_CHARS = 8000;

const LANG_NAME: Record<string, string> = {
  "en": "English",
  "zh-TW": "Traditional Chinese (Taiwan)",
  "vi": "Vietnamese",
};

const ALLOWED_ORIGINS = [
  "https://comartgroup.github.io",
  "https://www.comart.com.tw",
  "http://localhost:8899",
];

/**
 * 這段規則直接來自 COMART_官網重建規劃 與品牌記憶，改動前請先確認來源文件。
 */
const RULES = `
You are translating website copy for COMART CORPORATION, an ODM/OEM manufacturer
of consumer electronics and automotive accessories.

Hard rules — these override fluency:

1. NEVER translate the slogan "Innovative ODM reliable partner". Output it verbatim in every language.
2. Legal entity names are fixed. Use exactly:
   - COMART CORPORATION / 怡業股份有限公司
   - ETERNAL GAIN PLASTICS CO., LTD. / 東莞恒群塑膠有限公司
   - COMART VIETNAM CO., LTD. / 越南怡業責任有限公司
   Do not translate or re-render these names.
3. Never introduce numbers that are not in the source. In particular, never state a
   minimum order quantity, a lead time, a tooling T1 duration or a mould revision period.
   The approved phrasing is that these are evaluated per product, material, tooling
   complexity and order volume.
4. Keep technical terms consistent and in their industry-standard form:
   DFM, DFMA, T1 trial, two-shot, over-moulding, injection moulding, tooling,
   IQC / FAI / IPQC / FQC / OQC, ISO 9001, ISO 14001, amfori BSCI, Sedex / SMETA,
   Apple MFi. Do not localise acronyms.
5. Product model numbers, machine models and measurements stay exactly as written.
6. Register: business-to-business, factual, direct. No marketing superlatives that are
   absent from the source ("leading", "best", "world-class") — if the source does not
   claim it, the translation must not either.
7. Traditional Chinese must use Taiwan business vocabulary and Taiwan technical terms,
   not mainland usage. Vietnamese must use formal written business register.
8. Preserve the source structure: line breaks, list items and sentence count. Do not
   merge, split, expand or summarise.

Return ONLY a JSON object keyed by language code. No commentary, no markdown fence.
`.trim();

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

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** 確認呼叫者是 web_editors 白名單內的使用者。回傳 true 或錯誤字串。 */
async function requireEditor(auth: string): Promise<true | string> {
  const me = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: SUPA_SVC, authorization: auth },
  });
  if (!me.ok) return "Invalid session";
  const user = await me.json();
  if (!user?.id) return "Invalid session";

  const row = await fetch(
    `${SUPA_URL}/rest/v1/web_editors?select=user_id&user_id=eq.${user.id}&limit=1`,
    { headers: { apikey: SUPA_SVC, authorization: `Bearer ${SUPA_SVC}` } },
  );
  const rows = row.ok ? await row.json() : [];
  return rows.length ? true : "Not a website editor";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  // 只有官網編輯者可以呼叫。
  // ★ 光檢查 Authorization header 存在是不夠的：公開的 publishable key 本身
  //   就是一個合法 bearer，任何人都拿得到。必須真的向 Supabase 確認身分，
  //   否則這支函式等於一個公開的 LLM 端點，會被拿去燒 API 額度。
  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "Authentication required" }, 401, origin);

  const gate = await requireEditor(auth);
  if (gate !== true) return json({ error: gate }, gate === "Invalid session" ? 401 : 403, origin);

  let body: { text?: string; from?: string; to?: string[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const text = (body.text ?? "").trim();
  const from = body.from ?? "en";
  const to = (body.to ?? []).filter((l) => l in LANG_NAME && l !== from);

  if (!text) return json({ error: "text is required" }, 422, origin);
  if (text.length > MAX_INPUT_CHARS) {
    return json({ error: `text exceeds ${MAX_INPUT_CHARS} characters` }, 422, origin);
  }
  if (!to.length) return json({ error: "to must contain at least one target language" }, 422, origin);
  if (!(from in LANG_NAME)) return json({ error: `unsupported source language: ${from}` }, 422, origin);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("[translate] ANTHROPIC_API_KEY 未設定");
    return json({ error: "Translation service not configured" }, 500, origin);
  }

  const targets = to.map((l) => `"${l}" (${LANG_NAME[l]})`).join(", ");
  const prompt = [
    body.context ? `Field being translated: ${body.context}` : null,
    `Source language: ${LANG_NAME[from]}`,
    `Translate into: ${targets}`,
    "",
    "Source text:",
    text,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: RULES,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("[translate] Anthropic API 失敗", res.status, detail);
    return json({ error: "Translation failed", status: res.status }, 502, origin);
  }

  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? "";

  let parsed: Record<string, string>;
  try {
    // 保險：即使指示過不要 markdown fence，仍先剝一層
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    console.error("[translate] 回傳非 JSON", raw.slice(0, 300));
    return json({ error: "Translation returned an unexpected format" }, 502, origin);
  }

  const out: Record<string, string> = {};
  for (const l of to) if (typeof parsed[l] === "string") out[l] = parsed[l];

  if (!Object.keys(out).length) {
    return json({ error: "Translation returned no usable languages" }, 502, origin);
  }

  return json({
    translations: out,
    usage: data?.usage ?? null,   // 讓後台可以顯示用量，成本才看得見
  }, 200, origin);
});
