import { test, expect } from '@playwright/test';

for (const width of [320,390,1440]) test(`shared green tokens, controls, focus and CSS isolation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:900});
  // This comparison measures static UI, with all external services blocked.
  await page.route('https://**', route => route.abort());
  await page.goto('/');
  const measure = selectors => page.evaluate(selectors => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    return { sidebar:rect(selectors.sidebar).width, surface:style(selectors.sidebar).backgroundColor,
      brand:style(selectors.brand).backgroundColor, radius:style(selectors.brand).borderRadius,
      control:rect(selectors.control).height, controlRadius:style(selectors.control).borderRadius,
      focus:style(selectors.control).outline, overflow:document.documentElement.scrollWidth > innerWidth,
      font:style('body').fontFamily };
  }, selectors);
  await page.locator('.primary-button').focus();
  const chat = await measure({sidebar:'.sidebar',brand:'.brand-mark',control:'.primary-button'});
  expect(await page.locator('.app-shell').evaluate(el => el.getBoundingClientRect().height)).toBe(900);
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).overflowY)).toBe('hidden');
  expect(chat.overflow).toBe(false);
  await page.goto('/reader.html');
  await page.locator('#reader-theme').selectOption('light');
  await page.locator('#reader-theme').focus();
  const reader = await measure({sidebar:'.ks-sidebar',brand:'.ks-brand-mark',control:'#reader-theme'});
  expect(reader.brand).toBe('rgb(36, 92, 75)'); expect(reader.brand).toBe(chat.brand);
  expect(reader.surface).toBe(chat.surface); expect(reader.radius).toBe(chat.radius);
  expect(reader.control).toBe(chat.control); expect(reader.controlRadius).toBe(chat.controlRadius);
  expect(reader.focus).toBe(chat.focus); expect(reader.focus).toBe('rgb(36, 92, 75) solid 3px');
  expect(reader.font).toBe(chat.font); expect(reader.overflow).toBe(false);
  if (width === 1440) expect(reader.sidebar).toBe(chat.sidebar);
  else expect(reader.sidebar).toBe(width);
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  expect(await page.locator('article').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(900);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.locator('article').evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('auto');
  await page.locator('#reader-theme').selectOption('dark');
  const contrast = await page.evaluate(() => {
    const style=getComputedStyle(document.body), pairs=[['text','canvas'],['muted','surface'],['link','surface'],['on-brand','brand']];
    const luminance = token => {
      const hex=style.getPropertyValue('--ks-'+token).trim().slice(1);
      const c=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return c[0]*.2126+c[1]*.7152+c[2]*.0722;
    };
    return pairs.map(([a,b])=>{const x=luminance(a),y=luminance(b);return [a,b,(Math.max(x,y)+.05)/(Math.min(x,y)+.05)];});
  });
  for (const [a,b,ratio] of contrast) expect(ratio,`${a}/${b}`).toBeGreaterThanOrEqual(4.5);
});
