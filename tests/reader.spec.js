import { test, expect } from '@playwright/test';

test('parser and sanitizer resist XSS corpus and report malformed headings', async ({ page }) => {
  await page.goto('/reader.html');
  const result = await page.evaluate(async () => {
    const { renderMarkdown, diagramAllowed, mermaidConfig } = await import('/tests/assets/security-entry.js');
    const corpus = '# Test\n\n### Skip\n\n# Extra\n\n<img src=x onerror=alert(1)>\n\n<svg><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe></foreignObject></svg>\n\n[encoded](jav&#x61;script:alert(1))\n\n[svg](data:image/svg+xml,test)\n\n[unsafe](vbscript:msgbox)\n\n![pixel](https://example.invalid/pixel)\n\n```html\n<script>alert(1)</script>\n```';
    const { fragment, issues } = renderMarkdown(corpus, 'guide.md');
    const container = document.createElement('div'); container.append(fragment);
    return { unsafe: container.querySelectorAll('script,img,svg,iframe,[onerror],a[href^="javascript:"],a[href^="data:"],a[href^="vbscript:"]').length,
      text: container.textContent, issues, strict: mermaidConfig.securityLevel,
      rejected: ['%%{init:{}}%%\nflowchart LR; A-->B','---\nconfig: x','flowchart LR\nclassDef a fill:red','flowchart LR\nclick A "https://example.invalid"'].every(s => !diagramAllowed(s)) };
  });
  expect(result.unsafe).toBe(0); expect(result.text).toContain('<script>alert(1)</script>');
  expect(result.issues).toHaveLength(2); expect(result.strict).toBe('strict'); expect(result.rejected).toBeTruthy();
});

test('headings, H2 sections, unique anchors and browser history', async ({ page }) => {
  await page.goto('/reader.html');
  await expect(page.locator('article h1')).toHaveText('合成文件的閱讀指南§');
  expect(await page.locator('article h1').count()).toBe(1);
  expect(await page.locator('article > section').count()).toBe(5);
  await expect(page.locator('#doc-同名章節-2')).toBeVisible();
  const levels = await page.locator('article h1, article h2, article h3, article h4').evaluateAll(items => items.map(h => Number(h.tagName[1])));
  expect(levels.every((v, i) => !i || v <= levels[i-1] + 1)).toBeTruthy();
  await page.locator('#reader-toc').getByRole('link', { name: '程式與資料', exact: true }).click();
  await expect(page).toHaveURL(/#%E7%A8%8B/);
  await expect(page.locator('#doc-程式與資料')).toBeFocused();
  await page.getByRole('link', { name: '連結範例', exact: true }).click();
  await expect(page.locator('#doc-中文章節')).toBeFocused();
  await page.reload(); await expect(page.locator('#doc-中文章節')).toBeInViewport();
  await page.getByRole('link', { name: '上層文件', exact: true }).click();
  await expect(page.locator('#doc-程式與資料')).toBeFocused();
  await page.goBack(); await expect(page.locator('article h1')).toContainText('連結解析範例');
  await page.goForward(); await expect(page.locator('article h1')).toContainText('合成文件的閱讀指南');
});

test('strict Mermaid works, sandbox zoom works, failures retain text and code', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/reader.html?doc=guide.md#流程圖');
  const frame = page.frameLocator('.ks-diagram-frame');
  await expect(frame.locator('svg')).toBeVisible();
  await page.locator('.ks-diagram-frame').scrollIntoViewIfNeeded();
  await expect(frame.locator('g.node')).toHaveCount(4);
  for (const node of await frame.locator('g.node > rect').all()) {
    const bounds = await node.boundingBox(); expect(bounds.width).toBeGreaterThan(20); expect(bounds.height).toBeGreaterThan(10);
    await expect(node).toBeInViewport();
  }
  expect(await page.locator('.ks-diagram-frame').getAttribute('sandbox')).toBe('');
  await expect(frame.locator('svg')).toContainText('讀者');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('.ks-diagram-controls')).toContainText('125%');
  const pan = frame.getByRole('region'); await pan.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pan.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '適合寬度' }).click();
  await expect(page.locator('.ks-diagram-controls')).toContainText('100%');
  await page.locator('#reader-theme').selectOption('dark');
  await expect(page.frameLocator('.ks-diagram-frame').locator('svg')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'dark');
  await page.goto('/reader.html?doc=safety.md');
  await expect(page.locator('.ks-diagram-error')).toHaveCount(2);
  await expect(page.locator('.ks-diagram details[open]')).toHaveCount(2);
  await expect(page.locator('article')).toContainText('沒有可推論的節點關係');
  await expect(page.locator('.ks-diagram pre').first()).toContainText('deliberately invalid');
  await expect(page.locator('.ks-diagram-workspace')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unsafe Markdown has no executable DOM, links or automatic network', async ({ page, baseURL }) => {
  const remote = [];
  page.on('request', request => { if (!request.url().startsWith(baseURL + '/')) remote.push(request.url()); });
  await page.goto('/reader.html?doc=safety.md');
  await expect(page.locator('.ks-diagram-error')).toHaveCount(2);
  await expect(page.locator('article script,article img,article iframe,article object,article [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__readerXss)).toBeUndefined();
  expect(remote).toEqual([]);
  const hrefs = await page.locator('article a[href]').evaluateAll(items => items.map(a => a.getAttribute('href')));
  expect(hrefs.every(h => !/javascript:|data:|^\/\/|\.\.\//i.test(h))).toBeTruthy();
  await expect(page.getByRole('link', { name: /跨根路徑/ })).toHaveCount(0);
  await page.getByRole('link', { name: '未知片段', exact: true }).click();
  await expect(page.locator('#reader-status')).toContainText('找不到指定章節');
  await page.goto('/reader.html?doc=..%2Fconfig%2FfirebaseConfig.json');
  await expect(page.locator('article')).toContainText('找不到這份合成文件');
  await expect(page.locator('#reader-source')).toBeHidden();
});

for (const width of [320, 390, 1440]) test(`responsive, keyboard and theme at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/reader.html');
  await expect(page.locator('article h1')).toBeVisible();
  await page.keyboard.press('Tab'); await expect(page.locator('.ks-skip')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('article')).toBeFocused();
  await expect(page.frameLocator('.ks-diagram-frame').locator('svg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (width < 900) {
    const summary = page.locator('.ks-navigation > summary'); await summary.focus();
    await page.keyboard.press('Enter'); await expect(page.locator('.ks-navigation')).toHaveAttribute('open', '');
    const link = page.locator('#reader-toc a').first(); await link.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#doc-開始閱讀')).toBeFocused();
  }
  for (const selector of ['.ks-table-scroll', '.ks-code pre']) {
    const region = selector.includes('pre') ? page.locator(selector).nth(1) : page.locator(selector).first(); await region.focus(); await expect(region).toBeFocused();
    if (width < 900 || selector.includes('pre')) {
      expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy();
      await page.keyboard.press('ArrowRight'); await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
  }
  await page.locator('#reader-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'light');
  await page.reload(); await expect(page.locator('#reader-theme')).toHaveValue('light');
  await expect(page.frameLocator('.ks-diagram-frame').locator('g.node')).toHaveCount(4);
  await page.locator('.ks-diagram-frame').scrollIntoViewIfNeeded();
  await page.locator('.ks-diagram').screenshot({ path: `test-results/diagram-${width}-light.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/reader-${width}-light.png`, fullPage: true });
  await page.locator('#reader-theme').selectOption('dark');
  await expect(page.frameLocator('.ks-diagram-frame').locator('svg')).toBeVisible();
  await page.locator('.ks-diagram-frame').scrollIntoViewIfNeeded();
  await page.locator('.ks-diagram').screenshot({ path: `test-results/diagram-${width}-dark.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/reader-${width}-dark.png`, fullPage: true });
});

test('copy success and clipboard failure provide honest feedback', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/reader.html');
  const expected = await page.locator('.ks-code pre code').first().textContent();
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async text => { window.__copiedCode = text; return write(text); };
  });
  await page.getByRole('button', { name: '複製程式碼' }).first().click();
  await expect(page.locator('#reader-status')).toContainText('程式碼已複製');
  expect(await page.evaluate(() => window.__copiedCode)).toBe(expected);
  // The Windows native clipboard normalizes LF to CRLF on readback.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(expected);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await page.getByRole('button', { name: '複製程式碼' }).first().click();
  await expect(page.locator('#reader-status')).toContainText('請手動選取');
});

test('no JavaScript still provides full raw synthetic source', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage(); await page.goto(baseURL + '/reader.html');
  await page.getByRole('link', { name: '閱讀指南', exact: true }).click();
  await expect(page.locator('body')).toContainText('## 流程圖');
  await context.close();
});

test('diagram resource failure leaves original code and alternative description', async ({ page }) => {
  await page.route('**/reader/assets/chunks/*mermaid*', route => route.abort());
  await page.goto('/reader.html');
  await expect(page.locator('.ks-diagram-error')).toHaveCount(1);
  await expect(page.locator('.ks-diagram details')).toHaveAttribute('open', '');
  await expect(page.locator('article')).toContainText('過程不呼叫文件 API');
});
