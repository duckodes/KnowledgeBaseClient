# Jacfit Knowledge Base Client

## Document Reader

`reader.html` 沿用 Q&A 的 Firebase Authentication；問答頁的「文件閱讀」入口在同一個 Tab 導航，保留瀏覽器 History，可使用上一頁／下一頁返回。未登入時不呼叫私人文件 API，請由「返回 AI 問答」登入。登入只證明身分，公司 Membership／文件 ACL 必須由後端驗證。

Reader 先 GET `https://us-central1-source-c3817.cloudfunctions.net/getKnowledgeBaseFiles?includeContent=false`，建立可收合的資料夾清單；未指定文件時，登入與清單驗證完成後預設載入根目錄 `README.md`，其他文件選取後才 GET `https://us-central1-source-c3817.cloudfunctions.net/getKnowledgeBaseFile`。URLSearchParams 編碼 Metadata Map 的完整 `path`；成功回應採使用者確認的 `{ file: { path, bytes, updated, content } }`，檢查回傳路徑與選取項目完全相同，再交給既有 Markdown／DOMPurify／Mermaid Renderer。正文不再全量下載，也沒有 Bulk Fallback；不直接取得 GCS Object 或 Signed URL。

Reader 不顯示或請求 `AGENTS.md`、`analysis-reprt`／`analysis-report`（含 `.md` 與同名資料夾下文件）、`00_AI檢索地圖與回答規則.md`；名稱比對不分英文字母大小寫，套用到所有資料夾。這些項目先從 Metadata Map 排除，直接網址與相對連結也無法載入；此呈現規則不取代後端權限檢查。根目錄 `README.md` 不存在時保留清單選擇，空清單則顯示 Empty；不改開子資料夾 README。預設文件以 `replaceState` 更新同一筆 History，已指定的文件與 Fragment 不被覆蓋。

`analysis-report-ai/` 整個資料夾及所有下層文件也完全排除，不建立資料夾導覽或請求正文；即使位於其他資料夾內、使用不同英文大小寫，或透過 Reader 直接網址／相對連結存取，同樣不渲染。

兩頁共用 `firebase-auth.js` 與 SDK Persistence。請求使用 `user.getIdToken()`、Bearer Header、`cache: "no-store"` 與禁止 Redirect。總操作期限維持 30 秒，每次嘗試最多 10 秒，涵蓋 Token、Headers、Body；最多兩次自動重試。只有 Network／Timeout／429／502／503／504 會重試，採 250–500 ms、500–1000 ms 指數退避與 Jitter，且不早於有效 Retry-After。退避可取消並受總期限限制。其他 HTTP、Schema／大小錯誤、使用者取消與身分切換不自動重試。跨來源 Retry-After 需由後端 Expose-Headers 暴露。

一般單檔失敗保留 Sidebar，提供「重新載入文件」；載入中仍能導覽或取消，不需刷新整頁。401／403 清空私人清單與 Cache，顯示重新登入／無權限訊息。429 的手動重試按鈕會等待伺服器冷卻時間。Markdown 解析前讓出主執行緒，Mermaid 延後處理而不阻擋文字。上方顯示完整資料夾／文件路徑（省略 `.md`），「重新整理文件清單」在同一列右側；更新時間使用 Asia/Taipei，格式為 `YYYY-MM-DD HH:mm:ss`，來源只有分鐘時保留 `HH:mm`。不顯示載入診斷或 bytes。

正文只留在目前 Auth Session 的逐檔記憶體 Cache，TTL 五分鐘，命中不延長期限；上限 20 Entries／4 MiB 估計 UTF-16 記憶體（正文、路徑與固定 Entry 預算）。相同文件 Single-flight，一位等待者離開只取消自己的訂閱，最後一位離開才取消共用請求。Metadata Refresh 先隱藏舊內容，成功後只恢復 `updated`／`bytes` 相符且未過期的 Entry。失敗 Promise 不保留。登出、換帳號、401／403、Pagehide／BFCache 清理與背景回前景的期限核對保留。前端無法即時收回已取得或複製的內容，Cache 不能替代 Server-side Authorization。

API 驗證最多 1000 份文件、單檔宣告／UTF-8 大小 600,000 bytes、既有 Renderer 的 150,000 字元上限；Metadata 串流上限 32 MiB，單檔 JSON 串流上限 1 MiB（含 JSON Escaping 空間）。不合法 Schema、重複路徑、Traversal、無效 Unicode／UTF-8 或缺少正文會拒絕。Cache-Control 明確不含 `no-store` 時拒絕顯示；標頭缺少時顯示待核對警告。Cache-Control 是 CORS Safelisted Header，與 Retry-After 不同。實際公司資料大小與成功回應標頭仍待合法 Session 核對。

完整 `path` 保留大小寫與 Unicode 作為暫時 Document ID，相對連結只能指向可信 Metadata Map。`?source=knowledge&doc=...#...` 保留跨文件、Heading、Back／Forward 與 Refresh；重新命名或搬移會讓舊連結失效。合成範例保留於 `reader.html?doc=guide.md`、`?doc=safety.md` 與既有連結範例書籤；正式文件即使名為 `guide.md` 也以 `source=knowledge` 區別。只有根目錄 `README.md` 作為未指定文件時的預設內容，子資料夾 README 仍以完整路徑導航。

**Live Performance & Authorization: Pending。** 單檔 Response Shape 由使用者提供的實際欄位確認，本輪沒有合法 Session 獨立下載成功回應。本 Repository 不含該 Cloud Function Source；公司 Membership／Document ACL、撤權、GCS 保護與成功回應的 Cache／CORS／效能仍未驗證。匿名 GET 401 與預檢 204 不代表完整授權驗收；Mock Performance 不代表正式環境改善證明。

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
上述為原型視覺沿革；目前已接入 Authenticated Document API 架構，公司授權仍待獨立驗證。Preview 不作正式發布伺服器。

## 編輯規格

根目錄 `.editorconfig` 統一 UTF-8、LF、Tab 縮排（4 字元寬）、檔尾換行與移除行尾空白。
Markdown 使用 2 空白縮排並保留行尾空白，避免改變清單與強制換行語意；不另設定行寬限制。
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
文件開頭的平面 Frontmatter 會顯示為「文件資訊（文件自述）」欄位表格，包含中文欄名、文字值與路徑／對象清單；狀態不推論為已驗證。
支援 `---` 包住的文字欄位、帶引號的文字陣列與 `-` 清單，以及以 `title:` 開頭的相同欄位區塊。
複雜 YAML、重複欄位或格式錯誤保留原本的安全 Markdown 呈現，不執行其中的 HTML／連結，也不新增 YAML 套件。
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
