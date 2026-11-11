import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import { resolveLink } from './links.js';
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false,
  highlight(code, language) {
    if (hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return ''; // markdown-it escapes unknown languages.
  },
});
// No image renderer: documents cannot cause remote or local resource requests.
parser.renderer.rules.image = (tokens, i) => `[圖片未載入：${parser.utils.escapeHtml(tokens[i].content)}]`;
export function renderMarkdown(markdown, source) {
  if (markdown.length > 150_000) throw new Error('文件超過 M1 大小限制。');
  const fragment = DOMPurify.sanitize(parser.render(markdown), {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','a','strong','em','s','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','hr','br','span'],
    ALLOWED_ATTR: ['href','title','class','start'], ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const headings = [], issues = [], used = new Set();
  let previous = 0;
  for (const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const level = Number(heading.tagName.slice(1)), title = heading.textContent;
    if ((previous === 0 && level !== 1) || level > previous + 1 || level > 4) issues.push('標題層級應由單一 H1 依序展開至 H4。');
    previous = level;
    const base = title.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id); heading.id = `doc-${id}`; heading.tabIndex = -1;
    const anchor = document.createElement('a'); anchor.className = 'ks-heading-anchor';
    anchor.href = `#${encodeURIComponent(id)}`; anchor.textContent = '§';
    anchor.setAttribute('aria-label', `章節連結：${title}`); heading.append(anchor);
    headings.push({ level, title, id, element: heading });
  }
  if (headings.filter(h => h.level === 1).length !== 1) issues.push('文件必須只有一個 H1。');
  for (const link of fragment.querySelectorAll('a:not(.ks-heading-anchor)')) {
    const resolved = resolveLink(link.getAttribute('href'), source);
    if (resolved.kind === 'local') link.setAttribute('href', resolved.href);
    else if (resolved.kind === 'external') {
      link.href = resolved.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.append(document.createTextNode(' ↗'));
    } else {
      link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true');
      link.title = resolved.kind === 'unavailable' ? '未提供的合成文件' : '連結已由安全規則阻擋';
      link.append(document.createTextNode('（連結不可用）'));
    }
  }
  // Semantic H2 sections, without changing content order or copying prose.
  let section;
  for (const node of [...fragment.childNodes]) {
    if (node.nodeName === 'H2') {
      section = document.createElement('section'); section.setAttribute('aria-labelledby', node.id);
      fragment.insertBefore(section, node); section.append(node);
    } else if (section) section.append(node);
  }
  for (const table of fragment.querySelectorAll('table')) {
    const wrapper = document.createElement('div'); wrapper.className = 'ks-table-scroll';
    wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', '資料表格，可水平捲動');
    table.before(wrapper); wrapper.append(table);
    for (const th of table.querySelectorAll('thead th')) th.scope = 'col';
  }
  for (const pre of fragment.querySelectorAll('pre')) {
    pre.tabIndex = 0; pre.setAttribute('aria-label', '程式碼，可水平捲動');
  }
  return { fragment, headings, issues: [...new Set(issues)] };
}
