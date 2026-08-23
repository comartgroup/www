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
| `web_*` 資料表與 view | 已執行並驗證（`web_schema.sql`） |
| `web_products_admin` view | **`web_schema_02_admin.sql` 尚未執行** |
| 編輯者白名單 | **`web_schema_03_editors.sql` 尚未執行** |
| 前台產品清單 | 已接 `web_products_public`；目前 0 筆，因為尚未有產品上架 |
| 後台 `www/webadmin` | 已接 Supabase Auth 與資料表，無本機備份 |
| 後台登入 | Supabase Auth 密碼登入，**尚未建立任何使用者帳號** |
| 詢價表單送出 | 已部署並實測通過（瀏覽器端到端） |
| 自動翻譯 | 已部署，需登入且在 web_editors 名單內才能呼叫 |
| 使用者管理 | 已部署 |
| 後台「頁面內容」 | **尚未與前台同步**——編輯只存進 `web_pages`，不改變線上網站 |
| 詢價通知信 | 待設 `RESEND_API_KEY`；資料無論如何都會寫入 |

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

### 本專案為多系統共用

這個 Supabase 專案同時承載報價系統、KMS、CPF 與官網。
`web_schema.sql` 原本的政策寫成 `to authenticated using (true)`，
代表任何登入本專案的帳號（包含 KMS 與 CPF 使用者）都能編輯官網內容。

`web_schema_03_editors.sql` 建立 `web_editors` 白名單並收緊政策，
未列名者不得寫入任何 `web_*` 資料表，也不能讀取詢價案件的客戶個資。

執行順序：`web_schema.sql` → `web_schema_02_admin.sql` → `web_schema_03_editors.sql`

### 使用者管理

後台「使用者」分頁管理 `web_editors` 白名單。四種權限：
`admin`（含使用者管理）、`editor`（頁面與動態）、`product`（只管上架）、`publisher`（切換上線狀態）。

建立帳號與設定密碼需要 service_role，因此經 `admin-users` Edge Function 處理，
函式內會先確認呼叫者是 `web_editors` 裡的 admin。

**「收回權限」只把人移出白名單，不會刪除 auth 帳號。**
本專案為多系統共用，該 UUID 可能被 KMS 或 CPF 參照，刪除會造成孤兒資料。

專案沒有設定寄信服務，所以新增使用者與重設密碼都不寄信，
而是在畫面上顯示一次臨時密碼，由管理者自行轉達。

接上正式資料庫時必須確認：

- 所有 `web_*` 資料表都啟用 RLS，且匿名角色沒有多餘權限
- 後台帳號使用強密碼，並考慮開啟 MFA
- `web_enquiries` 的客戶個資只有登入者可讀

---

## 六、已確認的營運決定（2026-08-22）

| 項目 | 決定 |
|---|---|
| 詢價通知收件人 | `woody@comart.com.tw`（零 DNS 模式；改用驗證網域後可切回 `sales@comart.com.tw`） |
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

---

## 七、詢價通知信

### 目前模式：零 DNS

`comart.com.tw` 的 SPF 是 `v=spf1 include:spf.protection.outlook.com -all`（硬性拒絕，
只允許 Microsoft 365），DMARC 是 `p=quarantine`。從主網域寄出會 SPF 失敗並被隔離。

**不要為了寄通知信去改主網域的 SPF**——那是公司 M365 正式信箱在用的，
SPF 只能有一筆，改錯會讓全公司收不到或寄不出信。

因此採零 DNS 模式：

| 項目 | 值 |
|---|---|
| 寄件 | `COMART Website <onboarding@resend.dev>`（Resend 的網域） |
| 收件 | `woody@comart.com.tw`（必須是註冊 Resend 帳號的信箱） |
| 回覆對象 | 自動設為客戶填寫的 email |

這封信是內部通知，客戶看不到寄件人，所以寄件位址不需要好看。

只需要設一個 secret：

```bash
supabase secrets set RESEND_API_KEY=... --project-ref tcvlnpgpuphdalzvmoyo
```

### 之後要升級成正式寄件位址

1. 在 Resend 驗證**子網域** `send.comart.com.tw`（三筆 DNS 記錄，全部新增，不覆蓋現有）
2. 設兩個 secret，程式不需要改：

```bash
supabase secrets set NOTIFY_FROM="COMART Website <noreply@send.comart.com.tw>" \
                     NOTIFY_TO="sales@comart.com.tw" \
                     --project-ref tcvlnpgpuphdalzvmoyo
```

主網域的 SPF 與 DMARC 全程不需要更動。
`_dmarc.comart.com.tw` 沒有 `sp=`，所以 `p=quarantine` 會涵蓋子網域，
而子網域自己的 SPF 與 DKIM 會讓 DMARC 通過。

### 寄信失敗不影響收件

`enquiry` 函式先寫入 `web_enquiries` 才寄信。寄信失敗只會記在 log，
客戶端一律看到成功訊息——因為資料確實收到了。所有詢價都可從後台「詢價紀錄」查閱。

---

## 八、已知缺口：頁面文案尚未與前台同步

### 現況

前台各頁的文字是 `build.py` 產生時寫死在 HTML 裡的，來源是 repo 的 `src/pages/`：

```
src/pages/*.html  →  build.py  →  靜態頁面  →  commit  →  GitHub Pages
```

前台會即時讀資料庫的只有兩處：

| 前端 | 資料來源 | 是否即時 |
|---|---|---|
| `assets/js/news.js` | `web_news` | 是，後台發布即生效 |
| `assets/js/products.js` | `web_products_public` | 是，後台勾選即生效 |
| 各頁標題與導言 | `src/pages/`（靜態） | **否** |

`web_pages` 目前沒有任何前端讀取。後台「頁面內容」可以編輯與儲存，但線上不會改變。

### 為什麼這樣分

「條目型」內容（動態、產品）會持續新增、需要即時上線，做成前端即時讀取。
「編輯型」內容（頁面文案）改動少、對 SEO 敏感、需要審核，適合建置時注入。
兩者的處理方式本來就不同，只是後者的前台端尚未完成。

### 決定（2026-08-22 Woody）

文案改動頻率不高，暫由開發端維護。**後台模組保留**，用意是先把資料結構與
三語欄位定下來，介面上已明確標註未同步（側邊欄徽章、清單頂部、編輯面板內）。

### 下一階段要做的

1. `build.py` 產生時從 `web_pages` 取值注入
2. GitHub Actions workflow：跑 build.py、自動 commit、觸發 Pages 重建
3. 後台加「發布」按鈕，經 Edge Function 觸發該 workflow
   （需要一組僅能觸發 workflow 的 GitHub token，存 Edge Function secret，不進 repo）

---

## 九、2026-08-23 事實更新（來源：Final COMART INTRODUCTION 2026.08.21 ENGLISH PPT）

| 項目 | 決定 | 說明 |
|---|---|---|
| 越南廠省名 | **Bac Giang → Bac Ninh** | 北江省已併入北寧省（Woody 確認）。工業區與縣名不變。**郵遞區號 26171 尚未經確認**，暫留原值 |
| 資本額 | **刊登 USD 15,625,000** | 三語 Company 頁的公司資訊列 |
| 員工數 | **維持 Over 200** | 不改為 250+；此數字會變動，維持保守表述 |
| 型錄 QR code | **不做** | 規劃書 8.7 原有此要求，Woody 決定官網只提供直接下載 |
| 注塑機台數 | **待確認** | 新檔設備清單仍為 34 台（與 20251020 完全相同），但敘述頁寫 21 台 + 9 台大型 = 30 台，無法對應。網站目前維持 34 台 |
| 318+ 自有模具 | **待決定** | 新檔 slide 25 的新數字，規劃書未收錄 |

新檔另已移除金屬加工相關頁面，與規劃書 15.4／15.6 的排除決定一致。
設備清單三頁（射出／組裝／實驗室）比對後內容完全相同，僅 PPT 文字分段方式不同。
