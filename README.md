# Jacfit Knowledge Base Client

## M1 Document Reader（本地原型）

保留現有 Firebase Login 與 AI Q&A，新增獨立 `reader.html`。Reader 只使用隨附的合成 Markdown，不需要登入或文件後端，不會連接私人知識來源。問答頁上方的「文件閱讀」入口另開分頁，保留原分頁的問答狀態。

需要 Node.js 22+ 與 npm：

```powershell
npm ci --ignore-scripts
npm run build
npm run preview
```

Preview 僅監聽 loopback。Reader 是 <http://127.0.0.1:31337/reader.html>，
問答頁為 <http://127.0.0.1:31337/>。也可 build 後使用原本 Live Server。
`file://` 不支援。打包結果在 `reader/assets/`，不納入版本控制；此 build 不執行 Deploy。

固定 M1 baseline 為 `046de72feaa5c7e4c73327006235c3848f78f9aa`。
後續測試工具版本加入 Regression Tests 與本地 Preview，沒有進行 M1.1 功能修正。
此版本只供固定合成資料驗收，不代表已接入私人文件或公司授權；Preview 不作正式發布伺服器。

## Regression Tests

需要 Node.js 22+、npm，以及已安裝的 Google Chrome（Playwright 使用 `channel: 'chrome'`）。
乾淨 checkout 安裝依賴後，可執行：

```powershell
npm ci --ignore-scripts
npm run build
npm test
```

`npm test` 會重新 build、執行 Node 單元測試、建立測試專用 bundle，再跑 Chrome 測試。
測試獨占 `127.0.0.1:31338`，與手動 Preview 的 `31337` 分開；不沿用另一個 checkout 的 server。
若 `31338` 已被占用，需先釋放該埠再跑測試。
測試使用合成 Firebase／Function 回應，不需真實帳號，也不呼叫正式服務。

F01（Mermaid 分號指令過濾）、F02（Windows Preview 路徑大小寫封鎖）、F03（TOC current）
仍存在；`tests/known-issues.spec.js` 以 `test.fail` 保存可重現案例。
這些是**預期失敗，不是修正通過或 skipped**；未來修正後，測試會因 unexpected pass 提醒移除標記。
F02 的預期失敗只標記 Windows，其餘平台照常驗證 404。
Playwright 的成功總數包含符合預期的失敗；請在 JSON 報告以 `expectedStatus` 與實際 status 區分。

`test-results/`、`playwright-report/`、`tests/assets/`、`reader/assets/` 皆為本地產物，
不提交 Git。審核暫存、私人文件與 Obsidian 筆記也不納入 Repository。

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
