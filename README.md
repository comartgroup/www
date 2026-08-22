# COMART 官網 — 首頁設計稿

COMART CORPORATION 新官網的**首頁**單頁設計稿（英文版）。
內容依據 `COMART_官網重建規劃.md` v2.2，品牌色取自 COMART CIS（PANTONE 1805C）。

## 檔案結構

```
index.html              首頁全部內容
assets/css/site.css     設計系統：品牌色、字級、版型、RWD
assets/js/site.js       固定選單、手機選單、進場動畫
assets/img/             實拍照片、Logo、favicon
```

## 本機預覽

```bash
python3 -m http.server 8899
# 瀏覽器開 http://localhost:8899/
```

資源全為相對路徑，直接用瀏覽器開 `index.html` 也可以（字體需連 Google Fonts）。

## 目前狀態

- 只有首頁，且只有英文版；繁體中文與越南文版本尚未製作
- Company News 為版位示意，尚未填入真實內容
- 未接資料庫、未接表單、未部署
- 語言切換鈕為視覺示意，尚未連結

## 尚未採用的舊站資料

依規劃書 15.7，網站不刊登固定 MOQ 與交期，因此舊站的「MOQ 1,000 pcs」「35 天交期」「模具 30 天」未沿用，統一表述為依產品、材料、模具複雜度及訂單數量評估。
