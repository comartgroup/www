-- =========================================================
-- COMART 官網 — 編輯者白名單（第三份，接在 web_schema_02_admin.sql 之後執行）
--
-- 問題：
--   本 Supabase 專案由報價系統／KMS／CPF 與官網共用。
--   web_schema.sql 的政策寫成 `to authenticated using (true)`，
--   等於「任何一個登入本專案的帳號」都能編輯與發布官網內容，
--   包含 KMS 與 CPF 的使用者。這不是預期行為。
--
-- 做法：
--   建立 web_editors 白名單，RLS 改為檢查 auth.uid() 是否在名單內。
--   前台的匿名讀取政策不受影響。
--
-- ★ 執行後如果沒有把自己加進 web_editors，後台會變成唯讀甚至完全無法操作。
--   請務必先執行最後一段的「加入第一位編輯者」。
-- =========================================================

create table if not exists public.web_editors (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'editor'
              check (role in ('admin', 'editor', 'product', 'publisher')),
  created_at  timestamptz not null default now()
);

comment on table public.web_editors is
  '官網後台編輯者白名單。本 Supabase 專案為多系統共用，未列於此表的帳號不得寫入 web_* 資料表。';

alter table public.web_editors enable row level security;

-- 白名單本身：只有名單內的人看得到，只有 admin 能改
drop policy if exists web_editors_read on public.web_editors;
create policy web_editors_read on public.web_editors
  for select to authenticated
  using (exists (select 1 from public.web_editors e where e.user_id = auth.uid()));

drop policy if exists web_editors_admin_write on public.web_editors;
create policy web_editors_admin_write on public.web_editors
  for all to authenticated
  using      (exists (select 1 from public.web_editors e where e.user_id = auth.uid() and e.role = 'admin'))
  with check (exists (select 1 from public.web_editors e where e.user_id = auth.uid() and e.role = 'admin'));

-- 判斷用的小函式，避免每條政策重複寫子查詢
create or replace function public.is_web_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.web_editors where user_id = auth.uid());
$$;

grant execute on function public.is_web_editor() to authenticated;

-- ---------------------------------------------------------
-- 收緊既有政策：把 `using (true)` 換成白名單檢查
-- ---------------------------------------------------------

drop policy if exists web_pages_editor_write on public.web_pages;
create policy web_pages_editor_write on public.web_pages
  for all to authenticated
  using (public.is_web_editor()) with check (public.is_web_editor());

drop policy if exists web_news_editor_write on public.web_news;
create policy web_news_editor_write on public.web_news
  for all to authenticated
  using (public.is_web_editor()) with check (public.is_web_editor());

drop policy if exists web_product_settings_rw on public.web_product_settings;
create policy web_product_settings_rw on public.web_product_settings
  for all to authenticated
  using (public.is_web_editor()) with check (public.is_web_editor());

-- 詢價案件含客戶個資，同樣只限官網編輯者
drop policy if exists web_enquiries_staff_read on public.web_enquiries;
create policy web_enquiries_staff_read on public.web_enquiries
  for select to authenticated using (public.is_web_editor());

drop policy if exists web_enquiries_staff_write on public.web_enquiries;
create policy web_enquiries_staff_write on public.web_enquiries
  for update to authenticated
  using (public.is_web_editor()) with check (public.is_web_editor());

-- 匿名投件政策不動，維持 insert only
-- （web_enquiries_anon_insert 保持原樣）

-- ---------------------------------------------------------
-- ★ 加入第一位編輯者 —— 一定要執行，否則沒有人能操作後台
-- ---------------------------------------------------------
insert into public.web_editors (user_id, email, role)
select id, email, 'admin'
from auth.users
where email = 'woody@comart.com.tw'
on conflict (user_id) do update set role = 'admin';

-- 之後要新增編輯者：
--   insert into public.web_editors (user_id, email, role)
--   select id, email, 'editor' from auth.users where email = '同事的email';

-- ---------------------------------------------------------
-- 驗證
--   select e.email, e.role from public.web_editors e;          -- 應該至少一筆
--   select public.is_web_editor();                             -- 以該帳號登入時應回 true
-- ---------------------------------------------------------
