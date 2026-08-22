-- =========================================================
-- COMART 官網 — 資料庫物件
-- 目標專案：Supabase tcvlnpgpuphdalzvmoyo（報價系統／KMS 所在專案）
--
-- 執行前請先閱讀 docs/DATA.md。
-- 這份 SQL 只「新增」物件，不修改報價系統既有的 products 資料表結構與資料。
-- =========================================================

-- ---------------------------------------------------------
-- 1. 產品上架設定
--    產品主檔留在 products；官網只需要「哪些要上架」與網站專用欄位。
--    刻意用獨立資料表，避免動到報價系統的 schema。
-- ---------------------------------------------------------
create table if not exists public.web_product_settings (
  product_id   text primary key references public.products(id) on delete cascade,
  published    boolean     not null default false,
  web_kind     text        not null default 'platform'
               check (web_kind in ('platform', 'quick')),
  sort_order   integer     not null default 0,
  web_summary  jsonb       not null default '{}'::jsonb,  -- { "en": "...", "zh-TW": "...", "vi": "..." }
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);

comment on table public.web_product_settings is
  '官網產品上架設定。產品主檔仍在 products，本表只控制官網呈現。';

-- ---------------------------------------------------------
-- 2. 對外公開的產品 view
--    ★ 安全關鍵：官網是公開網站，絕對不能直接讀 products。
--    products 含 supplier1/2、cost1/2、curr1/2、costRef、defaultPrice、
--    bom、bomFiles 等機密欄位，以下 view 一律不選取。
-- ---------------------------------------------------------
create or replace view public.web_products_public as
select
  p.id,
  p.series,
  p.name,          -- jsonb 多語：en / zh-TW / zh-CN / vi / ja
  p.features,      -- jsonb 多語
  p."catId",
  p."catId2",
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
where s.published = true
  and coalesce(p.status, 'Normal') <> 'EOL';

comment on view public.web_products_public is
  '官網可讀的產品資料。不含成本、供應商、BOM 與內部價格欄位。';

-- 只開放匿名唯讀
grant select on public.web_products_public to anon, authenticated;
revoke all on public.web_product_settings from anon;
grant select, insert, update, delete on public.web_product_settings to authenticated;

alter table public.web_product_settings enable row level security;

drop policy if exists web_product_settings_rw on public.web_product_settings;
create policy web_product_settings_rw on public.web_product_settings
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------
-- 3. 網站頁面內容（三語）
-- ---------------------------------------------------------
create table if not exists public.web_pages (
  id          text primary key,          -- home / services / operations / ...
  path        text not null,
  name        text not null,
  status      text not null default 'draft' check (status in ('draft', 'live')),
  content     jsonb not null default '{}'::jsonb,  -- { "hero_title": { "en": "...", "zh-TW": "...", "vi": "..." } }
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

alter table public.web_pages enable row level security;

drop policy if exists web_pages_public_read on public.web_pages;
create policy web_pages_public_read on public.web_pages
  for select to anon using (status = 'live');

drop policy if exists web_pages_editor_write on public.web_pages;
create policy web_pages_editor_write on public.web_pages
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------
-- 4. 公司動態
-- ---------------------------------------------------------
create table if not exists public.web_news (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'Company'
               check (category in ('Exhibition', 'Company', 'Certification', 'Capability', 'Product')),
  published_at date not null default current_date,
  status       text not null default 'draft' check (status in ('draft', 'live')),
  title        jsonb not null default '{}'::jsonb,
  body         jsonb not null default '{}'::jsonb,
  cover_path   text,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);

alter table public.web_news enable row level security;

drop policy if exists web_news_public_read on public.web_news;
create policy web_news_public_read on public.web_news
  for select to anon using (status = 'live');

drop policy if exists web_news_editor_write on public.web_news;
create policy web_news_editor_write on public.web_news
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------
-- 5. 詢價案件（Start Your Project 第一階段）
--    ★ 匿名只能新增，不能讀取。表單內容含客戶個資，不得公開查詢。
--    寫入建議走 Edge Function（驗證＋防濫用＋Email 通知），
--    此處的 insert 政策是最低限度的後備。
-- ---------------------------------------------------------
create table if not exists public.web_enquiries (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  company      text not null,
  contact      text not null,
  email        text not null,
  country      text not null,
  product_type text,
  stage        text,
  services     text,
  volume       text,
  market       text,
  launch       text,
  summary      text not null,
  nda          text,
  source_lang  text default 'en',
  state        text not null default 'new'
               check (state in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  owner_id     uuid,
  note         text
);

alter table public.web_enquiries enable row level security;

drop policy if exists web_enquiries_anon_insert on public.web_enquiries;
create policy web_enquiries_anon_insert on public.web_enquiries
  for insert to anon with check (true);

drop policy if exists web_enquiries_staff_read on public.web_enquiries;
create policy web_enquiries_staff_read on public.web_enquiries
  for select to authenticated using (true);

drop policy if exists web_enquiries_staff_write on public.web_enquiries;
create policy web_enquiries_staff_write on public.web_enquiries
  for update to authenticated using (true) with check (true);

revoke select on public.web_enquiries from anon;

-- =========================================================
-- 尚未包含、需要另外決定的項目：
--   * 後台角色細分（管理者／內容編輯／產品編輯／發布者）— 規劃書 8.3
--   * 自動翻譯 Edge Function 與翻譯服務帳號 — 規劃書 8.2、17.1
--   * 詢價通知的收件 Email 與案件狀態流程 — 規劃書 17.1
--   * 圖片與型錄的 Storage bucket 與存取政策
-- =========================================================
