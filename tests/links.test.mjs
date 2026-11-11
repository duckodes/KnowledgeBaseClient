import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink, readerUrl } from '../reader/links.js';
test('source-aware relative and Unicode fragment resolution', () => {
  assert.deepEqual(resolveLink('../guide.md#程式與資料', 'examples/連結 範例.md'), { kind: 'local', path: 'guide.md', fragment: '程式與資料', href: readerUrl('guide.md', '程式與資料') });
  assert.equal(resolveLink('examples/連結%20範例.md#中文章節', 'guide.md').kind, 'local');
  assert.equal(resolveLink('#中文章節', 'examples/連結 範例.md').path, 'examples/連結 範例.md');
});
test('reject traversal, schemes, encoded separators and unknown sources', () => {
  for (const link of ['../guide.md','%2e%2e/guide.md','%252e%252e/guide.md','/guide.md','//example.invalid','https://u:p@example.invalid','javascript:alert(1)','data:text/html,x','file:///test','gS://test','guide.md?x=1','examples%5c..%5cguide.md','%00guide.md','guide.md%23x','%ZZ','https:\\example.invalid']) {
    assert.notEqual(resolveLink(link, 'guide.md').kind, 'local', link);
    assert.equal(resolveLink(link, 'guide.md').kind, 'blocked', link);
  }
  assert.equal(resolveLink('missing.md', 'guide.md').kind, 'unavailable');
  assert.equal(resolveLink('https://example.org/path#fragment', 'guide.md').kind, 'external');
});
