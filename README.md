# Jacfit Knowledge Base Client

使用原生 HTML、CSS、JavaScript 與 Firebase Authentication 的知識庫問答頁面。
Firebase 網頁設定會從 `config/firebaseConfig.json` 載入。
頁面會在目前登入期間暫存最近四輪成功對話，讓助理能承接追問；登出後會清除對話脈絡。

## 本機啟動

請使用 VS Code Live Server 開啟 `index.html`（設定的連接埠為 `31337`），
或從此資料夾啟動任何本機 HTTP 靜態檔案伺服器。不要直接用 `file://` 開啟，
因為瀏覽器無法透過 `file://` 載入 Firebase 設定檔。

## Firebase 設定

1. Firebase Console 的 Authentication > Sign-in method 啟用 Email/Password。
2. Authentication > Settings > Authorized domains 加入正式網站網域；本機開發時
   確認 `localhost` 已在授權網域中。
3. 確認 `config/firebaseConfig.json` 的 `projectId` 與部署
   `knowledgeBaseAgent` Cloud Function 的 Firebase 專案相同。頁面會使用
   `us-central1` 作為 Function 區域。
4. 部署後端 Function，並確認 Functions 的 `GEMINI_API_KEY` secret 已設定。

前端設定檔中的 Firebase Web API key 是 Firebase 用戶端識別設定，不是 Admin
SDK 私密金鑰。請勿在這個前端專案加入 Firebase Admin 憑證或服務帳戶私鑰。
