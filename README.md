# Jacfit Knowledge Base Client

## M1.2 Document Reader（本地原型）

保留現有 Firebase Login 與 AI Q&A，新增獨立 `reader.html`。Reader 只使用隨附的合成 Markdown，不需要登入或文件後端，不會連接私人知識來源。問答頁上方的「文件閱讀」入口另開分頁，保留原分頁的問答狀態。

需要 Node.js 22+ 與 npm：

```powershell
npm ci --ignore-scripts
npm run build
npm run preview
```

Preview 僅監聽 loopback。Reader 是 <http://127.0.0.1:31337/reader.html>，
問答頁為 <http://127.0.0.1:31337/>。若該埠已被 Live Server 使用，可執行 `node scripts/preview.mjs 31339`。
`file://` 不支援。打包結果在 `reader/assets/`，不納入版本控制；此 build 不執行 Deploy。

固定 M1 baseline 為 `046de72feaa5c7e4c73327006235c3848f78f9aa`。
測試工具起點為 `8c023abadb2f090caa1784abc22f620f5ad729a1`。
M1.1 加入共享 Green／Neutral Tokens、手機收合導覽、依閱讀線更新的 TOC，以及可關閉的圖表展開視窗。
M1.2 沿用 Q&A 的原始 Jacfit SVG／JACFIT／KNOWLEDGE STUDIO，統一 UI 排字與字型合成設定；
正文保留 16px／1.8 行高，Dark Mode 改為中性 Charcoal Surface，綠色用於品牌與互動提示。
未新增遠端字型；實際字體依系統安裝的 Font Stack 回退，測試另檢查 Chrome 的 Platform Fonts。
此版本只供固定合成資料驗收，不代表已接入私人文件或公司授權；Preview 不作正式發布伺服器。

## 編輯規格

根目錄 `.editorconfig` 統一 UTF-8、LF、2 空白縮排、檔尾換行與移除行尾空白，
並以 100 字元作為折行參考；Markdown 保留行尾空白，避免改變強制換行語意。
`.gitattributes` 將 Git 的文字檔案簽出統一為 LF，避免 Windows 的 `core.autocrlf` 覆寫設定。
請使用支援 EditorConfig 的編輯器或擴充套件；此設定不會自動格式化整個 Repository，
也不負責 JavaScript 引號、分號或程式邏輯檢查。

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

F01（Mermaid 來源政策）、F02（Preview 路徑大小寫）、F03（TOC current）原 Assertion 保留於
`tests/known-issues.spec.js`，已移除預期失敗標記；新增 Unit 與 Browser Tests 驗證等價語法、實際渲染及導覽生命週期。

Mermaid 僅接受保守子集：`flowchart`／`graph` 加方向、純文字矩形節點、`-->`、單行 `accTitle`／`accDescr`、行註解；可用換行或分號分隔。
來源樣式、click、class、init／config、HTML、未知圖型與未支援語法均拒絕，保留原因、相鄰文字替代與原始圖碼。
來源政策先於 Mermaid Parser／Host DOM；仍保留 strict、SVG Sanitization、無權限 Sandbox 與 CSP。
此有限語法與測試語料不構成任意網路 Markdown 的安全保證。

Preview 使用明確的公開檔案 Allowlist、解析後的實體路徑核對；不提供工作樹、node_modules 或測試原始碼。
只有 Playwright 的明確 `--test` 模式允許單一測試 bundle。手動 Preview 預設不提供該 bundle；這項保護不適用於其他 Live Server。
Preview 僅供本機開發，不能作為 Production Server。

TOC 以最後一個跨越閱讀線的 H2／H3 為 current；首個 H2 之前無 current。捲動只更新呈現，不修改 URL、History 或焦點。
手機「瀏覽文件與章節」預設收合；Escape 關閉並回到開關，選章節則回到正文標題。
圖表預設 100% 適合寬度；放大後在圖內捲動或用方向鍵平移。「展開圖表」使用同一個 iframe，Escape／關閉後回到原按鈕。

`styles/tokens.css` 是兩頁共用的顏色、Radius、字型、Sidebar 寬度、Control Height 與 Focus Ring；
`styles/brand.css` 統一品牌元件的 SVG 尺寸、字體層級、間距與 Mobile 比例。
原始 SVG 以 `index.html` 為準，Reader 保留相同路徑，Regression Test 核對兩份標記以防偏離。
`styles.css` 保留聊天版面，`reader/reader.css` 保留文章、TOC、Code／Table Overflow 與 Mermaid 版面。
支援 `moveBefore()` 的瀏覽器以原生移動保留 Expanded Diagram 的 iframe Document；其他瀏覽器沿用 srcdoc Reload，安全限制相同。

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
