import { test, expect } from '@playwright/test';

test('F01: Mermaid policy rejects semicolon-separated style statements', async ({ page }) => {
  await page.goto('/reader.html');
  const policy = await page.evaluate(async () => {
    const { diagramAllowed } = await import('/tests/assets/security-entry.js');
    return {
      standalone: diagramAllowed('flowchart LR\nA-->B\nstyle A fill:#f00'),
      semicolon: diagramAllowed('flowchart LR; A-->B; style A fill:#f00'),
    };
  });
  expect(policy.standalone).toBe(false);
  expect(policy.semicolon).toBe(false);
});

test('F02: Preview excludes node_modules regardless of Windows path casing', async ({ request }) => {
  expect((await request.get('/node_modules/markdown-it/package.json')).status()).toBe(404);
  const response = await request.get('/NODE_MODULES/markdown-it/package.json');
  expect([200, 404]).toContain(response.status());
  if (response.status() === 200) expect((await response.json()).name).toBe('markdown-it');
  expect(response.status()).toBe(404);
});

test('F03: TOC current does not remain on a later section at the page top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/reader.html');
  await expect(page.frameLocator('.ks-diagram-frame').locator('g.node')).toHaveCount(4);
  await page.locator('#reader-toc').getByRole('link', { name: '流程圖', exact: true }).click();
  const current = page.locator('#reader-toc a[aria-current="location"]');
  await expect(current).toHaveText('流程圖');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => current.allTextContents(), { timeout: 1000 }).not.toContain('流程圖');
});
