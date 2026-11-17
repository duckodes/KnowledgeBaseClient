import guide from "./fixtures/guide.md";
import links from "./fixtures/examples/連結 範例.md";
import safety from "./fixtures/safety.md";
import { readerUrl, fixturePaths } from "./links.js";
import { renderMarkdown } from "./markdown.js";
import { renderDiagram } from "./diagrams.js";
import { DocumentSource } from "./document-source.js";
import { validDocumentPath } from "./document-api.js";
import { formatUpdated } from "./metadata.js";
const params = new URLSearchParams(location.search);
// Legacy fixture bookmarks stay public; explicit knowledge routes cannot alias them.
const privateSource = params.get("source") === "knowledge" || !(params.get("source") === "fixtures" || fixturePaths.includes(params.get("doc")) || (params.has("doc") && !validDocumentPath(params.get("doc"))));
const documentSource = new DocumentSource();
let authUser = null, authReady = false, metadataReady = false, session = 0, metadataGeneration = 0, expiryTimer, retryTimer, routeController, displayedExpiry = 0;
let documents = new Map([
	[
		fixturePaths[0],
		{ title: "合成文件的閱讀指南", text: guide, label: "01 / 閱讀指南" },
	],
	[
		fixturePaths[1],
		{ title: "連結解析範例", text: links, label: "02 / 連結範例" },
	],
	[
		fixturePaths[2],
		{ title: "安全與失敗範例", text: safety, label: "03 / 安全與失敗" },
	],
]);
const article = document.querySelector("#reader-article");
const status = document.querySelector("#reader-status");
const toc = document.querySelector("#reader-toc");
const theme = document.querySelector("#reader-theme");
const media = matchMedia("(prefers-color-scheme: dark)");
const narrow = matchMedia("(max-width: 900px)");
const navigation = document.querySelector(".ks-navigation");
navigation.open = !narrow.matches;
narrow.addEventListener("change", (event) => {
	navigation.open = !event.matches;
	scheduleCurrent();
});
navigation.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && narrow.matches && navigation.open) {
		event.preventDefault();
		navigation.open = false;
		navigation.querySelector("summary").focus();
	}
});
let currentPath,
	headings = [],
	generation = 0,
	currentFrame,
	pendingFragment = false;
let diagramQueue = Promise.resolve();
try {
	theme.value = ["light", "dark", "system"].includes(
		localStorage.getItem("ks-reader-theme"),
	)
		? localStorage.getItem("ks-reader-theme")
		: "system";
} catch {
	/* Presentation preference is optional. */
}
function applyTheme() {
	document.documentElement.dataset.readerTheme =
		theme.value === "system"
			? media.matches
				? "dark"
				: "light"
			: theme.value;
}
applyTheme();
const isDark = () => document.documentElement.dataset.readerTheme === "dark";
const library = document.querySelector("#reader-library");
const metadata = document.querySelector("#reader-metadata");
const refresh = document.querySelector("#reader-refresh");
const retry = document.querySelector("#reader-retry");
const cancel = document.querySelector("#reader-cancel");
const diagramStatus = document.querySelector("#reader-diagram-status");
function setState(state, message) {
	status.dataset.state = state;
	article.setAttribute("aria-busy", String(["loading", "retrying", "rendering"].includes(state)));
	cancel.hidden = !privateSource || !["loading", "retrying"].includes(state) || !currentPath;
	announce(message);
}
function buildLibrary() {
	library.replaceChildren();
	const folders = new Map([["", library]]);
	const entries = [...documents];
	if (privateSource) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
	for (const [path, doc] of entries) {
		let parent = library, folderPath = "";
		const segments = privateSource ? path.split("/") : [path];
		for (const segment of segments.slice(0, -1)) {
			folderPath += `${segment}/`;
			if (!folders.has(folderPath)) {
				const details = document.createElement("details");
				const summary = document.createElement("summary");
				summary.textContent = segment;
				details.append(summary);
				parent.append(details);
				folders.set(folderPath, details);
			}
			parent = folders.get(folderPath);
		}
		const a = document.createElement("a");
		a.href = readerUrl(path, "", privateSource);
		a.textContent = privateSource ? segments.at(-1) : doc.label;
		a.dataset.doc = path;
		parent.append(a);
	}
}
if (!privateSource) buildLibrary();
function announce(text) {
	status.textContent = text;
}
function updateCurrent() {
	// The last H2/H3 that crossed the reading line wins; above the first, none is current.
	const line =
		parseFloat(
			getComputedStyle(document.body).getPropertyValue(
				"--ks-heading-offset",
			),
		) + 2;
	let active;
	for (const heading of headings)
		if (
			(heading.level === 2 || heading.level === 3) &&
			heading.element.getBoundingClientRect().top <= line
		)
			active = heading.id;
	for (const a of toc.querySelectorAll("a")) {
		if (a.dataset.heading === active)
			a.setAttribute("aria-current", "location");
		else a.removeAttribute("aria-current");
	}
}
function scheduleCurrent() {
	if (currentFrame) return;
	currentFrame = requestAnimationFrame(() => {
		currentFrame = 0;
		updateCurrent();
	});
}
window.addEventListener("scroll", scheduleCurrent, { passive: true });
window.addEventListener("resize", scheduleCurrent);
new ResizeObserver(scheduleCurrent).observe(article);
for (const event of ["wheel", "touchmove", "pointerdown"])
	window.addEventListener(
		event,
		() => {
			pendingFragment = false;
		},
		{ passive: true },
	);
window.addEventListener("keydown", (event) => {
	if (
		[
			"ArrowUp",
			"ArrowDown",
			"PageUp",
			"PageDown",
			"Home",
			"End",
			" ",
		].includes(event.key)
	)
		pendingFragment = false;
});
function moveToFragment(focus = false) {
	let id;
	try {
		id = decodeURIComponent(location.hash.slice(1));
	} catch {
		announce("章節連結編碼無效。");
		return;
	}
	const heading = headings.find((h) => h.id === id);
	if (id && !heading) {
		announce("找不到指定章節；已保留完整文章。");
		if (focus) article.focus();
		return;
	}
	if (heading) {
		heading.element.scrollIntoView({ block: "start" });
		if (focus) heading.element.focus({ preventScroll: true });
	} else {
		window.scrollTo(0, 0);
		if (focus) article.focus({ preventScroll: true });
	}
	updateCurrent();
}
async function decorateDiagrams(token) {
	if (privateSource && article.querySelector("code.language-mermaid")) diagramStatus.textContent = "正在載入 Mermaid，文字已可閱讀。";
	for (const code of article.querySelectorAll(
		"pre > code.language-mermaid",
	)) {
		const pre = code.parentElement,
			source = code.textContent;
		const figure = document.createElement("figure");
		figure.className = "ks-diagram";
		const caption = document.createElement("figcaption");
		caption.textContent = "Mermaid · 文字替代請見相鄰說明";
		const viewport = document.createElement("div");
		viewport.className = "ks-diagram-viewport";
		const loading = document.createElement("p");
		loading.textContent = "正在繪製圖表，原始圖碼仍可閱讀。";
		viewport.append(loading);
		const details = document.createElement("details"),
			summary = document.createElement("summary");
		summary.textContent = "原始圖碼";
		pre.before(figure);
		details.append(summary, pre);
		figure.append(caption, viewport, details);
		try {
			await renderDiagram(source, viewport, isDark());
		} catch (error) {
			viewport.replaceChildren();
			const fallback = document.createElement("p");
			fallback.className = "ks-diagram-error";
			fallback.textContent = `圖表無法顯示或已被安全規則拒絕。${error.message} 請閱讀文字替代與原始圖碼。`;
			viewport.append(fallback);
			details.open = true;
		}
		if (token !== generation) return;
	}
	// Async diagram height must not move the requested fragment away from the viewport.
	if (token === generation && pendingFragment && location.hash)
		moveToFragment(false);
	if (token === generation && privateSource) {
		diagramStatus.textContent = "";
	}
	scheduleCurrent();
}
function closeExpanded() {
	const expanded = document.querySelector(".ks-diagram-dialog[open]");
	if (expanded) {
		expanded.dataset.navigating = "";
		expanded.close();
	}
}
function clearArticle() {
	closeExpanded();
	routeController?.abort("route-change");
	clearTimeout(expiryTimer);
	clearTimeout(retryTimer);
	displayedExpiry = 0;
	retry.hidden = true;
	cancel.hidden = true;
	diagramStatus.textContent = "";
	++generation;
	currentPath = null;
	pendingFragment = false;
	article.replaceChildren();
	toc.replaceChildren();
	headings = [];
	metadata.textContent = "";
	document.querySelector("#reader-path").textContent = "";
	const source = document.querySelector("#reader-source");
	source.hidden = true;
	source.removeAttribute("href");
	document.title = "文件閱讀 · KnowledgeSpace";
}
const errors = {
	"login-required": "請先登入，再返回閱讀公司文件。",
	unauthorized: "登入已失效，請返回 AI 問答重新登入。",
	forbidden: "目前帳號沒有文件閱讀權限。",
	missing: "找不到這份文件，請由文件清單選擇。",
	"not-found": "找不到文件或文件服務（404）。",
	timeout: "文件請求逾時，可重新載入文件。",
	abort: "文件請求已取消，可重新載入文件。",
	network: "網路連線失敗，可重新載入文件。",
	server: "文件服務暫時無法回應（5xx）。",
	"rate-limited": "文件服務暫時限制請求，請稍後重新載入文件。",
	schema: "文件回應格式無效，已停止顯示。",
	limit: "文件回應超過安全大小限制，已停止顯示。",
	cache: "伺服器未提供 no-store，已停止顯示私人文件。",
};
function showError(error, documentPath) {
	clearArticle();
	if (privateSource && (!documentPath || ["unauthorized", "forbidden"].includes(error.code))) {
		documentSource.reset();
		documents = new Map();
		metadataReady = false;
		buildLibrary();
	}
	if (documentPath && metadataReady) {
		document.querySelector("#reader-path").textContent = `文件 / ${documentPath.replace(/\.md$/i, "")}`;
		retry.hidden = false;
		const enable = () => {
			const delay = (error.retryAt || 0) - Date.now();
			retry.disabled = delay > 0;
			if (delay > 0) retryTimer = setTimeout(enable, Math.min(delay, 60_000));
		};
		enable();
	}
	setState(error.code || "api-error", errors[error.code] || (documentPath ? "文件載入失敗，可重新載入文件。" : "文件載入失敗，請重新整理文件清單。"));
}
function cacheWarning() {
	return documentSource.cachePolicy === "unknown" ? " 伺服器未提供可核對的 Cache-Control，需後端確認。" : "";
}
async function refreshDocuments() {
	if (!authUser) return;
	const ownSession = session, request = ++metadataGeneration;
	clearTimeout(expiryTimer);
	clearArticle();
	metadataReady = false;
	documents = new Map();
	buildLibrary();
	setState("loading", "正在載入文件清單…");
	try {
		const result = await documentSource.listDocuments({ onState: (state) => {
			if (ownSession === session && request === metadataGeneration) setState("retrying", `正在重試文件清單（${state.attempt}/2）…`);
		} });
		if (ownSession !== session || request !== metadataGeneration) return;
		documents = result;
		metadataReady = true;
		buildLibrary();
		await load();
	} catch (error) {
		if (ownSession === session && request === metadataGeneration) showError(error);
	}
}
async function load({ focus = false, force = false, reload = false } = {}) {
	if (privateSource && (!authReady || !authUser || !metadataReady)) return;
	closeExpanded();
	const url = new URL(location.href);
	if (privateSource && !url.searchParams.has("doc") && documents.has("README.md")) {
		url.searchParams.set("source", "knowledge");
		url.searchParams.set("doc", "README.md");
		history.replaceState(null, "", url);
	}
	const path = url.searchParams.get("doc") || (privateSource ? "" : fixturePaths[0]);
	if (path === currentPath && !force && privateSource && ["loading", "retrying", "rendering"].includes(status.dataset.state)) return;
	if (path === currentPath && !force && article.childNodes.length) {
		announce("");
		moveToFragment(focus);
		return;
	}
	clearArticle();
	currentPath = path;
	routeController = new AbortController();
	const token = generation, ownSession = session;
	pendingFragment = Boolean(location.hash);
	let doc = documents.get(path);
	document.querySelector("#reader-path").textContent = doc
		? `文件 / ${privateSource ? path.replace(/\.md$/i, "") : doc.title}`
		: "文件不存在";
	const source = document.querySelector("#reader-source");
	source.hidden = privateSource || !doc;
	for (const a of document.querySelectorAll("#reader-library a")) {
		if (a.dataset.doc === path) {
			a.setAttribute("aria-current", "page");
			for (let parent = a.parentElement; parent !== library; parent = parent.parentElement) {
				if (parent.tagName === "DETAILS") parent.open = true;
			}
		}
		else a.removeAttribute("aria-current");
	}
	if (!doc) {
		if (privateSource) {
			setState(path ? "missing" : documents.size ? "select" : "empty", path ? errors.missing : documents.size ? `共 ${documents.size} 份文件，請從導覽選擇。${cacheWarning()}` : "目前沒有可閱讀的文件。");
			return;
		}
		const h = document.createElement("h1");
		h.textContent = "找不到這份合成文件";
		article.append(h);
		announce("請由文件清單選擇；Reader 不會嘗試讀取其他路徑。");
		document.title = "文件不存在 · KnowledgeSpace";
		if (focus) article.focus();
		return;
	}
	if (privateSource) {
		setState("loading", "正在載入文件正文…");
		try {
			doc = await documentSource.loadDocument(path, {
				signal: routeController.signal, reload,
				onState: (state) => { if (token === generation && ownSession === session) setState("retrying", `正在重試文件（${state.attempt}/2）…`); },
			});
			if (token !== generation || ownSession !== session) return;
		} catch (error) {
			if (token === generation && ownSession === session) showError(error, path);
			return;
		}
		clearTimeout(expiryTimer);
		displayedExpiry = doc.expires;
		expiryTimer = setTimeout(() => refreshDocuments(), Math.max(0, displayedExpiry - Date.now()));
		const updated = document.createElement("time");
		updated.dateTime = doc.updated;
		updated.textContent = formatUpdated(doc.updated);
		metadata.replaceChildren("更新 ", updated, cacheWarning());
		document.querySelector("#reader-path").textContent = `文件 / ${doc.path.replace(/\.md$/i, "")}`;
	} else source.href = `./reader/fixtures/${path.split("/").map(encodeURIComponent).join("/")}`;
	document.title = `${doc.title} · KnowledgeSpace`;
	if (privateSource) {
		setState("rendering", "正在解析 Markdown…");
		if (globalThis.scheduler?.yield) await scheduler.yield();
		else await new Promise((resolve) => setTimeout(resolve, 0));
		if (token !== generation || ownSession !== session) return;
	}
	let result;
	try { result = renderMarkdown(doc.text, path, privateSource ? documents : undefined); }
	catch { showError({ code: "schema" }); return; }
	headings = result.headings;
	article.append(result.fragment);
	setState("ready", result.issues.join(" "));
	for (const h of headings.filter((h) => h.level === 2 || h.level === 3)) {
		const a = document.createElement("a");
		a.href = readerUrl(path, h.id, privateSource);
		a.textContent = h.title;
		a.dataset.heading = h.id;
		a.className = `ks-toc-level-${h.level}`;
		toc.append(a);
	}
	for (const pre of article.querySelectorAll("pre")) {
		if (pre.querySelector(".language-mermaid")) continue;
		const raw = pre.querySelector("code").textContent;
		const wrapper = document.createElement("div");
		wrapper.className = "ks-code";
		pre.before(wrapper);
		const bar = document.createElement("div");
		bar.className = "ks-code-bar";
		const label = document.createElement("span");
		label.textContent = `${pre.querySelector("code").className.replace("language-", "") || "code"} · 可水平捲動 ↔`;
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = "複製程式碼";
		button.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(raw);
				announce("程式碼已複製。");
			} catch {
				announce("無法使用剪貼簿，請手動選取程式碼複製。");
				pre.focus();
			}
		});
		bar.append(label, button);
		wrapper.append(bar, pre);
	}
	for (const table of article.querySelectorAll(".ks-table-scroll")) {
		const hint = document.createElement("span");
		hint.className = "ks-scroll-hint";
		hint.textContent = "表格可水平捲動 ↔；聚焦後可使用方向鍵。";
		table.before(hint);
	}
	moveToFragment(focus);
	// Serialize Mermaid global state; obsolete routes never write into the active article.
	diagramQueue = diagramQueue
		.then(() =>
			token === generation ? decorateDiagrams(token) : undefined,
		)
		.catch(() => { if (token === generation) announce("圖表資源無法載入，請閱讀原碼。"); });
}
document.addEventListener("click", (event) => {
	if (
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	)
		return;
	const a = event.target.closest("a[href]");
	if (!a || a.target === "_blank") return;
	const url = new URL(a.href, location.href);
	if (a.classList.contains("ks-skip")) {
		event.preventDefault();
		article.focus();
		article.scrollIntoView();
		return;
	}
	if (url.origin === location.origin && url.pathname === location.pathname) {
		event.preventDefault();
		if (narrow.matches) navigation.open = false;
		if (url.href !== location.href) history.pushState(null, "", url);
		load({ focus: true });
	}
});
window.addEventListener("popstate", () => load({ focus: true }));
window.addEventListener("hashchange", () => moveToFragment(true));
theme.addEventListener("change", () => {
	try {
		localStorage.setItem("ks-reader-theme", theme.value);
	} catch {
		/* Optional. */
	}
	applyTheme();
	load({ force: true });
});
media.addEventListener("change", () => {
	if (theme.value === "system") {
		applyTheme();
		load({ force: true });
	}
});
refresh.hidden = !privateSource;
refresh.addEventListener("click", () => refreshDocuments());
retry.addEventListener("click", () => load({ force: true, reload: true, focus: true }));
cancel.addEventListener("click", () => routeController?.abort("user-abort"));
if (!privateSource) load();
else {
	documents = new Map();
	clearArticle();
	document.querySelector(".ks-raw-fallback").hidden = true;
	document.querySelector(".ks-local-note").textContent = "公司文件需由伺服器授權；登入不代表具備文件權限。";
	document.querySelector(".ks-sidebar .ks-eyebrow").textContent = "公司文件 · DOCUMENTS";
	library.setAttribute("aria-label", "公司文件");
	document.querySelector(".ks-footer span").textContent = "Private documents · Server authorization required";
	setState("auth-checking", "正在確認登入狀態…");
	window.addEventListener("pagehide", () => {
		++session;
		clearTimeout(expiryTimer);
		documentSource.setUser(null);
		authUser = null;
		clearArticle();
		documents = new Map();
		buildLibrary();
	});
	window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden && authUser && displayedExpiry && Date.now() >= displayedExpiry) void refreshDocuments();
	});
	try {
		const { initializeFirebaseAuth, onAuthStateChanged } = await import("../firebase-auth.js");
		const { auth } = await initializeFirebaseAuth();
		onAuthStateChanged(auth, (user) => {
			++session;
			clearTimeout(expiryTimer);
			documentSource.setUser(user);
			authUser = user;
			authReady = true;
			metadataReady = false;
			documents = new Map();
			buildLibrary();
			clearArticle();
			refresh.disabled = !user;
			if (user) void refreshDocuments();
			else showError({ code: "login-required" });
		}, () => {
			++session;
			clearTimeout(expiryTimer);
			documentSource.setUser(null);
			authUser = null;
			refresh.disabled = true;
			showError({ code: "unauthorized" });
		});
	} catch { showError({ code: "auth-error" }); }
}
