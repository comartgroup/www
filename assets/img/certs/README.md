# 認證與法規 Logo

前台 `/quality-compliance/` 讀這個目錄。檔名必須完全一致，格式 **SVG**（PNG 亦可，
但要改 `src/pages/quality-compliance.html` 的副檔名）。

檔案不存在時版位會顯示虛線的「LOGO」佔位框，不會破圖，也不會假裝有 logo。

| 檔名 | 對應 | 取得方式 |
|---|---|---|
| `iso-9001.svg`  | ISO 9001:2015  | **用發證機構的標章**（SGS／TÜV／BSI 等），不是 ISO 官方 logo |
| `iso-14001.svg` | ISO 14001:2015 | 同上 |
| `bsci.svg`      | amfori BSCI    | amfori 會員專區提供會員標章與使用規範 |
| `sedex.svg`     | Sedex / SMETA  | Sedex 會員專區 |
| `mfi.svg`       | Apple MFi      | **需確認授權範圍**，見下方說明 |
| `walmart.svg`   | Walmart SCS / FCCA | **不建議使用**，見下方說明 |
| `costco.svg`    | Costco GMP / FQA   | **不建議使用**，見下方說明 |
| `rohs.svg`      | RoHS           | 無官方標章，市面上流通的多為自製圖示 |

REACH 版位已先移除：適用範圍尚未確認，確認後告知即可加回。

## 三個需要先確認的

**ISO 標章** — ISO 本身禁止受證組織使用 ISO 的 logo。正確做法是使用**發證機構**的
認證標章（例如 SGS 的標章加上證書號），那才是你有權使用的。向發證機構索取即可。

**Apple MFi** — Apple 對 MFi 標章的使用有嚴格規範，通常限於已授權產品的包裝與
指定行銷素材，用在企業官網需要確認是否在授權範圍內。建議先問你們的 MFi 窗口。

**Walmart 與 Costco** — 這兩個是**客戶的商標**，不是頒給你的認證標章。
規劃書 13.2 明確寫「不公開客戶名稱、Logo」。放上去同時違反自家規劃原則與
商標使用慣例。建議維持現在的文字呈現（已通過其稽核資格），不放 logo。

## 放進去之後

檔案放好後不需要改任何程式，重新整理就會出現。若要改成 PNG，
改 `src/pages/quality-compliance.html` 裡的副檔名再跑 `python3 build.py`。
