import { test, expect } from "@playwright/test";

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
async function setup(page, { signedIn = true, metadataStatus = 200, fullStatus = 200, list = files, waitFull, cacheControl = "private, no-store" } = {}) {
	const calls = [];
	await page.addInitScript((signedIn) => { window.__initialAuth = signedIn ? "a" : null; }, signedIn);
	await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.fulfill({ contentType: "text/javascript", body: route.request().url().endsWith("firebase-app.js") ? appStub : authStub }));
	await page.route("**/getKnowledgeBaseFiles*", async (route) => {
		const metadata = route.request().url().endsWith("?includeContent=false");
		const call = { metadata, auth: route.request().headers().authorization, url: route.request().url(), completed: false };
		calls.push(call);
		if (!metadata && waitFull) await waitFull();
		await route.fulfill({ status: metadata ? metadataStatus : fullStatus, headers: { "cache-control": cacheControl }, json: { files: list.map(({ content, ...file }) => metadata ? file : { ...file, content }) } }).catch(() => {});
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
	await expect(page.locator("#reader-metadata")).toContainText(pathA);
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
	expect(calls.filter((call) => !call.metadata)).toHaveLength(1);
	await page.reload();
	await expect(page.locator("#doc-中文章節")).toBeInViewport();
	expect(calls.filter((call) => !call.metadata)).toHaveLength(2);
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
test("rapid switching shares the full request and stale render never wins", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitFull: () => gate.promise });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await select(page, pathA);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "loading");
	await select(page, pathB);
	gate.resolve();
	await expect(page.locator("article h1")).toHaveText("Synthetic Two§");
	expect(calls.filter((call) => !call.metadata)).toHaveLength(1);
	await expect(page.locator("article")).not.toContainText("Synthetic One");
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
test("late full response after sign-out is ignored", async ({ page }) => {
	const gate = Promise.withResolvers();
	const calls = await setup(page, { waitFull: () => gate.promise });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("#reader-status")).toHaveText("正在載入文件正文…");
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
	expect(calls).toHaveLength(1);
	await expect(page.locator("article")).toBeEmpty();
});
for (const status of [401, 403]) test(`content HTTP ${status} removes authorized map and never uses old cache`, async ({ page }) => {
	await setup(page, { fullStatus: status });
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
	await page.unroute("**/getKnowledgeBaseFiles*");
	calls = await setup(page);
	await page.goto("/reader.html?source=knowledge&doc=unknown.md");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "missing");
	expect(calls).toHaveLength(1);
	await page.unroute("**/getKnowledgeBaseFiles*");
	await setup(page, { cacheControl: "public, max-age=3600" });
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "cache");
});
test("network errors recover through refresh and refresh discards old content before authorization", async ({ page }) => {
	await setup(page);
	await page.route("**/getKnowledgeBaseFiles*", (route) => route.abort("failed"));
	await page.goto("/reader.html");
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "network");
	await page.unroute("**/getKnowledgeBaseFiles*");
	await setup(page);
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("#reader-library a")).toHaveCount(98);
	await select(page, pathA);
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.route("**/getKnowledgeBaseFiles*", (route) => route.fulfill({ status: 403, body: "denied" }));
	await page.getByRole("button", { name: "重新整理文件清單" }).click();
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-library a")).toHaveCount(0);
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "forbidden");
});
test("TTL revalidates metadata and full content instead of extending the old cache", async ({ page }) => {
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
	await setup(page);
	await page.route("**/reader/assets/chunks/*mermaid*", async (route) => { await gate.promise; await route.continue(); });
	await page.goto("/reader.html?source=knowledge&doc=" + encodeURIComponent(pathA));
	await expect(page.locator("article h1")).toHaveText("Synthetic One§");
	await page.evaluate(() => window.__setAuth(null));
	const loaded = page.waitForResponse((response) => response.url().includes("mermaid"));
	gate.resolve();
	await loaded;
	await expect(page.locator("#reader-status")).toHaveAttribute("data-state", "login-required");
	await expect(page.locator("article")).toBeEmpty();
	await expect(page.locator("#reader-toc")).toBeEmpty();
	await expect(page.locator(".ks-diagram-dialog")).toHaveCount(0);
});
