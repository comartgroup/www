-- =========================================================
-- COMART 官網後台 — 登入問題診斷（唯讀，不會改任何東西）
--
-- 用途：後台登不進去時，一次看出是「帳號／密碼」還是「白名單」的問題。
-- 在 Supabase SQL Editor 整段貼上執行即可。
-- =========================================================

-- ① auth.users 裡有沒有這個帳號、密碼設過沒有
select
  '① auth 帳號'                                  as 檢查項,
  u.email,
  u.id                                           as user_id,
  case when u.encrypted_password is null or u.encrypted_password = ''
       then '★ 沒有密碼 —— 無法用密碼登入'
       else '有密碼' end                          as 密碼狀態,
  case when u.email_confirmed_at is null
       then '★ 未驗證 —— Supabase 預設會拒絕登入'
       else '已驗證' end                          as 驗證狀態,
  u.last_sign_in_at                              as 最後成功登入,
  u.banned_until                                 as 封鎖至
from auth.users u
where lower(u.email) = 'woody@comart.com.tw';
-- 零筆 = 這個 email 根本不存在 → 要用下方 ⑤ 建立帳號

-- ② 這個帳號在不在官網編輯白名單裡（我加的登入閘門看這個）
select
  '② 白名單'                                     as 檢查項,
  e.email,
  e.role,
  e.created_at
from public.web_editors e
join auth.users u on u.id = e.user_id
where lower(u.email) = 'woody@comart.com.tw';
-- 零筆 = 登入會被閘門擋下，顯示「沒有官網後台權限」→ 執行下方 ④ 修復

-- ③ 白名單目前全部成員（確認有沒有人可以管後台）
select '③ 全部編輯者' as 檢查項, e.email, e.role, u.last_sign_in_at
from public.web_editors e
left join auth.users u on u.id = e.user_id
order by e.role, e.created_at;

-- ④ 有沒有殘留我先前那個「命名空間」觸發器（正常情況應為零筆）
select '④ 殘留觸發器' as 檢查項, tgname
from pg_trigger
where tgrelid = 'public.web_editors'::regclass
  and not tgisinternal;
-- 若出現 web_editors_namespace_guard，執行：
--   drop trigger if exists web_editors_namespace_guard on public.web_editors;
--   drop function if exists public.web_editors_require_own_namespace();
