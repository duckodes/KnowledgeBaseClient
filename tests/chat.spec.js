import { test, expect } from '@playwright/test';
// Test-only network substitutes. Production app.js is unchanged; no bypass ships.
const authStub = `
let changed; const user={uid:'synthetic-user',email:'reader@example.invalid',getIdToken:async()=>'synthetic-token'};
export const browserLocalPersistence={};
export const getAuth=()=>({});
export const setPersistence=async()=>{};
export const onAuthStateChanged=(auth,callback)=>{changed=callback;callback(null)};
export const signInWithEmailAndPassword=async()=>{changed(user)};
export const createUserWithEmailAndPassword=async()=>{changed(user)};
export const signOut=async()=>{changed(null)};`;
test('existing login, Q&A protocol/history/errors/logout and Reader entry', async ({ page }) => {
  const requests = [];
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: route.request().url().endsWith('firebase-app.js') ? 'export const initializeApp=()=>({});' : authStub }));
  await page.route('**/config/firebaseConfig.json', route => route.fulfill({ json: { apiKey: 'synthetic', projectId: 'synthetic-project' } }));
  await page.route('https://us-central1-synthetic-project.cloudfunctions.net/knowledgeBaseAgent', async route => {
    requests.push({ body: route.request().postDataJSON(), auth: route.request().headers().authorization });
    if (requests.length === 3) await route.fulfill({ status: 403, json: { error: { status: 'PERMISSION_DENIED' } } });
    else await route.fulfill({ json: { result: { answer: '**合成回答**\n\n- 第一項\n- 第二項', sources: ['Synthetic source'] } } });
  });
  await page.goto('/');
  await expect(page.locator('#question')).toBeDisabled();
  await page.locator('#auth-switch').click(); await expect(page.locator('#auth-title')).toHaveText('建立 Jacfit 帳號');
  await page.locator('#auth-switch').click();
  await page.locator('#email').fill('reader@example.invalid'); await page.locator('#password').fill('synthetic-password');
  await page.locator('#auth-submit').click(); await expect(page.locator('#question')).toBeEnabled();
  for (const question of ['合成問題一', '合成追問']) {
    await page.locator('#question').fill(question); await page.locator('#question').press('Enter');
    await expect(page.locator('#question')).toBeEnabled();
  }
  expect(requests[0]).toEqual({ body: { data: { operation:'answer', query:'合成問題一', conversationHistory:[] } }, auth:'Bearer synthetic-token' });
  expect(requests[1].body.data.conversationHistory).toHaveLength(2);
  await expect(page.locator('.message.assistant strong').first()).toHaveText('合成回答');
  await page.locator('#question').fill('合成拒絕'); await page.locator('#question').press('Enter');
  await expect(page.locator('.message.error')).toContainText('目前帳號沒有使用知識庫的權限');
  await page.locator('#sign-out').click(); await expect(page.locator('#question')).toBeDisabled();
  await expect(page.locator('#messages')).toBeEmpty();
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: '文件閱讀（另開分頁）', exact: true }).click();
  const reader = await popup;
  await expect(reader.locator('article h1')).toContainText('合成文件的閱讀指南');
  await expect(page.locator('#question')).toBeDisabled();
});
