# COMART 官網

COMART CORPORATION 新官網。內容依據 `COMART_官網重建規劃.md` v2.3，
品牌色取自 COMART CIS（PANTONE 1805C）。

線上測試站：https://comartgroup.github.io/www/

## 結構

```
build.py                 靜態產生器（無需 npm / CI）
src/
  layout.html            頁面外殼
  partials/              頁首、頁尾（只維護一份）
  pages/                 各頁內容
  content/pages.en.json  頁面清冊：路徑、標題、SEO 描述
assets/                  CSS、JS、圖片、範例資料
webadmin/                官網後台（內容管理）
docs/DATA.md             資料架構與串接說明
docs/sql/web_schema.sql  Supabase 資料表與公開 view
index.html 等            build.py 產生的結果，直接由 GitHub Pages 服務
```

## 修改內容

改 `src/` 底下的檔案，然後重新產生：

```bash
python3 build.py
```

**不要直接改根目錄的 `index.html` 或 `services/index.html` 等檔案** ——
那些是產生結果，下次 build 會被覆蓋。

## 本機預覽

```bash
python3 -m http.server 8899
# http://localhost:8899/
```

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 英文版 14 頁 | 已完成 |
| 繁體中文、越南文 | 未開始（`build.py` 的 `LANGS` 已預留） |
| 產品清單 | 讀範例資料，未接報價系統 |
| 後台 `webadmin/` | 離線示範模式，資料存 localStorage |
| 詢價表單 | 未接後端 |
| Equipment 詳細設備 | 待由 `Comart Corp. introduction 20251020` 匯入 |
| Company News | 版位示意，待真實內容 |

詳細串接步驟見 [docs/DATA.md](docs/DATA.md)。
