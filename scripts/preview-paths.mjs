import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fixturePaths } from '../reader/links.js';

const publicFiles = new Set(['index.html', 'app.js', 'styles.css', 'styles/tokens.css', 'styles/brand.css',
  'reader.html', 'reader/reader.css', 'config/firebaseConfig.json',
  ...fixturePaths.map(path => `reader/fixtures/${path}`)]);
const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;

export async function resolvePublicFile(rawPath, root, testMode = false) {
  const path = decodeURIComponent(rawPath.split('?')[0]);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\%:#?\u0000-\u001f\u007f]/u.test(path)) throw new Error('Invalid path');
  const relative = path === '/' ? 'index.html' : path.slice(1);
  if (relative.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Invalid segment');
  const publicAsset = /^reader\/assets\/(?:chunks\/)?[A-Za-z0-9_.-]+\.js$/.test(relative);
  const testAsset = testMode && relative === 'tests/assets/security-entry.js';
  if (!publicFiles.has(relative) && !publicAsset && !testAsset) throw new Error('Not public');
  const expected = resolve(root, relative);
  const actual = await realpath(expected);
  if (!comparable(actual).startsWith(comparable(root) + sep) || comparable(actual) !== comparable(expected)) throw new Error('Aliased path');
  if (!(await stat(actual)).isFile()) throw new Error('Not a file');
  return actual;
}
