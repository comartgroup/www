# 資料架構與串接

官網有兩個資料來源，職責不同，不可混為一談。

| 資料 | 來源 | 誰維護 |
|---|---|---|
| 產品 | 報價系統的 `products` 資料表 | 報價系統既有流程 |
| 頁面文案、公司動態、詢價案件 | 官網自己的 `web_*` 資料表 | 官網後台 `www/webadmin` |

兩者都在同一個 Supabase 專案：`tcvlnpgpuphdalzvmoyo`。

---

## 一、產品資料

### 為什麼不直接讀 `products`

`products` 是報價系統的主檔，欄位裡包含**不能對外公開**的商業資料：

```
supplier1  supplier2      供應商名稱
cost1      cost2          進價
curr1      curr2          進價幣別
costRef                   成本參考
defaultPrice              內部定價
bom        bomFiles       BOM 與 BOM 檔案
```

官網是**公開網站**，前端用的 key 任何人都能從瀏覽器看到。如果官網直連 `products`，
這些欄位就等於對外開放。另外，`products` 在 migration 裡**沒有啟用 RLS**
（只有較新的 `cpf_products` 有），風險更高。

### 做法：只讀公開 view

`docs/sql/web_schema.sql` 建立兩個物件：

- **`web_product_settings`** — 上架旗標、官網分類（平台型／快速客製）、排序、網站專用文案。
  獨立一張表，不動報價系統的 schema。
- **`web_products_public`** — view，只選取可公開欄位，並且只回傳 `published = true`
  且狀態不是 EOL 的產品。`anon` 只對這個 view 有 `select` 權限。

前台 `assets/js/products.js` 只讀這個 view。

### 多語言

`products.name` 與 `products.features` 是 JSONB，鍵值為：

```
en  /  zh-TW  /  zh-CN  /  vi  /  ja
```

官網首波需要的 `en`、`zh-TW`、`vi` 三語它已經具備，不需要另建翻譯表。
`zh-CN` 與 `ja` 目前官網不使用。

---

## 二、官網自有資料

| 資料表 | 用途 | 匿名權限 |
|---|---|---|
| `web_pages` | 各頁標題與導言，三語 JSONB | 只能讀 `status = 'live'` |
| `web_news` | 公司動態 | 只能讀 `status = 'live'` |
| `web_enquiries` | Start Your Project 詢價案件 | **只能新增，不能讀取** |
| `web_product_settings` | 產品上架設定 | 無權限 |

詢價表單含客戶個資，匿名角色只有 `insert`、沒有 `select`。實際寫入建議走
Edge Function，才能做驗證、防濫用與 Email 通知。

---

## 三、目前狀態

| 項目 | 狀態 |
|---|---|
| 前台 14 頁（英文） | 已完成並上線 |
| 繁體中文、越南文 | 未開始 |
| `web_*` 資料表與 view | **SQL 已寫好，尚未在 Supabase 執行** |
| 前台產品清單 | 讀 `assets/data/products.sample.json` 範例資料 |
| 後台 `www/webadmin` | 離線示範模式，資料存在瀏覽器 localStorage |
| 後台登入 | 未接 Supabase Auth，任何帳密都能進入 |
| 詢價表單送出 | 未接後端，送出鍵不會傳送資料 |
| 自動翻譯 | 未建置 |

---

## 四、切換到正式資料庫的步驟

1. 在 Supabase SQL Editor 執行 `docs/sql/web_schema.sql`
2. 建立後台使用者，並決定角色（管理者／內容編輯／產品編輯／發布者）
3. 前台：`assets/js/products.js` 的 `SOURCE` 改成 `'supabase'`，填入 `SUPABASE.url` 與 `anonKey`
4. 後台：`webadmin/admin.js` 的 `MODE` 改成 `'supabase'`，填入 `CONFIG`
5. 建立 Edge Function 處理詢價表單寫入、Email 通知與自動翻譯

**絕對不要**把 `service_role` key 放進這個 repo 的任何檔案。
repo 與 GitHub Pages 都是公開的，只能使用受 RLS 保護的 publishable（anon）key。

---

## 五、後台的可及性

`www/webadmin` 部署在公開的 GitHub Pages 上，任何人都能開啟該網址。
這是靜態前端的必然結果——真正的保護在 Supabase 的 Auth 與 RLS，不在於網址是否隱密。

接上正式資料庫時必須確認：

- 所有 `web_*` 資料表都啟用 RLS，且匿名角色沒有多餘權限
- 後台帳號使用強密碼，並考慮開啟 MFA
- `web_enquiries` 的客戶個資只有登入者可讀

---

## 六、已確認的營運決定（2026-08-22）

| 項目 | 決定 |
|---|---|
| 詢價通知收件人 | `sales@comart.com.tw` |
| 自動翻譯服務 | Claude API（Sonnet），不使用 DeepL |
| 翻譯成本上限 | Anthropic Console 的 workspace spend limit，建議 US$20/月 |
| 翻譯 key 放置位置 | **只能在 Supabase Edge Function**，絕不進前端 |
| 設備資料來源 | `Catalog/Comart Corp. introduction 20251020`，資料版本 2025-10-20 |
| 設備排除範圍 | 第 30 頁 CNC 金屬加工設備清單 |

### 為什麼選 Claude 而不是 DeepL

全站文案約 3–6 萬字元，翻兩語的一次性成本兩邊都在個位數美金，成本不是決勝點。
差別在於 Claude 能遵守規則而 DeepL 的 glossary 只能做名詞替換：

- `Innovative ODM reliable partner` 原樣輸出，不翻譯
- 法人名稱固定用既定寫法（COMART CORPORATION／怡業股份有限公司／東莞恒群塑膠有限公司／COMART VIETNAM CO., LTD.）
- 不得生成規劃書禁止的數字（固定 MOQ、交期、模具天數）
- DFM、two-shot、over-moulding、T1 等術語三語對照固定
- 越南文採商業文書語氣

### GitHub Pages 的 Jekyll exclude 是承重結構

`_config.yml` 的 `exclude:` 是 `src/`、`docs/`、`build.py` 不被公開服務的**唯一原因**。
移除它、或搬到不跑 Jekyll 的平台（Cloudflare Pages、Netlify、Vercel 純靜態模式），
整個 repo 會被端上網路，而且是**靜默失效**——沒有錯誤訊息。

此結論來自 VIEMAG 專案 `planning/網域與雲端架構操作手冊.md`（2026-07-31）。
2026-08-22 實測確認 COMART 站曾有相同外洩，已修補。
