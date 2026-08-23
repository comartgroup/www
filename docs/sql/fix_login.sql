-- =========================================================
-- COMART 官網後台 — 登入修復（依 diagnose_login.sql 的結果選一段執行）
-- =========================================================

-- ---------------------------------------------------------
-- 情況 A：② 查到零筆（帳號存在，但不在白名單）
--   → 把自己加回白名單並設為 admin
-- ---------------------------------------------------------
insert into public.web_editors (user_id, email, role)
select u.id, u.email, 'admin'
from auth.users u
where lower(u.email) = 'woody@comart.com.tw'
on conflict (user_id) do update set role = 'admin';

-- 確認
select e.email, e.role from public.web_editors e;

-- ---------------------------------------------------------
-- 情況 B：① 顯示「未驗證」
--   → Supabase 預設拒絕未驗證帳號登入，補上驗證時間
-- ---------------------------------------------------------
-- update auth.users
-- set email_confirmed_at = coalesce(email_confirmed_at, now())
-- where lower(email) = 'woody@comart.com.tw';

-- ---------------------------------------------------------
-- 情況 C：① 顯示「沒有密碼」，或你就是不記得密碼
--   → 不要在這裡改密碼。改用 Dashboard，步驟見對話說明：
--     Authentication → Users → Add user → Create new user
--     勾 Auto Confirm User，密碼自己填（10 碼以上，含大小寫與符號）
--   建完之後執行下面這段把新帳號設為 admin（把 email 換成你新建的）：
-- ---------------------------------------------------------
-- insert into public.web_editors (user_id, email, role)
-- select u.id, u.email, 'admin'
-- from auth.users u
-- where lower(u.email) = '換成你新建的email'
-- on conflict (user_id) do update set role = 'admin';
