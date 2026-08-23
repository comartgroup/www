-- =========================================================
-- COMART 官網 — 新產品自動上架
-- （第六份，接在 web_schema_05_admin_view_scope.sql 之後執行）
--
-- 背景（2026-08-23 Woody 確認）：
--   原本 web_products_public 是 `join web_product_settings` + `where published = true`，
--   代表報價系統新增的產品在官網後台勾選之前不會出現。這道閘門原本是為了避免
--   客戶專屬產品意外公開，但 Woody 確認 status = 'Normal' 的產品不會有客戶專屬品項，
--   因此閘門的成本（每次新增都得記得去勾，忘了就漏）大於它的價值。
--
-- 改為「預設上架」：
--   left join + coalesce(s.published, true)
--     沒有設定行           → 視為上架（新產品自動出現）
--     設定行 published=true → 上架
--     設定行 published=false→ 不上架（後台明確關掉的仍然隱藏）
--
--   後台的開關用的是 upsert，關掉會寫入 published=false 那一行，
--   所以「明確關掉」這個狀態不會因為這次改動而失效。
--
-- ★ web_products_admin 的預設值必須同步改成 true。
--   否則新產品在前台是上架的、後台開關卻顯示未勾，兩邊互相矛盾，
--   而且編輯者一旦手動勾一下再取消，會反而把它下架。
--
-- ★ 用 DROP + CREATE 而非 CREATE OR REPLACE：後者無法改欄位名稱或順序，
--   雖然這次欄位沒動，但 DROP + CREATE 的結果不依賴線上版本與本檔是否一致。
--   grant 一定要排在重建之後（drop 會一併清掉權限）。
-- =========================================================

-- ---------------------------------------------------------
-- 1. 前台 view：預設上架
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
  c1.code   as cat_code,
  c1."desc" as cat_name,
  c2.code   as cat2_code,
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
  -- 沒有設定行時給預設值，前端就不必自己補；也讓排序不會出現 NULL
  coalesce(s.web_kind, 'platform') as web_kind,
  s.web_summary,
  coalesce(s.sort_order, 0)        as sort_order
from public.products p
left join public.web_product_settings s on s.product_id = p.id
left join public.categories c1 on c1.id = p."catId"
left join public.categories c2 on c2.id = p."catId2"
where coalesce(s.published, true) = true    -- ★ 預設上架
  and p.status = 'Normal';                  -- 只有 Normal 對外顯示

comment on view public.web_products_public is
  '官網可讀的產品資料。status = Normal 且未被後台明確下架者（新產品預設上架）。不含成本、供應商、BOM 與內部價格欄位。';

grant select on public.web_products_public to anon, authenticated;

-- ---------------------------------------------------------
-- 2. 後台 view：預設值同步改為 true
--    （其餘與第五份完全相同，包含 is_web_editor() 那道範圍限制）
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
  (p.status = 'Normal')               as web_eligible,
  coalesce(s.published,  true)        as published,   -- ★ 與前台一致
  coalesce(s.web_kind,   'platform')  as web_kind,
  coalesce(s.sort_order, 0)           as sort_order,
  s.web_summary,
  (s.product_id is null)              as never_set    -- 尚未被後台碰過的新產品
from public.products p
left join public.web_product_settings s on s.product_id = p.id
left join public.categories c1 on c1.id = p."catId"
where public.is_web_editor();        -- 非官網編輯者一律零筆

comment on view public.web_products_admin is
  '後台挑選上架產品用。含全部產品；published 預設 true（新產品自動上架），never_set 標示尚未設定過的品項。只有 web_editors 白名單內的帳號查得到資料。';

revoke all on public.web_products_admin from anon;
grant select on public.web_products_admin to authenticated;

-- ---------------------------------------------------------
-- 驗證
--   -- 機密欄位確認仍不存在（應回 0）
--   select count(*) from information_schema.columns
--   where table_name = 'web_products_public'
--     and column_name in ('cost1','cost2','supplier1','supplier2',
--                         'costRef','defaultPrice','bom','bomFiles');
--
--   -- 前台只該有 Normal（應只回 Normal）
--   select distinct status from public.web_products_public;
--
--   -- 明確下架的仍要被排除：這兩個數字應該相等
--   select
--     (select count(*) from public.web_products_public) as 前台筆數,
--     (select count(*) from public.products p
--      left join public.web_product_settings s on s.product_id = p.id
--      where p.status = 'Normal' and coalesce(s.published, true)) as 預期筆數;
--
--   -- 目前有幾項是「從未設定過」的新產品
--   select count(*) from public.products p
--   left join public.web_product_settings s on s.product_id = p.id
--   where s.product_id is null and p.status = 'Normal';
-- ---------------------------------------------------------
