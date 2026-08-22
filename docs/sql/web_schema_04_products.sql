-- =========================================================
-- COMART 官網 — 產品 view 調整（第四份，接在 web_schema_03_editors.sql 之後執行）
--
-- 兩項變更（2026-08-22 Woody）：
--   1. 前台只顯示 status = 'Normal' 的產品
--      原本寫成「不是 EOL 就顯示」，會把 NPI 等其他狀態也放出去。
--      改為白名單：只有 Normal 會出現在官網。
--   2. 前台要能依分類篩選，因此把 categories 的名稱一併帶出來。
--      products 只有 catId / catId2，是代碼不是名稱，前端無法直接顯示。
--
-- 產品主檔仍在報價系統的 public.products，本檔不修改該表。
--
-- ★ 為什麼是 DROP + CREATE 而不是 CREATE OR REPLACE：
--   PostgreSQL 的 CREATE OR REPLACE VIEW 只能在既有欄位「尾端追加」，
--   不能改變欄位名稱或順序。本次要在中段插入分類欄位，用 REPLACE 會報
--   「cannot change name of view column "material" to "cat_code"」。
--   兩個 view 都沒有其他資料庫物件依賴，直接 drop 重建是安全的；
--   前台在重建的瞬間查詢會失敗，但只有不到一秒，且尚無產品上架。
-- =========================================================

-- ---------------------------------------------------------
-- 對外公開的產品 view
--   ★ 安全關鍵不變：不得出現 supplier1/2、cost1/2、curr1/2、costRef、
--     defaultPrice、bom、bomFiles。
-- ---------------------------------------------------------
drop view if exists public.web_products_public;

create view public.web_products_public as
select
  p.id,
  p.series,
  p.name,          -- jsonb 多語：en / zh-TW / zh-CN / vi / ja
  p.features,      -- jsonb 多語
  p."catId",
  p."catId2",
  c1.code  as cat_code,       -- 主分類代碼
  c1."desc" as cat_name,      -- 主分類名稱，前台篩選用
  c2.code  as cat2_code,
  c2."desc" as cat2_name,
  p.material,
  p.interface,
  p."interfaceA",
  p."interfaceB",
  p.coo,
  p.dim,
  p.weight,
  p."pkgdim",
  p."pkgweight",
  p.img,
  p.img2,
  p.img3,
  p.status,
  s.web_kind,
  s.web_summary,
  s.sort_order
from public.products p
join public.web_product_settings s on s.product_id = p.id
left join public.categories c1 on c1.id = p."catId"
left join public.categories c2 on c2.id = p."catId2"
where s.published = true
  and p.status = 'Normal';     -- 只有 Normal 對外顯示

comment on view public.web_products_public is
  '官網可讀的產品資料，只含 status = Normal 且已上架者。不含成本、供應商、BOM 與內部價格欄位。';

grant select on public.web_products_public to anon, authenticated;

-- ---------------------------------------------------------
-- 後台用 view：仍列出全部產品（含非 Normal），讓編輯者知道全貌，
-- 但要看得出哪些即使勾了上架也不會出現在前台。
-- ---------------------------------------------------------
drop view if exists public.web_products_admin;

create view public.web_products_admin
with (security_invoker = off) as
select
  p.id,
  p.series,
  p.name,
  p."catId",
  p."catId2",
  c1."desc" as cat_name,
  p.img,
  p.status,
  (p.status = 'Normal')               as web_eligible,   -- 前台是否可能出現
  coalesce(s.published,  false)       as published,
  coalesce(s.web_kind,   'platform')  as web_kind,
  coalesce(s.sort_order, 0)           as sort_order,
  s.web_summary
from public.products p
left join public.web_product_settings s on s.product_id = p.id
left join public.categories c1 on c1.id = p."catId";

comment on view public.web_products_admin is
  '後台挑選上架產品用。含全部產品與上架狀態；web_eligible 標示該產品是否為 Normal。';

revoke all on public.web_products_admin from anon;
grant select on public.web_products_admin to authenticated;

-- ---------------------------------------------------------
-- 驗證
--   -- 前台 view 只該有 Normal
--   select distinct status from public.web_products_public;      -- 應只回 Normal
--
--   -- 機密欄位確認不存在
--   select count(*) from information_schema.columns
--   where table_name = 'web_products_public'
--     and column_name in ('cost1','cost2','supplier1','supplier2',
--                         'costRef','defaultPrice','bom','bomFiles');   -- 應回 0
--
--   -- 後台看得到全部
--   select status, count(*) from public.web_products_admin group by status;
-- ---------------------------------------------------------
