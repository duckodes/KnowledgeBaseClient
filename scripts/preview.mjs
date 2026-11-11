import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolvePublicFile } from './preview-paths.mjs';
const root = await realpath('.');
const port = Number(process.argv[2] ?? 31337);
const testMode = process.argv.includes('--test');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) throw new Error('Unsupported method');
    const file = await resolvePublicFile(req.url, root, testMode);
    res.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', function () { console.log(`Local preview: http://127.0.0.1:${this.address().port}/reader.html`); });
