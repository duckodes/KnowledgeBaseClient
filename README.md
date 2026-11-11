# Jacfit Knowledge Base Client

## M1 Document Reader（本地原型）

保留現有 Firebase Login 與 AI Q&A，新增獨立 `reader.html`。Reader 只使用隨附的合成 Markdown，不需要登入或文件後端，不會連接私人知識來源。問答頁上方的「文件閱讀」入口另開分頁，保留原分頁的問答狀態。

需要 Node.js 22+ 與 npm：

```powershell
npm ci --ignore-scripts
npm run build
```

Build 後，使用原本 VS Code Live Server 或本地 HTTP 靜態檔案伺服器，
從 repository root 提供頁面；建議只監聽 loopback。連接埠為 `31337` 時，
Reader 是 <http://127.0.0.1:31337/reader.html>，問答頁為 <http://127.0.0.1:31337/>。
`file://` 不支援。打包結果在 `reader/assets/`，不納入版本控制；此 build 不執行 Deploy。

此 baseline 只包含閱讀器 source、合成 fixtures、build 與必要說明；測試程式、
測試依賴、本地 Preview 腳本、審核報告與私人學習筆記不納入此 commit。
已知 F01（Mermaid 分號指令過濾）、F03（TOC current）仍保留；
本地未提交的 Preview 腳本另有 F02（Windows 路徑大小寫封鎖）限制。
此版本只供固定合成資料的 M1 驗收，不代表已接入私人文件或公司授權。

以下為既有問答頁說明；本輪未變更 Firebase、IAM 或部署流程。

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
