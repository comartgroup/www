/* =========================================================
   COMART 官網 — Supabase 連線設定
   ---------------------------------------------------------
   這裡的 key 是 publishable（anon）key，設計上就是公開的：
   它會出現在每一個訪客的瀏覽器裡，保護完全來自資料庫的 RLS 政策，
   不來自這把 key 的隱密性。

   ★ 絕對不可以放進這個檔案的東西：
     - service_role key
     - ANTHROPIC_API_KEY 或任何翻譯服務金鑰
     - RESEND_API_KEY 或任何寄信服務金鑰
   那些一律只放 Supabase Edge Function 的 secrets。

   這個 repo 與 GitHub Pages 都是公開的。
   ========================================================= */
window.COMART_SUPABASE = {
  url: "https://tcvlnpgpuphdalzvmoyo.supabase.co",
  publishableKey: "sb_publishable_rAVwVeUMWD-m_VTFIenMhg_Fcg6ocYJ",
};
