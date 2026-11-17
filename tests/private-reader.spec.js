import { test, expect } from "@playwright/test";
import { documentFields, documentBody } from "./frontmatter-fixture.js";

const pathA = "01_架構/README.md", pathB = "02_流程/README.md";
const content = "# Synthetic One\n\n## Intro\n\nOnly synthetic content.\n\n[流程](../02_%E6%B5%81%E7%A8%8B/README.md#中文章節)\n\n[unknown](unknown.md)\n\n[code](https://github.com/example/repo/blob/0123456789012345678901234567890123456789/file.js#L1)\n\n<img src=x onerror=alert(1)>\n\n## Diagram\n\n```mermaid\nflowchart LR\nA[Start] --> B[End]\n```\n\n```mermaid\nsequenceDiagram\nA->>B: refused\n```";
const files = [
	{ path: pathA, content },
	{ path: pathB, content: "# Synthetic Two\n\n## 中文章節\n\nSecond folder, same filename." },
	{ path: "guide.md", content: "# Private guide identity\n\n## Section\n\nSynthetic private root path." },
	...Array.from({ length: 95 }, (_, i) => ({ path: `03_其他/${String(i).padStart(3, "0")}.md`, content: `# Synthetic ${i}` })),
].map((file) => ({ ...file, bytes: new TextEncoder().encode(file.content).length, updated: "2026-11-10T06:02:12.353Z" }));
const appStub = "let app; export const getApps=()=>app?[app]:[]; export const getApp=()=>app; export const initializeApp=()=>app={};";
const authStub = `
export const browserLocalPersistence={}; export const getAuth=()=>({}); export const setPersistence=async()=>{};
export function onAuthStateChanged(auth, callback) {
 window.__setAuth=(uid)=>callback(uid?{uid,email:uid+'@example.invalid',getIdToken:async()=> 'synthetic-'+uid}:null);
 window.__setAuth(window.__initialAuth || null); return ()=>{};
}`;
async function setup(page, { signedIn = true, metadataStatus = 200, documentStatus = 200, list = files, waitDocument, cacheControl = "private, no-store" } = {}) {
	const calls = [];
	await page.addInitScript((signedIn) => { window.__initialAuth = signedIn ? "a" : null; }, signedIn);
	await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.fulfill({ contentType: "text/javascript", body: route.request().url().endsWith("firebase-app.js") ? appStub : authStub }));
	await page.route("**/getKnowledgeBaseFile*", async (route) => {
		const metadata = route.request().url().endsWith("?includeContent=false");
		const call = { metadata, auth: route.request().headers().authorization, url: route.request().url(), completed: false };
		calls.push(call);
		if (!metadata && waitDocument) await waitDocument();
		const selected = list.find((file) => file.path === new URL(route.request().url()).searchParams.get("path"));
		// User-confirmed file envelope; bodies and credentials remain synthetic.
		const status = metadata ? metadataStatus : typeof documentStatus === "function" ? documentStatus(call) : documentStatus;
		await route.fulfill({ status, headers: { "cache-control": cacheControl }, json: metadata ? { files: list.map(({ content, ...file }) => file) } : { file: selected } }).catch(() => {});
		call.completed = true;
	});
	return calls;
}
async function openNavigation(page, width = 1440) {
	if (width <= 900) await page.locator(".ks-navigation > summary").click();
}
async function select(page, path, width = 1440) {
	await openNavigation(page, width);
	const target = page.locator(`#reader-library a[data-doc="${path}"]`);
	if (!(await target.isVisible())) await page.locator("#reader-library summary").getByText(path.split("/")[0], { exact: true }).click();
	await target.click();
}

const excludedPaths = ["AGENTS.md", "nested/agents.MD", "analysis-reprt.md", "analysis-report.md", "analysis-report/details.md", "00_AI檢索地圖與回答規則.md", "analysis-report-ai/README.md", "analysis-report-ai/nested/change.md", "nested/ANALYSIS-REPORT-AI/README.md"];
const homeContent = "# Synthetic Home\n\n## Intro\n\n[Next](02_%E6%B5%81%E7%A8%8B/README.md#中文章節)\n\n" + excludedPaths.map((path, i) => `[Excluded ${i}](${path.split("/").map(encodeURIComponent).join("/")})`).join("\n\n");
const homeFiles = [
	{ ...files[0], path: "README.md", content: homeContent, bytes: new TextEncoder().encode(homeContent).length },
	files[1], ...excludedPaths.map((path) => ({ ...files[0], path, content: "# Excluded synthetic body" })),
];

test("root README opens after auth and metadata, keeping the entry and document history in one tab", async ({ page }) => {
	const calls = await setup(page, { signedIn: false, list: homeFiles });
	await page.goto("/reader.html?doc=guide.md");
	await expect(page.locator("article h1")).toContainText("合成文件的閱讀指南");
	await page.goto("/reader.html#intro");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	expect(calls).toHaveLength(0);
	const historyLength = await page.evaluate(() => history.length);
	await page.evaluate(() => window.__setAuth("a"));
	await page.addInitScript(() => { window.__initialAuth = "a"; });
	await expect(page.locator("article h1")).toHaveText("Synthetic Home§");
	await expect(page).toHaveURL(/source=knowledge&doc=README\.md#intro$/);
	await expect(page.locator("#doc-intro")).toBeInViewport();
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	await expect(page.locator("#reader-library a")).toHaveCount(2);
	await expect(page.locator("#reader-library")).not.toContainText(/analysis-report-ai/i);
	await expect(page.locator('article a[aria-disabled="true"]')).toHaveCount(excludedPaths.length);
	expect(calls.map((call) => call.metadata ? "metadata" : new URL(call.url).searchParams.get("path"))).toEqual(["metadata", "README.md"]);
	await page.getByRole("link", { name: "Next", exact: true }).click();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await page.goBack();
	await expect(page.locator("article h1")).toHaveText("Synthetic Home§");
	await page.goBack();
	await expect(page).toHaveURL(/doc=guide\.md$/);
	await page.goForward();
	await expect(page.locator("article h1")).toHaveText("Synthetic Home§");
	await page.reload();
	await expect(page.locator("#doc-intro")).toBeInViewport();
	expect(page.context().pages()).toHaveLength(1);
});

test("excluded documents cannot render or fetch via direct and encoded reader routes", async ({ page }) => {
	const calls = await setup(page, { list: homeFiles });
	for (const path of excludedPaths) {
		await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(path));
		await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "missing");
		await expect(page.locator("article")).toBeEmpty();
		await expect(page.locator("#reader-library a")).toHaveCount(2);
	}
	expect(calls.every((call) => call.metadata)).toBe(true);
});

test("default README waits for metadata and does not override explicit document selection", async ({ page }) => {
	const calls = await setup(page, { list: homeFiles });
	const gate = Promise.withResolvers();
	await page.route("**/getKnowledgeBaseFiles?*", async (route) => {
		await gate.promise;
		await route.fulfill({ json: { files: homeFiles.map(({ content, ...file }) => file) }, headers: { "cache-control": "no-store" } });
	});
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await expect(page.locator("article")).toBeEmpty();
	expect(calls).toHaveLength(0);
	gate.resolve();
	await expect(page.locator("article h1")).toHaveText("Synthetic Home§");
	expect(calls.filter((call) => !call.metadata).map((call) => new URL(call.url).searchParams.get("path"))).toEqual(["README.md"]);
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathB));
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
});

test("without root README the reader keeps selection or empty state and fetches no body", async ({ page }) => {
	const calls = await setup(page, { list: [files[0]] });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "select");
	await expect(page.locator("article")).toBeEmpty();
	expect(calls.every((call) => call.metadata)).toBe(true);
	await page.route("**/getKnowledgeBaseFiles?*", (route) => route.fulfill({ json: { files: homeFiles.filter((file) => excludedPaths.includes(file.path)).map(({ content, ...file }) => file) }, headers: { "cache-control": "no-store" } }));
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "empty");
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	expect(calls.every((call) => call.metadata)).toBe(true);
});

for (const width of [320, 390, 1440]) test(`private document metadata fields stay readable at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	const markdown = `---\n${documentFields}\n---\n${documentBody}`;
	const calls = await setup(page, { list: [{ ...files[0], content: markdown, bytes: new TextEncoder().encode(markdown).length }, files[1]] });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic change history§");
	const table = page.getByRole("table", { name: "文件資訊（文件自述）" });
	await expect(table).toBeVisible();
	await expect(table.getByRole("row")).toHaveCount(10);
	await expect(table.getByRole("rowheader", { name: "相關程式路徑" })).toHaveAttribute("scope", "row");
	await expect(table.getByRole("row").filter({ hasText: "相關程式路徑" }).locator("li")).toHaveCount(5);
	await expect(table.getByRole("row").filter({ hasText: "適用對象" }).locator("li")).toHaveText(["RD", "PM"]);
	await expect(table.getByRole("row").filter({ hasText: "狀態" })).toContainText("source-traced");
	await expect(page.locator("article")).toContainText("Synthetic body remains readable.");
	await expect(page.locator("#reader-toc a")).toHaveText(["Changes"]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(await table.evaluate((el) => el.scrollWidth <= el.parentElement.clientWidth)).toBe(true);
	await page.screenshot({ path: `test-results/document-fields-${width}-light.png`, fullPage: true });
	await page.locator("#reader-theme").selectOption("dark");
	await expect(table).toBeVisible();
	await page.screenshot({ path: `test-results/document-fields-${width}-dark.png`, fullPage: true });
	await page.getByRole("link", { name: "Next", exact: true }).click();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await expect(page.locator(".ks-document-fields")).toHaveCount(0);
	await page.goBack();
	await expect(table).toBeVisible();
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
});

for (const width of [320, 390, 1440]) test(`private login, 98-file tree, renderer, links and history at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	const calls = await setup(page, { signedIn: false });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	expect(calls).toHaveLength(0);
	await page.evaluate(() => window.__setAuth("a"));
	await page.addInitScript(() => { window.__initialAuth = "a"; });
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	expect(calls.filter((call) => !call.metadata)).toHaveLength(0);
	await select(page, pathA, width);
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await expect(page.locator("#reader-path")).toHaveText(`文件 / ${pathA.replace(/\.md$/, "")}`);
	await expect(page.locator("#reader-metadata")).toHaveText("更新 2026-11-10 14:02:12");
	await expect(page.locator("#reader-diagnostics")).toHaveCount(0);
	await expect(page.locator(".ks-document-bar > #reader-refresh")).toBeVisible();
	const bar = await page.locator(".ks-document-bar").boundingBox();
	const button = await page.locator("#reader-refresh").boundingBox();
	const pathBounds = await page.locator("#reader-path").boundingBox();
	expect(button.x + button.width).toBeCloseTo(bar.x + bar.width, 0);
	expect(Math.abs(button.y + button.height / 2 - pathBounds.y - pathBounds.height / 2)).toBeLessThan(2);
	await page.screenshot({ path: `test-results/private-reader-header-${width}.png` });
	await expect(page.locator("#reader-source")).toBeHidden();
	await expect(page.locator("article img, article script, article [onerror]")).toHaveCount(0);
	await expect(page.locator("a[aria-disabled=true]")).toContainText("unknown");
	await expect(page.frameLocator(".ks-diagram-frame").locator("svg")).toBeVisible();
	await expect(page.locator(".ks-diagram-error")).toHaveCount(1);
	await expect(page.locator('article a[target="_blank"]')).toHaveAttribute("rel", "noopener noreferrer");
	await page.getByRole("link", { name: "流程", exact: true }).click();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await expect(page.locator("#doc-中文章節")).toBeFocused();
	await expect(page.locator(`#reader-library a[data-doc="${pathB}"]`)).toHaveAttribute("aria-current", "page");
	await page.goBack();
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.goForward();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
	await page.reload();
	await expect(page.locator("#doc-中文章節")).toBeInViewport();
	expect(calls.filter((call) => !call.metadata)).toHaveLength(3);
	expect(calls.every((call) => call.auth === "Bearer synthetic-a" && !call.url.includes("synthetic-a"))).toBeTruthy();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
	const storage = await page.evaluate(() => ({ ...localStorage, ...sessionStorage }));
	expect(JSON.stringify(storage)).not.toContain("Synthetic One");
	expect(JSON.stringify(storage)).not.toContain("synthetic-a");
});

test("private root identity cannot alias a synthetic bookmark; Unicode fragment refresh works", async ({ page }) => {
	await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=guide.md#section");
	await expect(page.locator("article h1")).toHaveText("Private guide identity§");
	await page.reload();
	await expect(page.locator("#doc-section")).toBeInViewport();
});
test("rapid switching cancels obsolete single requests and stale render never wins", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitDocument: () => gate.promise });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await select(page, pathA);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await expect.poll(() => calls.filter((call) => !call.metadata).length).toBe(1);
	await select(page, pathB);
	gate.resolve();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
	await expect(page.locator("article")).not.toContainText("Synthetic One");
});
test("single-file response path mismatch is refused without bulk fallback or sidebar loss", async ({ page }) => {
	const calls = await setup(page);
	let documentRequests = 0;
	await page.route("**/getKnowledgeBaseFile?*", (route) => {
		documentRequests++;
		return route.fulfill({ json: { file: files[1] }, headers: { "cache-control": "no-store" } });
	});
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "schema");
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await expect(page.getByRole("button", { name: "重新載入文件" })).toBeVisible();
	await expect(page.locator("article")).toBeEmpty();
	expect(calls.filter((call) => !call.metadata)).toHaveLength(0);
	expect(documentRequests).toBe(1);
	expect(calls.every((call) => call.metadata || new URL(call.url).pathname.endsWith("/getKnowledgeBaseFile"))).toBe(true);
});
test("slow document keeps navigation available and explicit cancellation does not retry", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitDocument: () => gate.promise });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await expect(page.locator("#reader-path")).toHaveText(`文件 / ${pathA.replace(/\.md$/, "")}`);
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await expect.poll(() => calls.filter((call) => !call.metadata).length).toBe(1);
	await page.getByRole("button", { name: "取消載入" }).click();
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "abort");
	gate.resolve();
	await expect.poll(() => calls.some((call) => !call.metadata && call.completed)).toBe(true);
	expect(calls.filter((call) => !call.metadata)).toHaveLength(1);
	await expect(page.getByRole("button", { name: "重新載入文件" })).toBeVisible();
});
test("retry exhaustion offers manual document reload without a page or list refresh", async ({ page }) => {
	let attempts = 0;
	const calls = await setup(page, { documentStatus: () => ++attempts <= 3 ? 503 : 200 });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "retrying");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "server");
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await page.getByRole("button", { name: "重新載入文件" }).click();
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(4);
	expect(calls.filter((call) => call.metadata)).toHaveLength(1);
});
test("sign-out and user switch clear private article, metadata, expanded diagram and navigation", async ({ page }) => {
	const calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.getByRole("button", { name: "展開圖表" }).click();
	await page.evaluate(() => window.__setAuth(null));
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-metadata")).toBeEmpty();
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	await expect(page.locator("dialog[open]")).toHaveCount(0);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	await page.evaluate(() => window.__setAuth("b"));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	expect(calls.filter((call) => !call.metadata).map((call) => call.auth)).toEqual(["Bearer synthetic-a", "Bearer synthetic-b"]);
});
test("late single response after sign-out is ignored", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitDocument: () => gate.promise });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveText("正在載入文件正文…");
	await expect.poll(() => calls.filter((call) => !call.metadata).length).toBe(1);
	await page.evaluate(() => window.__setAuth(null));
	gate.resolve();
	await expect.poll(() => calls.some((call) => !call.metadata && call.completed)).toBe(true);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	await expect(page.locator("article")).toBeEmpty();
});
for (const [status, state] of [[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [503, "server"]]) test(`metadata HTTP ${status} has an explicit state and no full fetch`, async ({ page }) => {
	const calls = await setup(page, { metadataStatus: status });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", state);
	expect(calls).toHaveLength(status === 503 ? 3 : 1);
	await expect(page.locator("article")).toBeEmpty();
});
for (const status of [401, 403]) test(`content HTTP ${status} removes authorized map and never uses old cache`, async ({ page }) => {
	await setup(page, { documentStatus: status });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", status === 401 ? "unauthorized" : "forbidden");
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	await expect(page.locator("article")).toBeEmpty();
});
test("empty list, missing document and unsafe cache policy do not request or render content", async ({ page }) => {
	let calls = await setup(page, { list: [] });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "empty");
	expect(calls).toHaveLength(1);
	await page.unroute("**/getKnowledgeBaseFile*");
	calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=unknown.md");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "missing");
	expect(calls).toHaveLength(1);
	await page.unroute("**/getKnowledgeBaseFile*");
	await setup(page, { cacheControl: "public, max-age=3600" });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "cache");
});
test("network errors recover through refresh and refresh discards old content before authorization", async ({ page }) => {
	await setup(page);
	await page.route("**/getKnowledgeBaseFile*", (route) => route.abort("failed"));
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "network");
	await page.unroute("**/getKnowledgeBaseFile*");
	await setup(page);
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await select(page, pathA);
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.route("**/getKnowledgeBaseFile*", (route) => route.fulfill({ status: 403, body: "denied" }));
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "forbidden");
});
test("TTL revalidates metadata and single content instead of extending the old cache", async ({ page }) => {
	await page.clock.install();
	const calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.clock.runFor(300_001);
	await expect.poll(() => calls.filter((call) => call.metadata).length).toBe(2);
	await expect.poll(() => calls.filter((call) => !call.metadata).length).toBe(2);
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
});
test("sign-out while Mermaid loads cannot restore an obsolete article", async ({ page }) => {
	const gate = Promise.withResolvers();
	let mermaidStarted = false;
	await setup(page);
	await page.route("**/reader/assets/chunks/*mermaid*", async (route) => { mermaidStarted = true; await gate.promise; await route.continue(); });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await expect.poll(() => mermaidStarted).toBe(true);
	await page.evaluate(() => window.__setAuth(null));
	const loaded = page.waitForResponse((response) => response.url().includes("mermaid"));
	gate.resolve();
	await loaded;
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-toc")).toBeEmpty();
	await expect(page.locator(".ks-diagram-dialog")).toHaveCount(0);
});
test("attempt deadline retries the selected file and succeeds without refreshing the page", async ({ page }) => {
	const gate = Promise.withResolvers();
	let attempts = 0;
	const calls = await setup(page, { waitDocument: () => ++attempts === 1 ? gate.promise : Promise.resolve() });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathB));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await page.evaluate(() => {
		const status = document.querySelector("#reader-status");
		window.__sawRetry = false;
		new MutationObserver(() => { if (status.dataset.state === "retrying") window.__sawRetry = true; }).observe(status, { attributes: true, attributeFilter: ["data-state"] });
	});
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§", { timeout: 15_000 });
	expect(await page.evaluate(() => window.__sawRetry)).toBe(true);
	gate.resolve();
	await expect.poll(() => calls.filter((call) => !call.metadata && call.completed).length).toBe(2);
	expect(calls.filter((call) => call.metadata)).toHaveLength(1);
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
});
test("same pending document keeps one request and shared selection remains valid", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitDocument: () => gate.promise });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await expect.poll(() => calls.filter((call) => !call.metadata).length).toBe(1);
	await page.locator(`#reader-library a[data-doc="${pathA}"]`).click();
	gate.resolve();
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(1);
});
test("route change during backoff cancels obsolete retries while the next file succeeds", async ({ page }) => {
	const calls = await setup(page, { documentStatus: (call) => new URL(call.url).searchParams.get("path") === pathA ? 503 : 200 });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "retrying");
	await select(page, pathB);
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "ready");
	expect(calls.filter((call) => !call.metadata && new URL(call.url).searchParams.get("path") === pathA).length).toBeLessThan(3);
});
test("user switch during a single-file request cannot restore the old user's body", async ({ page }) => {
	await setup(page);
	const gate = Promise.withResolvers();
	let oldStarted = false, oldCompleted = false;
	await page.route("**/getKnowledgeBaseFile?*", async (route) => {
		const old = route.request().headers().authorization === "Bearer synthetic-a";
		if (old) { oldStarted = true; await gate.promise; }
		await route.fulfill({ json: { file: { ...files[0], content: old ? "# Old synthetic user" : "# New synthetic user" } }, headers: { "cache-control": "no-store" } }).catch(() => {});
		if (old) oldCompleted = true;
	});
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await expect.poll(() => oldStarted).toBe(true);
	await page.evaluate(() => window.__setAuth("b"));
	await expect(page.locator("article h1")).toHaveText("New synthetic user§");
	gate.resolve();
	await expect.poll(() => oldCompleted).toBe(true);
	await expect(page.locator("article h1")).toHaveText("New synthetic user§");
});
test("metadata removal clears the current body and never requests an unknown document", async ({ page }) => {
	const calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.route("**/getKnowledgeBaseFiles?*", (route) => route.fulfill({ json: { files: [] }, headers: { "cache-control": "no-store" } }));
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "missing");
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	expect(calls.filter((call) => !call.metadata)).toHaveLength(1);
});
test("document cache avoids repeated downloads without a diagnostics panel", async ({ page }) => {
	const calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await select(page, pathB);
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await select(page, pathA);
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
	await expect(page.locator("#reader-diagnostics")).toHaveCount(0);
	await expect(page.locator("#reader-metadata")).not.toContainText("bytes");
});
test("minute-only updated metadata stays minute-only in the reader", async ({ page }) => {
	await setup(page, { list: files.map((file) => ({ ...file, updated: "2026-11-10T06:02Z" })) });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathB));
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	await expect(page.locator("#reader-metadata")).toHaveText("更新 2026-11-10 14:02");
	await expect(page.locator("#reader-metadata time")).toHaveAttribute("datetime", "2026-11-10T06:02Z");
});
