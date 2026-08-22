# Supabase Edge Functions

官網需要伺服器端邏輯的部分放這裡。前台與後台都不持有任何機密金鑰。

| Function | 用途 | 誰呼叫 |
|---|---|---|
| `enquiry` | Start Your Project 表單驗證、寫入 `web_enquiries`、通知業務 | 前台（匿名） |
| `translate` | 三語自動翻譯 | 後台（需登入） |

## 部署

```bash
supabase functions deploy enquiry   --project-ref tcvlnpgpuphdalzvmoyo
supabase functions deploy translate --project-ref tcvlnpgpuphdalzvmoyo
```

## Secrets

| 名稱 | 狀態 | 說明 |
|---|---|---|
| `SUPABASE_URL` | 自動注入 | 不需設定 |
| `SUPABASE_SERVICE_ROLE_KEY` | 自動注入 | 不需設定，只在 Edge Function 內使用 |
| `ANTHROPIC_API_KEY` | **已存在**（2026-08-22 確認） | 翻譯用。若既有 secret 名稱不同，改 `translate/index.ts` 的 `Deno.env.get()` 一行即可 |
| `RESEND_API_KEY` | 未設定 | 選用。沒有它時 `enquiry` 仍會寫入資料庫，只是不寄通知信 |

設定方式：

```bash
supabase secrets set RESEND_API_KEY=... --project-ref tcvlnpgpuphdalzvmoyo
```

或 Dashboard → Edge Functions → Secrets。

**金鑰只能放在這裡，不能出現在 repo、前台 JS 或 `webadmin/admin.js`。**
這個 repo 與 GitHub Pages 都是公開的。

## 詢價通知

- 收件人：`sales@comart.com.tw`
- 寄件顯示：`COMART Website <noreply@comart.com.tw>`
- 回覆對象自動設為客戶填寫的 email

寄信服務目前預設 Resend。要改用其他服務，只需改寫 `enquiry/index.ts` 的 `notify()`，
其餘流程不變。若暫時不寄信，資料仍會完整寫入 `web_enquiries`，可從後台查看。

## 翻譯規則

`translate/index.ts` 的 `RULES` 常數是翻譯的硬性規則，直接來自
`COMART_官網重建規劃.md` 與品牌記憶，包含：

- slogan `Innovative ODM reliable partner` 不翻譯
- 三地法人名稱固定寫法
- 不得生成規劃書禁止的 MOQ 與交期數字
- DFM、two-shot、T1、IQC/FQC/OQC 等術語不在地化
- 繁中用台灣商業與技術用語，越南文用正式書面語

**改動這段前先確認來源文件**，它不是提示詞調校，是內容合規要求。
