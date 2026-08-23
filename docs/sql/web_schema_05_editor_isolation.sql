-- =========================================================
-- COMART 官網 — 編輯者帳號與其他系統脫鉤（第五份，接在 _04_products.sql 之後執行）
--
-- 問題（2026-08-23 Woody 指示）：
--   本 Supabase 專案的 auth.users 由官網、報價系統、CRM、KMS、CPF、內部 Portal 共用。
--   web_editors 白名單擋得住「寫入」，但擋不住「登入」——任何一個其他系統的帳號
--   都能用它原本的密碼登入 /webadmin。而且「加入既有帳號」這個動作會讓
--   同一組帳號密碼同時開得了官網後台與 KMS，等於兩個系統共用一道門。
--
-- 做法：
--   官網編輯者一律使用官網專屬的識別碼命名空間 @web.comart.com.tw。
--   這個網域不需要真的存在、也不需要收信——帳號由後台建立時直接標記為已驗證，
--   Supabase 不會寄任何信。密碼重設走後台的「重設密碼」，不走 email 連結。
--   好處：
--     1. 與 M365 的 @comart.com.tw 信箱永不衝突，識別碼一看就知道用途
--     2. 官網帳號的密碼與任何其他系統無關，互不影響
--     3. 沒有 email 重設流程，就沒有重設連結外流或寄信失敗的問題
--
--   本檔用觸發器強制這條規則，連手動 SQL insert 也繞不過去。
--
-- ★ 執行順序很重要，照著做不會把自己鎖在外面：
--     步驟 1（本檔上半部）：安裝觸發器。此時舊的共用帳號仍可登入後台。
--     步驟 2：用舊帳號登入 /webadmin →「使用者」→ 建立 woody@web.comart.com.tw
--             為 admin，記下臨時密碼。
--     步驟 3：登出，用新帳號登入，確認可以正常操作。
--     步驟 4（本檔下半部，需自行取消註解執行）：把舊的共用帳號移出白名單。
-- =========================================================

-- ---------------------------------------------------------
-- 步驟 1：強制命名空間
-- ---------------------------------------------------------

create or replace function public.web_editors_require_own_namespace()
returns trigger
language plpgsql
security definer                 -- 需要讀 auth.users，一般角色沒有權限
set search_path = public, auth
as $$
declare
  auth_email text;
begin
  select lower(u.email) into auth_email
  from auth.users u
  where u.id = new.user_id;

  if auth_email is null then
    raise exception
      'web_editors：user_id % 不存在於 auth.users', new.user_id;
  end if;

  if auth_email not like '%@web.comart.com.tw' then
    raise exception
      '官網編輯者必須使用官網專屬帳號（結尾為 @web.comart.com.tw）。'
      '% 屬於多系統共用的使用者名冊，授予官網權限會讓兩個系統共用同一組密碼。'
      '請改用後台的「建立官網專屬帳號」。', auth_email;
  end if;

  -- email 欄位只是快取，一律以 auth 端為準，避免白名單顯示與實際帳號不一致
  new.email := auth_email;
  return new;
end;
$$;

comment on function public.web_editors_require_own_namespace() is
  '確保 web_editors 只收官網專屬帳號（@web.comart.com.tw），避免與其他系統共用登入憑證。';

drop trigger if exists web_editors_namespace_guard on public.web_editors;
create trigger web_editors_namespace_guard
  before insert or update of user_id, email on public.web_editors
  for each row execute function public.web_editors_require_own_namespace();

-- ---------------------------------------------------------
-- 盤點：目前白名單裡有哪些帳號還不是官網專屬帳號
-- 這幾筆是「一組密碼開兩個系統」的來源，步驟 4 要清掉
-- ---------------------------------------------------------
select
  e.email                                   as 白名單_email,
  e.role                                    as 權限,
  u.email                                   as auth_email,
  case when lower(u.email) like '%@web.comart.com.tw'
       then '官網專屬'
       else '★ 與其他系統共用，待移除' end   as 狀態,
  u.last_sign_in_at                         as 最後登入
from public.web_editors e
join auth.users u on u.id = e.user_id
order by 狀態 desc, e.created_at;

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
-- 步驟 4：確認新帳號可用之後，才執行這一段
--
-- ★ 執行前務必先確認：
--     select count(*) from public.web_editors e join auth.users u on u.id = e.user_id
--     where u.email like '%@web.comart.com.tw' and e.role = 'admin';
--   結果必須 >= 1，否則會沒有人能管理後台。
--
-- 取消底下的註解再執行：
-- ---------------------------------------------------------

-- delete from public.web_editors e
-- using auth.users u
-- where u.id = e.user_id
--   and u.email not like '%@web.comart.com.tw';

-- ---------------------------------------------------------
-- 驗證
--   -- 觸發器有效：底下這句應該報錯，而不是成功
--   insert into public.web_editors (user_id, email, role)
--   select id, email, 'editor' from auth.users where email = 'woody@comart.com.tw';
--
--   -- 白名單應該只剩官網專屬帳號
--   select e.email, e.role from public.web_editors e;
-- ---------------------------------------------------------
