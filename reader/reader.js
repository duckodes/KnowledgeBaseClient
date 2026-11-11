import guide from './fixtures/guide.md';
import links from './fixtures/examples/連結 範例.md';
import safety from './fixtures/safety.md';
import { readerUrl, fixturePaths } from './links.js';
import { renderMarkdown } from './markdown.js';
import { renderDiagram } from './diagrams.js';
const documents = new Map([
  [fixturePaths[0], { title: '合成文件的閱讀指南', text: guide, label: '01 / 閱讀指南' }],
  [fixturePaths[1], { title: '連結解析範例', text: links, label: '02 / 連結範例' }],
  [fixturePaths[2], { title: '安全與失敗範例', text: safety, label: '03 / 安全與失敗' }],
]);
const article = document.querySelector('#reader-article');
const status = document.querySelector('#reader-status');
const toc = document.querySelector('#reader-toc');
const theme = document.querySelector('#reader-theme');
const media = matchMedia('(prefers-color-scheme: dark)');
const narrow = matchMedia('(max-width: 900px)');
const tocPanel = document.querySelector('.ks-toc-panel');
tocPanel.open = !narrow.matches;
narrow.addEventListener('change', event => { tocPanel.open = !event.matches; });
let currentPath, headings = [], generation = 0, observer;
let diagramQueue = Promise.resolve();
try { theme.value = ['light','dark','system'].includes(localStorage.getItem('ks-reader-theme')) ? localStorage.getItem('ks-reader-theme') : 'system'; } catch { /* Presentation preference is optional. */ }
function applyTheme() {
  document.documentElement.dataset.readerTheme = theme.value === 'system' ? (media.matches ? 'dark' : 'light') : theme.value;
}
applyTheme();
const isDark = () => document.documentElement.dataset.readerTheme === 'dark';
for (const [path, doc] of documents) {
  const a = document.createElement('a'); a.href = readerUrl(path); a.textContent = doc.label;
  a.dataset.doc = path; document.querySelector('#reader-library').append(a);
}
function announce(text) { status.textContent = text; }
function moveToFragment(focus = false) {
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { announce('章節連結編碼無效。'); return; }
  const heading = headings.find(h => h.id === id);
  if (id && !heading) { announce('找不到指定章節；已保留完整文章。'); if (focus) article.focus(); return; }
  if (heading) { heading.element.scrollIntoView({ block: 'start' }); if (focus) heading.element.focus({ preventScroll: true }); }
  else { window.scrollTo(0, 0); if (focus) article.focus({ preventScroll: true }); }
  for (const a of toc.querySelectorAll('a')) {
    if (a.dataset.heading === id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
  }
}
async function decorateDiagrams(token) {
  for (const code of article.querySelectorAll('pre > code.language-mermaid')) {
    const pre = code.parentElement, source = code.textContent;
    const figure = document.createElement('figure'); figure.className = 'ks-diagram';
    const caption = document.createElement('figcaption'); caption.textContent = 'Mermaid · 文字替代請見相鄰說明';
    const viewport = document.createElement('div'); viewport.className = 'ks-diagram-viewport';
    const loading = document.createElement('p'); loading.textContent = '正在繪製圖表，原始圖碼仍可閱讀。'; viewport.append(loading);
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '原始圖碼';
    pre.before(figure); details.append(summary, pre); figure.append(caption, viewport, details);
    try {
      await renderDiagram(source, viewport, isDark());
    } catch {
      viewport.replaceChildren(); const fallback = document.createElement('p'); fallback.className = 'ks-diagram-error';
      fallback.textContent = '圖表無法顯示或已被安全規則拒絕。請閱讀文字替代與原始圖碼。';
      viewport.append(fallback); details.open = true;
    }
    if (token !== generation) return;
  }
  // Async diagram height must not move the requested fragment away from the viewport.
  if (token === generation && location.hash) moveToFragment(false);
}
function load({ focus = false, force = false } = {}) {
  const path = new URLSearchParams(location.search).get('doc') || fixturePaths[0];
  if (path === currentPath && !force) { announce(''); moveToFragment(focus); return; }
  currentPath = path; const token = ++generation; observer?.disconnect();
  article.replaceChildren(); toc.replaceChildren(); headings = [];
  const doc = documents.get(path);
  document.querySelector('#reader-path').textContent = doc ? `文件 / ${doc.title}` : '文件不存在';
  const source = document.querySelector('#reader-source'); source.hidden = !doc;
  for (const a of document.querySelectorAll('#reader-library a')) {
    if (a.dataset.doc === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!doc) {
    const h = document.createElement('h1'); h.textContent = '找不到這份合成文件'; article.append(h);
    announce('請由文件清單選擇；Reader 不會嘗試讀取其他路徑。'); document.title = '文件不存在 · KnowledgeSpace';
    if (focus) article.focus(); return;
  }
  source.href = `./reader/fixtures/${path.split('/').map(encodeURIComponent).join('/')}`;
  document.title = `${doc.title} · KnowledgeSpace`;
  const result = renderMarkdown(doc.text, path); headings = result.headings; article.append(result.fragment);
  announce(result.issues.join(' '));
  for (const h of headings.filter(h => h.level === 2 || h.level === 3)) {
    const a = document.createElement('a'); a.href = readerUrl(path, h.id); a.textContent = h.title;
    a.dataset.heading = h.id; a.className = `ks-toc-level-${h.level}`; toc.append(a);
  }
  for (const pre of article.querySelectorAll('pre')) {
    if (pre.querySelector('.language-mermaid')) continue;
    const raw = pre.querySelector('code').textContent;
    const wrapper = document.createElement('div'); wrapper.className = 'ks-code'; pre.before(wrapper);
    const bar = document.createElement('div'); bar.className = 'ks-code-bar';
    const label = document.createElement('span'); label.textContent = pre.querySelector('code').className.replace('language-', '') || 'code';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '複製程式碼';
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(raw); announce('程式碼已複製。'); }
      catch { announce('無法使用剪貼簿，請手動選取程式碼複製。'); pre.focus(); }
    }); bar.append(label, button); wrapper.append(bar, pre);
  }
  observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) for (const a of toc.querySelectorAll('a')) {
      if (`doc-${a.dataset.heading}` === visible.target.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-80px 0px -55% 0px' });
  headings.filter(h => h.level === 2 || h.level === 3).forEach(h => observer.observe(h.element));
  moveToFragment(focus);
  // Serialize Mermaid global state; obsolete routes never write into the active article.
  diagramQueue = diagramQueue.then(() => token === generation ? decorateDiagrams(token) : undefined).catch(() => announce('圖表資源無法載入，請閱讀原碼。'));
}
document.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = event.target.closest('a[href]'); if (!a || a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (a.classList.contains('ks-skip')) { event.preventDefault(); article.focus(); article.scrollIntoView(); return; }
  if (url.origin === location.origin && url.pathname === location.pathname) {
    event.preventDefault();
    if (url.href !== location.href) history.pushState(null, '', url);
    load({ focus: true });
  }
});
window.addEventListener('popstate', () => load({ focus: true }));
window.addEventListener('hashchange', () => moveToFragment(true));
theme.addEventListener('change', () => {
  try { localStorage.setItem('ks-reader-theme', theme.value); } catch { /* Optional. */ }
  applyTheme(); load({ force: true });
});
media.addEventListener('change', () => { if (theme.value === 'system') { applyTheme(); load({ force: true }); } });
load();
