-- =========================================================
-- COMART 官網 — 後台用產品清單 view（第二份，接在 web_schema.sql 之後執行）
--
-- 問題：
--   後台要讓編輯者從「所有產品」裡挑出要上架的，因此需要讀 products 全表。
--   但 products 是報價系統主檔，含 supplier1/2、cost1/2、curr1/2、costRef、
--   defaultPrice、bom、bomFiles 等機密欄位，且其 RLS 目前不放行匿名角色。
--
-- 做法：
--   建立一個只給「已登入使用者」的 view，同樣不含任何成本與供應商欄位。
--   後台讀這個 view，不直接碰 products。
--
-- 與 web_products_public 的差別：
--   web_products_public  → 匿名可讀，只有「已上架」的產品，給官網前台用
--   web_products_admin   → 需登入，列出「全部」產品含上架狀態，給後台挑選用
-- =========================================================

create or replace view public.web_products_admin
with (security_invoker = off) as
select
  p.id,
  p.series,
  p.name,                                   -- jsonb 多語
  p."catId",
  p."catId2",
  p.img,
  p.status,
  coalesce(s.published,  false)       as published,
  coalesce(s.web_kind,   'platform')  as web_kind,
  coalesce(s.sort_order, 0)           as sort_order,
  s.web_summary
from public.products p
left join public.web_product_settings s on s.product_id = p.id;

comment on view public.web_products_admin is
  '後台挑選上架產品用。含全部產品與上架狀態，不含成本、供應商、BOM 與內部價格欄位。';

-- 只開放給登入者，匿名一律不可讀
revoke all on public.web_products_admin from anon;
grant select on public.web_products_admin to authenticated;

-- =========================================================
-- 驗證（在 SQL Editor 執行，兩個都應該回 0）
--
--   -- 1. 匿名不該讀得到後台 view
--   set role anon;
--   select count(*) from public.web_products_admin;   -- 應該報權限錯誤
--   reset role;
--
--   -- 2. 公開 view 不該含任何機密欄位
--   select count(*) from information_schema.columns
--   where table_name = 'web_products_public'
--     and column_name in ('cost1','cost2','supplier1','supplier2',
--                         'costRef','defaultPrice','bom','bomFiles');
--   -- 應該回 0
-- =========================================================
