-- =========================================================
-- COMART 官網 — 收緊後台產品 view 的可見範圍
-- （第五份，接在 web_schema_04_products.sql 之後執行）
--
-- 這份與「編輯者帳號怎麼命名」無關，可以獨立執行，不影響任何登入。
-- 執行後前台與後台的行為對「官網編輯者」完全不變；
-- 改變的只有「其他系統的登入者」看不到官網後台的產品清單了。
-- =========================================================

-- ---------------------------------------------------------
-- 順帶修掉同一類問題：後台產品 view 對「所有登入者」開放
--
--   web_products_admin 原本是 `grant select to authenticated` 且 security_invoker = off，
--   代表任何一個登入本專案的帳號（KMS、CPF、報價系統、內部 Portal）都讀得到
--   官網後台的產品清單，包含尚未上架與 status 非 Normal 的品項。
--   雖然不含成本與供應商欄位，但那不是預期的跨系統可見範圍。
--
--   做法：view 內加一道 `where public.is_web_editor()`。
--   view 仍以 owner 身分執行（才讀得到未啟用 RLS 的 products），
--   但非官網編輯者查詢時會得到零筆，前端不必改。
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
  coalesce(s.published,  false)       as published,
  coalesce(s.web_kind,   'platform')  as web_kind,
  coalesce(s.sort_order, 0)           as sort_order,
  s.web_summary
from public.products p
left join public.web_product_settings s on s.product_id = p.id
left join public.categories c1 on c1.id = p."catId"
where public.is_web_editor();        -- ★ 非官網編輯者一律零筆

comment on view public.web_products_admin is
  '後台挑選上架產品用。含全部產品與上架狀態；只有 web_editors 白名單內的帳號查得到資料。';

revoke all on public.web_products_admin from anon;
grant select on public.web_products_admin to authenticated;

-- ---------------------------------------------------------
-- 驗證
--   -- 以官網編輯者身分（後台登入狀態）查詢，應該照常回到全部產品
--   select count(*) from public.web_products_admin;
--
--   -- 前台 view 不受影響，應照常只回已上架且 status = Normal 的產品
--   select count(*) from public.web_products_public;
-- ---------------------------------------------------------
