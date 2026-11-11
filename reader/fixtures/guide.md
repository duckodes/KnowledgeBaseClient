# 合成文件的閱讀指南

> Draft · Owner：範例文件小組 · 適用範圍：M1 本地原型。本文所有名稱、流程與數值均為合成資料，不代表正式服務。

這是一份完整的技術文章。從目錄進入章節、閱讀程式與圖表，再透過相對連結探索另一篇文件；同一份 Markdown 保留完整語意。

## 開始閱讀

閱讀器把內容、導覽與外觀分開。**文章是唯一正文**，目錄與章節連結都指向相同標題。

1. 使用左側目錄前往章節。
2. 點選標題旁的 § 取得可分享的章節網址。
3. 用瀏覽器上一頁、下一頁回到剛才的位置。

### 文件結構

每篇文章有一個 H1，主要主題使用 H2，補充細節使用 H3。

#### 細節與限制

H4 只展開 H3 之下的細節。文件狀態保留原始文字，不推論為已驗證。

> 使用限制：此原型只提供本地合成文件。登入狀態不代表任何文件存取授權。

## 程式與資料

以下程式只供閱讀；複製不會執行。

```javascript
const sample = { title: "Synthetic notebook", revision: 1 };
function describe(document) {
  return `${document.title}: revision ${document.revision}`;
}
console.log(describe(sample));
```

### 長行程式

```text
synthetic-record --mode preview --document sample-notebook --format markdown --revision demo-001 --description "A deliberately long synthetic line preserves whitespace and scrolls inside its own code region without widening the page."
```

### 範例欄位

| 欄位 | 類型 | 合成範例 | 行為 | 備註 |
| --- | --- | --- | --- | --- |
| title | string | Synthetic notebook | 作為文章標題 | 保留原文與 Unicode |
| revision | integer | 1 | 固定範例版本 | 非來源 Commit |
| description | string | 這是一段刻意較長的合成表格內容，用來檢查窄螢幕局部捲動與欄位關係 | 原樣顯示 | 不隱藏任何欄位，也不裁切 Unknown |

## 流程圖

文字替代：讀者選擇一份合成文件，閱讀器解析 Markdown，最後呈現文章；過程不呼叫文件 API。

```mermaid
flowchart LR
  accTitle: 合成文件閱讀流程
  accDescr: 讀者選擇合成文件，經過解析後顯示文章。
  reader[讀者] --> fixture[合成文件]
  fixture --> parser[Markdown 解析]
  parser --> article[文章]
```

### 圖表操作

使用圖表上方的放大、縮小與適合寬度按鈕；放大後圖內可水平捲動。下方保留原始圖碼。

## 連結與導覽

前往 [連結範例](examples/連結%20範例.md#中文章節)，或閱讀 [安全與失敗範例](safety.md)。

一般外部連結：[CommonMark 規格](https://spec.commonmark.org/)。外部網站由讀者主動開啟，閱讀器不預先請求。

### 同名章節

第一個同名標題有固定 anchor。

### 同名章節

第二個標題加上數字後綴，避免碰撞。

## 閱讀完成

可切換 Light、Dark 或跟隨系統；只儲存外觀偏好。使用鍵盤 Tab 可以走訪連結、目錄、程式複製與圖表控制。
