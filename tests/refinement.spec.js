import { test, expect } from "@playwright/test";
import http from "node:http";

test("F01 rejected sources never enter the host renderer; allowed SVG remains isolated", async ({
	page,
	baseURL,
}) => {
	const remote = [],
		errors = [];
	page.on("request", (r) => {
		if (!r.url().startsWith(baseURL + "/")) remote.push(r.url());
	});
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("/reader.html?doc=safety.md");
	await expect(page.locator(".ks-diagram-error")).toHaveCount(2);
	const result = await page.evaluate(async () => {
		const { renderDiagram } =
			await import("/tests/assets/security-entry.js");
		let workspaces = 0;
		const observer = new MutationObserver((records) => {
			for (const r of records)
				for (const node of r.addedNodes)
					if (node.classList?.contains("ks-diagram-workspace"))
						workspaces++;
		});
		observer.observe(document.body, { childList: true });
		const target = document.createElement("div");
		document.body.append(target);
		let rejected = 0;
		const commands = [
			"style A fill:red",
			'click A "javascript:window.__diagramXss=1"',
			'click A "https://example.invalid/probe"',
			"classDef x fill:red",
			"linkStyle 0 stroke:red",
		];
		const corpus = commands.flatMap((command) =>
			[";", "\n", "\r\n", ";\t", " %% comment\n"].map(
				(separator) => `flowchart LR\nA-->B${separator}${command}`,
			),
		);
		corpus.push(
			'%%{init:{"securityLevel":"loose"}}%%\nflowchart LR; A-->B',
			"---\nconfig:\n  securityLevel: loose\n---\nflowchart LR; A-->B",
			"flowchart LR; A[<img src=https://example.invalid/probe onerror=window.__diagramXss=1>]-->B",
		);
		for (const source of corpus) {
			try {
				await renderDiagram(source, target, false);
			} catch {
				rejected++;
			}
		}
		await Promise.resolve();
		observer.disconnect();
		const beforeRender = {
			workspaces,
			rejected,
			count: corpus.length,
			frames: target.querySelectorAll("iframe").length,
		};
		await renderDiagram(
			"flowchart LR; A[Reader]-->B[Article]",
			target,
			false,
		);
		const frame = target.querySelector("iframe");
		frame.dataset.policyTest = "";
		return {
			...beforeRender,
			sandbox: frame.getAttribute("sandbox"),
			source: frame.srcdoc,
			executed: window.__diagramXss || false,
		};
	});
	expect(result.rejected).toBe(result.count);
	expect(result.workspaces).toBe(0);
	expect(result.frames).toBe(0);
	expect(result.sandbox).toBe("");
	expect(result.executed).toBe(false);
	expect(result.source).toContain("default-src 'none'");
	const svg = page.frameLocator("iframe[data-policy-test]").locator("svg");
	await expect(svg.locator("g.node")).toHaveCount(2);
	await expect(
		svg.locator(
			"script,foreignObject,a,image,use,[href],[onload],[onclick]",
		),
	).toHaveCount(0);
	expect(remote).toEqual([]);
	expect(errors).toEqual([]);
});

test("F02 raw HTTP casing, encoding and traversal are denied without URL normalization", async ({
	baseURL,
	request,
}) => {
	for (const path of [
		"/reader.html",
		"/styles/tokens.css",
		"/reader/reader.css",
		"/reader/assets/reader.js",
		"/reader/fixtures/guide.md",
	])
		expect((await request.get(path)).status(), path).toBe(200);
	const rawStatus = (path) =>
		new Promise((resolve, reject) => {
			http.get(baseURL + "/", { path }, (response) => {
				response.resume();
				response.on("end", () => resolve(response.statusCode));
			}).on("error", reject);
		});
	for (const path of [
		"/NODE_MODULES/markdown-it/package.json",
		"/NoDe_MoDuLeS/markdown-it/package.json",
		"/%6eode_modules/markdown-it/package.json",
		"/node%5fmodules/markdown-it/package.json",
		"/%4eODE_MODULES/markdown-it/package.json",
		"/%256eode_modules/markdown-it/package.json",
		"/../package.json",
		"/%2e%2e/package.json",
		"/reader/../../package.json",
		"/reader%5c..%5cpackage.json",
		"/reader/assets/../reader.js",
		"/.git/config",
		"/.env",
		"/docs/private.md",
		"/tests/reader.spec.js",
		"/scripts/preview.mjs",
		"/reader.html:stream",
	])
		expect(await rawStatus(path), path).toBe(404);
});

for (const width of [320, 390, 1440])
	test(`F03 reading line, navigation lifecycle and disclosure at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/reader.html");
		await expect(
			page.frameLocator(".ks-diagram-frame").locator("g.node"),
		).toHaveCount(4);
		const current = page.locator("#reader-toc a[aria-current]");
		await expect(current).toHaveCount(0);
		const navigation = page.locator(".ks-navigation");
		const summary = navigation.locator(":scope > summary");
		const open = async () => {
			if (width < 900 && !(await navigation.evaluate((el) => el.open)))
				await summary.click();
		};
		if (width < 900) {
			await expect(navigation).not.toHaveAttribute("open");
			expect(
				await page
					.locator("article h1")
					.evaluate((el) => el.getBoundingClientRect().top),
			).toBeLessThan(360);
			await open();
			await page.locator("#reader-toc a").first().focus();
			await page.keyboard.press("Escape");
			await expect(summary).toBeFocused();
			await expect(navigation).not.toHaveAttribute("open");
		}
		for (const title of ["程式與資料", "長行程式", "流程圖"]) {
			await open();
			await page
				.locator("#reader-toc")
				.getByRole("link", { name: title, exact: true })
				.click();
			await expect(current).toHaveText(title);
			await expect(
				page.locator(`h2,h3`).filter({ hasText: title }).first(),
			).toBeFocused();
			if (width < 900)
				await expect(navigation).not.toHaveAttribute("open");
		}
		const url = page.url(),
			history = await page.evaluate(() => window.history.length);
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(current).toHaveCount(0);
		expect(page.url()).toBe(url);
		expect(await page.evaluate(() => window.history.length)).toBe(history);
		await expect(page.locator("#doc-流程圖")).toBeFocused();
		await page
			.locator("#doc-程式與資料")
			.evaluate((el) => el.scrollIntoView());
		await expect(current).toHaveText("程式與資料");
		// Place the reading line between headings: no heading needs to intersect a viewport band.
		await page
			.locator("#doc-開始閱讀")
			.evaluate((el) =>
				window.scrollTo(
					0,
					window.scrollY + el.getBoundingClientRect().top + 80,
				),
			);
		await expect(current).toHaveText("開始閱讀");
		await page.goBack();
		await expect(page.locator("#doc-長行程式")).toBeFocused();
		await expect(current).toHaveText("長行程式");
		await page.goForward();
		await expect(page.locator("#doc-流程圖")).toBeFocused();
		await expect(current).toHaveText("流程圖");
		await page.reload();
		await expect(
			page.frameLocator(".ks-diagram-frame").locator("g.node"),
		).toHaveCount(4);
		await expect(current).toHaveText("流程圖");
		await expect(page.locator("#doc-流程圖")).toBeInViewport();
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(current).toHaveCount(0);
	});

for (const width of [320, 390, 1440])
	test(`diagram expanded view preserves one frame, zoom and keyboard focus at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/reader.html?doc=guide.md#流程圖");
		await expect(
			page.frameLocator(".ks-diagram-frame").locator("svg"),
		).toBeVisible();
		await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await expect(page.locator(".ks-diagram-controls")).toContainText(
			"100%",
		);
		await page
			.locator(".ks-diagram")
			.screenshot({ path: `test-results/diagram-default-${width}.png` });
		await page.locator(".ks-diagram-frame").evaluate((el) => {
			window.__originalFrame = el;
		});
		await page.getByRole("button", { name: "放大", exact: true }).click();
		await expect(page.locator(".ks-diagram-controls")).toContainText(
			"125%",
		);
		await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await page
			.locator(".ks-diagram")
			.screenshot({ path: `test-results/diagram-zoom-${width}.png` });
		const expand = page.getByRole("button", {
			name: "展開圖表",
			exact: true,
		});
		await expand.click();
		const dialog = page.getByRole("dialog", {
			name: "展開圖表",
			exact: true,
		});
		await expect(dialog).toBeVisible();
		const close = dialog.getByRole("button", { name: "關閉圖表" });
		await expect(close).toBeFocused();
		await expect(dialog.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await dialog.screenshot({
			path: `test-results/diagram-expanded-${width}.png`,
		});
		await expect(page.locator(".ks-diagram-frame")).toHaveCount(1);
		expect(
			await page
				.locator(".ks-diagram-frame")
				.evaluate((el) => el === window.__originalFrame),
		).toBe(true);
		await expect(dialog.locator(".ks-diagram-controls")).toContainText(
			"125%",
		);
		await expect(
			page.frameLocator(".ks-diagram-frame").locator("svg"),
		).toBeVisible();
		const pan = page.frameLocator(".ks-diagram-frame").getByRole("region");
		await pan.focus();
		await page.keyboard.press("ArrowRight");
		await expect
			.poll(() => pan.evaluate((el) => el.scrollLeft))
			.toBeGreaterThan(0);
		await close.focus();
		await page.keyboard.press("Tab");
		expect(
			await page.evaluate(
				() => document.activeElement.closest("dialog") !== null,
			),
		).toBe(true);
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(expand).toBeFocused();
		await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await expect(page.locator(".ks-diagram-controls")).toContainText(
			"125%",
		);
		await page.getByRole("button", { name: "適合寬度" }).click();
		await expect(page.locator(".ks-diagram-controls")).toContainText(
			"100%",
		);
		await expand.click();
		await page.getByRole("button", { name: "關閉圖表" }).click();
		await expect(expand).toBeFocused();
	});

test("async diagram completion respects user scroll intent; expanded history restores article focus", async ({
	page,
}) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	await page.route("**/reader/assets/chunks/*mermaid*", async (route) => {
		await gate;
		await route.continue();
	});
	await page.goto("/reader.html?doc=guide.md#流程圖");
	await expect(page.locator("#doc-流程圖")).toBeInViewport();
	await page.keyboard.press("Control+Home");
	await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
	release();
	await expect(
		page.frameLocator(".ks-diagram-frame").locator("g.node"),
	).toHaveCount(4);
	await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
	await expect(page.locator("#reader-toc a[aria-current]")).toHaveCount(0);
	await page
		.locator("#reader-toc")
		.getByRole("link", { name: "程式與資料", exact: true })
		.click();
	await page
		.locator("#reader-toc")
		.getByRole("link", { name: "流程圖", exact: true })
		.click();
	await page.getByRole("button", { name: "展開圖表", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.goBack();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.locator("#doc-程式與資料")).toBeFocused();
	await page.goForward();
	await expect(page.locator("#doc-流程圖")).toBeFocused();
	await page.locator("#reader-library a").nth(2).click();
	await expect(page.locator(".ks-diagram-error")).toHaveCount(2);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.locator(".ks-diagram-workspace")).toHaveCount(0);
});
