import { test, expect } from "@playwright/test";

async function typography(page, selectors) {
	await page.evaluate(() => document.fonts.ready);
	return page.evaluate(
		(selectors) =>
			Object.fromEntries(
				Object.entries(selectors).map(([name, selector]) => {
					const style = getComputedStyle(
						document.querySelector(selector),
					);
					return [
						name,
						Object.fromEntries(
							[
								"fontFamily",
								"fontSize",
								"fontWeight",
								"lineHeight",
								"letterSpacing",
								"fontSynthesis",
							].map((key) => [key, style[key]]),
						),
					];
				}),
			),
		selectors,
	);
}

async function platformFonts(page, selector) {
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const { root } = await cdp.send("DOM.getDocument");
		const { nodeId } = await cdp.send("DOM.querySelector", {
			nodeId: root.nodeId,
			selector,
		});
		return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId }))
			.fonts;
	} finally {
		await cdp.detach();
	}
}

async function brand(page) {
	return page.locator(".brand").evaluate((element) => ({
		title: element.querySelector("strong").textContent,
		caption: element.querySelector(".brand-copy > span").textContent,
		viewBox: element.querySelector("svg").getAttribute("viewBox"),
		paths: [...element.querySelectorAll("svg path")].map((p) =>
			Object.fromEntries(
				[...p.attributes].map((a) => [a.name, a.value]).sort(),
			),
		),
		markSize: element.querySelector(".brand-mark").getBoundingClientRect()
			.width,
		svgSize: element.querySelector("svg").getBoundingClientRect().width,
		radius: getComputedStyle(element.querySelector(".brand-mark"))
			.borderRadius,
		gap: getComputedStyle(element).gap,
	}));
}

for (const width of [320, 390, 1440]) {
	test(`original Jacfit SVG and rendered typography match Q&A at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.route("https://**", (route) => route.abort());
		await page.goto("/");
		const qaBrand = await brand(page);
		const qa = await typography(page, {
			brand: ".brand-copy strong",
			caption: ".brand-copy > span",
			button: ".primary-button",
			navigation: ".suggestion",
			label: ".sidebar-label",
			breadcrumb: ".breadcrumb",
		});
		const qaFonts = await platformFonts(page, ".brand-copy strong");
		await page.goto("/reader.html?doc=guide.md");
		await page.locator("#reader-theme").selectOption("light");
		await expect(
			page.getByRole("link", { name: "Jacfit 文件閱讀首頁" }),
		).toBeVisible();
		expect(await brand(page)).toEqual(qaBrand);
		expect(qaBrand.title.trim()).toBe("JACFIT");
		expect(qaBrand.caption.trim()).toBe("KNOWLEDGE STUDIO");
		expect(qaBrand.markSize).toBe(width < 720 ? 37 : 43);
		const reader = await typography(page, {
			brand: ".brand-copy strong",
			caption: ".brand-copy > span",
			button: ".ks-code button",
			navigation: "#reader-library a:nth-child(2)",
			label: ".ks-eyebrow",
			breadcrumb: ".ks-document-bar",
		});
		expect(reader).toEqual(qa);
		const fonts = await platformFonts(page, ".brand-copy strong");
		expect(fonts.length).toBeGreaterThan(0);
		expect(fonts).toEqual(qaFonts);
		expect(
			fonts.every((font) => font.glyphCount > 0 && !font.isCustomFont),
		).toBe(true);
		const article = await typography(page, {
			paragraph: "article > p",
			code: ".ks-code pre",
		});
		expect(article.paragraph.fontSize).toBe("16px");
		expect(article.paragraph.lineHeight).toBe("28.8px");
		expect(article.paragraph.fontSynthesis).toBe("none");
		expect(article.code.fontFamily).toContain("monospace");
		const codeFonts = await platformFonts(page, ".ks-code pre");
		expect(codeFonts.length).toBeGreaterThan(0);
		await page.locator("#reader-theme").selectOption("dark");
		expect(await brand(page)).toEqual(qaBrand);
		expect(await platformFonts(page, ".brand-copy strong")).toEqual(
			qaFonts,
		);
	});

	test(`dark surfaces are neutral, layered and readable at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const external = [];
		page.on("request", (request) => {
			if (!request.url().startsWith("http://127.0.0.1:31338/"))
				external.push(request.url());
		});
		await page.goto("/reader.html?doc=guide.md");
		await page.locator("#reader-theme").selectOption("dark");
		const surfaces = await page.evaluate(() => {
			const style = getComputedStyle(document.body);
			return Object.fromEntries(
				[
					"canvas",
					"article",
					"surface",
					"elevated",
					"code",
					"soft",
					"note",
				].map((name) => [
					name,
					style.getPropertyValue(`--ks-${name}`).trim(),
				]),
			);
		});
		for (const hex of Object.values(surfaces)) {
			const channels = [1, 3, 5].map((start) =>
				parseInt(hex.slice(start, start + 2), 16),
			);
			expect(
				Math.max(...channels) - Math.min(...channels),
			).toBeLessThanOrEqual(12);
		}
		expect(
			new Set([
				surfaces.canvas,
				surfaces.article,
				surfaces.surface,
				surfaces.elevated,
			]).size,
		).toBe(4);
		const rgb = (hex) =>
			`rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
		expect(
			await page
				.locator(".ks-main")
				.evaluate((el) => getComputedStyle(el).backgroundColor),
		).toBe(rgb(surfaces.article));
		expect(
			await page
				.locator(".ks-code pre")
				.first()
				.evaluate((el) => getComputedStyle(el).backgroundColor),
		).toBe(rgb(surfaces.code));
		await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		const svg = page.frameLocator(".ks-diagram-frame").locator("svg");
		await expect(svg.locator("g.node")).toHaveCount(4);
		expect(
			await svg.evaluate((el) => getComputedStyle(el).fontFamily),
		).toContain("Noto Sans TC");
		expect(
			await page.locator(".ks-diagram-frame").getAttribute("sandbox"),
		).toBe("");
		await svg.evaluate((el) => {
			window.__retainedDiagram = el;
		});
		const atomicMove = await page.evaluate(
			() => typeof Element.prototype.moveBefore === "function",
		);
		await page
			.getByRole("button", { name: "展開圖表", exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		expect(
			await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
		).toBe(rgb(surfaces.elevated));
		await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await expect(svg).toBeVisible();
		if (atomicMove)
			expect(
				await svg.evaluate((el) => el === window.__retainedDiagram),
			).toBe(true);
		await page.getByRole("button", { name: "關閉圖表" }).click();
		await expect(dialog).toHaveCount(0);
		if (atomicMove)
			expect(
				await svg.evaluate((el) => el === window.__retainedDiagram),
			).toBe(true);
		expect(external).toEqual([]);
	});
}

test("expanded diagram keeps sandbox and fallback behavior without atomic moves", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Element.prototype.moveBefore = undefined;
	});
	await page.goto("/reader.html?doc=guide.md#流程圖");
	const svg = page.frameLocator(".ks-diagram-frame").locator("svg");
	await expect(svg.locator("g.node")).toHaveCount(4);
	const expand = page.getByRole("button", { name: "展開圖表", exact: true });
	await expand.click();
	await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
		"aria-busy",
		"false",
	);
	await expect(svg.locator("g.node")).toHaveCount(4);
	expect(
		await page.locator(".ks-diagram-frame").getAttribute("sandbox"),
	).toBe("");
	await page.getByRole("button", { name: "關閉圖表" }).click();
	await expect(expand).toBeFocused();
	await expect(page.locator(".ks-diagram-frame")).toHaveAttribute(
		"aria-busy",
		"false",
	);
	await expect(svg.locator("g.node")).toHaveCount(4);
});
